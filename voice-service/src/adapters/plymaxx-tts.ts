// Speech synthesis on the self-hosted Plymaxx GPU server.
//
// Two synthesis models are deployed and the model is chosen per request:
//
//   hi -> piper / piper-hi-rohan    22 050 Hz, streams progressively, ~0.2 s
//   gu -> piper / piper-gu-male     22 050 Hz, streams progressively, ~0.2 s
//   en -> indic-parler-tts / Thoma  44 100 Hz, COMPLETED audio, ~1.2-1.5 s
//
// Piper has exactly two installed checkpoints; Divya, Neha, Rohit and Yash are
// aliases onto those two, not separate speakers. Parler has 68 named speakers
// and is the only model with English, but it has no streaming worker: a reply
// only starts once the whole phrase is generated. That is why replies are cut
// into short ordered phrases — the caller waits for the first short phrase,
// not the whole answer, and later phrases generate while earlier ones play.
//
// Both models return raw PCM16LE mono, never a WAV or MP3, and at different
// sample rates — neither of which divides the phone transport's 8 kHz evenly
// (22050/8000 = 2.756, 44100/8000 = 5.5125). The rate is read from the
// X-Audio-Sample-Rate header on every response and fed to the interpolating
// mu-law converter rather than being assumed.

import { config } from '../config.js';
import type { SupportedLanguage } from '../conversation/language.js';
import type { TtsAdapter } from './types.js';
import { splitSentences, writeWav } from './wav-utils.js';
import { Pcm16ResampleStreamToMulaw8k } from '../telephony/mulaw.js';
import { plymaxxFetch } from './plymaxx-client.js';

const ADAPTER = 'PlymaxxTtsAdapter';
const MAX_REQUEST_CHARS = 400;
const FALLBACK_SAMPLE_RATE = 22_050;
const SILENCE_GAP_MS = 80;

interface VoiceChoice {
  model: string;
  voice: string;
  /** Parler generates a whole phrase before returning anything. */
  streams: boolean;
}

function voiceFor(language: SupportedLanguage): VoiceChoice {
  if (language === 'gu') {
    return { model: config.AI_TTS_MODEL_GU, voice: config.AI_TTS_VOICE_GU, streams: config.AI_TTS_MODEL_GU === 'piper' };
  }
  if (language === 'en') {
    return { model: config.AI_TTS_MODEL_EN, voice: config.AI_TTS_VOICE_EN, streams: config.AI_TTS_MODEL_EN === 'piper' };
  }
  return { model: config.AI_TTS_MODEL_HI, voice: config.AI_TTS_VOICE_HI, streams: config.AI_TTS_MODEL_HI === 'piper' };
}

/**
 * Splits a reply into ordered chunks of at most `maxChars`.
 *
 * The first chunk is deliberately left as a single sentence so speech can
 * start as early as possible — it matters most for Parler, where the caller
 * hears nothing until a phrase is fully generated. Later sentences are packed
 * together to reduce round trips. A sentence longer than the limit on its own
 * is broken at the last word boundary that fits.
 */
export function splitForSynthesis(text: string, maxChars = MAX_REQUEST_CHARS): string[] {
  const sentences: string[] = [];
  for (const sentence of splitSentences(text.trim())) {
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = window.lastIndexOf(' ');
      const head = cut > maxChars * 0.5 ? window.slice(0, cut) : window;
      sentences.push(head.trim());
      rest = rest.slice(head.length).trim();
    }
    if (rest) sentences.push(rest);
  }
  if (sentences.length === 0) return [];

  const chunks: string[] = [sentences[0]!];
  for (let i = 1; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const last = chunks[chunks.length - 1]!;
    // Never merge into the first chunk — it is the one the caller waits on.
    if (chunks.length > 1 && last.length + 1 + sentence.length <= maxChars) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}

function sampleRateOf(response: Response): number {
  const declared = Number(response.headers.get('x-audio-sample-rate'));
  return Number.isFinite(declared) && declared > 0 ? declared : FALLBACK_SAMPLE_RATE;
}

async function requestSpeech(
  text: string,
  choice: VoiceChoice,
  language: SupportedLanguage,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  return plymaxxFetch({
    adapterName: ADAPTER,
    url: config.AI_SPEECH_URL,
    body: JSON.stringify({
      model: choice.model,
      voice: choice.voice,
      language,
      input: text,
      response_format: 'pcm',
    }),
    jsonContentType: true,
    timeoutMs,
    ...(signal ? { signal } : {}),
  });
}

/**
 * Parler can take several seconds for a long phrase, well past the timeout
 * that suits Piper, so the non-streaming model gets a longer deadline.
 */
function timeoutFor(choice: VoiceChoice): number {
  return choice.streams ? config.VOICE_TTS_TIMEOUT_MS : Math.max(config.VOICE_TTS_TIMEOUT_MS, config.AI_TTS_COMPLETED_TIMEOUT_MS);
}

export class PlymaxxTtsAdapter implements TtsAdapter {
  async synthesize(text: string, language: SupportedLanguage): Promise<Buffer> {
    const choice = voiceFor(language);
    const chunks = splitForSynthesis(text);
    if (chunks.length === 0) return writeWav(Buffer.alloc(0), FALLBACK_SAMPLE_RATE, 16, 1);

    const segments: Buffer[] = [];
    let sampleRate = FALLBACK_SAMPLE_RATE;
    // Sequential, not parallel: each speech worker admits one active plus one
    // waiting request, shared across every project on this server.
    for (const chunk of chunks) {
      const response = await requestSpeech(chunk, choice, language, timeoutFor(choice));
      sampleRate = sampleRateOf(response);
      segments.push(Buffer.from(await response.arrayBuffer()));
    }

    const gap = Buffer.alloc(Math.floor((sampleRate * SILENCE_GAP_MS) / 1_000) * 2, 0);
    const body: Buffer[] = [];
    segments.forEach((segment, index) => {
      body.push(segment);
      if (index < segments.length - 1) body.push(gap);
    });
    return writeWav(Buffer.concat(body), sampleRate, 16, 1);
  }

  async synthesizeMulaw8k(text: string, language: SupportedLanguage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.synthesizeMulaw8kStream(text, language)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async *synthesizeMulaw8kStream(text: string, language: SupportedLanguage): AsyncGenerator<Buffer> {
    const choice = voiceFor(language);

    for (const chunk of splitForSynthesis(text)) {
      // One controller per phrase: abandoning the generator on barge-in runs
      // the finally block, which aborts the in-flight read so a cancelled turn
      // cannot keep streaming audio at the caller.
      const controller = new AbortController();
      let response: Response;
      try {
        response = await requestSpeech(chunk, choice, language, timeoutFor(choice), controller.signal);
      } catch (err) {
        controller.abort();
        throw err;
      }
      if (!response.body) throw new Error(`${ADAPTER}: speech response had no body.`);

      // Piper streams, so bytes are converted as they arrive. Parler returns
      // the finished phrase in one piece; the same loop handles both, it just
      // sees one large read instead of many small ones.
      const converter = new Pcm16ResampleStreamToMulaw8k(sampleRateOf(response));
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const mulaw = converter.push(Buffer.from(value));
          if (mulaw.length) yield mulaw;
        }
        const tail = converter.flush();
        if (tail.length) yield tail;
      } finally {
        reader.releaseLock();
        controller.abort();
      }
    }
  }
}
