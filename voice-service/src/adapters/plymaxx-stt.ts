// Speech recognition on the self-hosted Plymaxx GPU server.
//
// Every language this product speaks is served here, so nothing falls back to
// a paid vendor. The model is chosen per request rather than per deployment:
//
//   en      -> whisper-large-v3-turbo, language=en
//   hi      -> whisper-large-v3-turbo, language=hi
//   gu      -> indic-conformer-600m-multilingual, language=gu
//   unknown -> whisper-large-v3-turbo, language=auto  (Whisper reports what it heard)
//
// Gujarati uses the Indic conformer because it scored better than Whisper on
// the owner's Gujarati fixtures; that model covers 22 Indic languages and now
// rejects English with 422 instead of transliterating it into Devanagari.
// Whisper's own default language is Hindi, so `language` is always sent
// explicitly — an omitted code would quietly transcribe English as Hindi.

import { config } from '../config.js';
import { detectLanguage } from '../conversation/language.js';
import type { SupportedLanguage } from '../conversation/language.js';
import type { SttAdapter, SttTranscriptionOptions, TranscriptionResult } from './types.js';
import { plymaxxFetchJson, PlymaxxRequestError } from './plymaxx-client.js';
import { parseWav } from './wav-utils.js';

const ADAPTER = 'PlymaxxSttAdapter';
const MAX_BYTES = 16 * 1024 * 1024; // documented upload ceiling
const MAX_SECONDS = 30; // documented clip ceiling

const LANGUAGE_CODES: Record<SupportedLanguage, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
};

/** Whisper reports BCP-47-ish codes; map the ones this product supports. */
function toSupportedLanguage(code: string | undefined): SupportedLanguage | undefined {
  if (!code) return undefined;
  const base = code.toLowerCase().split(/[-_]/)[0];
  return base === 'en' || base === 'hi' || base === 'gu' ? base : undefined;
}

function modelFor(hint: SupportedLanguage | undefined): { model: string; language: string } {
  if (hint === 'gu') return { model: config.AI_STT_MODEL_GU, language: 'gu' };
  if (hint === 'hi') return { model: config.AI_STT_MODEL_HI, language: 'hi' };
  if (hint === 'en') return { model: config.AI_STT_MODEL_EN, language: 'en' };
  return { model: config.AI_STT_MODEL_AUTO, language: 'auto' };
}

/**
 * Whisper degenerates into a repetition loop on near-silence or badly matched
 * audio. Observed directly: English audio forced through the Hindi route came
 * back as "हलो, एप लोग लोग लोग लोग …" for 40+ words.
 *
 * Detection counts the longest CONSECUTIVE repetition, not overall word
 * frequency. Frequency alone punishes ordinary speech: a caller reading a
 * phone number with six zeros is 60% one word, and discarding that would
 * silently block phone and PIN capture — the one place a transcript matters
 * most. A model loop instead repeats the same token back to back, many times.
 */
export function looksLikeTranscriptionLoop(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;

  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run > longestRun) longestRun = run;
  }
  return longestRun >= 8;
}

function assertWithinLimits(audio: Buffer, format: 'webm' | 'wav'): void {
  if (audio.length > MAX_BYTES) {
    throw new PlymaxxRequestError(
      `${ADAPTER}: utterance is ${(audio.length / 1024 / 1024).toFixed(1)} MiB, over the ${MAX_BYTES / 1024 / 1024} MiB limit.`,
      'input',
      null,
    );
  }
  if (format !== 'wav') return;
  try {
    const parsed = parseWav(audio);
    const bytesPerSecond = parsed.sampleRate * parsed.numChannels * (parsed.bitsPerSample / 8);
    if (bytesPerSecond > 0 && parsed.pcm.length / bytesPerSecond > MAX_SECONDS) {
      throw new PlymaxxRequestError(`${ADAPTER}: utterance is longer than the ${MAX_SECONDS}s limit.`, 'input', null);
    }
  } catch (err) {
    if (err instanceof PlymaxxRequestError) throw err;
    // Not a WAV we can measure — let the server enforce its own limit.
  }
}

interface TranscriptionPayload {
  text?: string;
  language?: string;
  detected_language?: string;
}

export class PlymaxxSttAdapter implements SttAdapter {
  async transcribe(audio: Buffer, opts?: SttTranscriptionOptions): Promise<TranscriptionResult> {
    const hint = opts?.languageHint;
    const { model, language } = modelFor(hint);
    const format = opts?.format ?? 'webm';
    assertWithinLimits(audio, format);

    const form = new FormData();
    form.append('model', model);
    form.append('language', language);
    // verbose_json carries the detected language back, which is what lets an
    // unknown-language turn resolve itself instead of guessing.
    form.append('response_format', 'verbose_json');
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: format === 'wav' ? 'audio/wav' : 'audio/webm' }),
      `utterance.${format}`,
    );

    // The deadline covers reading the body too: SttTranscriptionOptions carries
    // no AbortSignal, and the streaming routes drop a stale turn's transcript
    // rather than aborting the upload, so a stalled response must not hang.
    const payload = await plymaxxFetchJson<TranscriptionPayload>({
      adapterName: ADAPTER,
      url: config.AI_TRANSCRIBE_URL,
      body: form,
      timeoutMs: config.VOICE_STT_TIMEOUT_MS,
    });

    const text = (payload.text ?? '').trim();

    // While the caller is collecting digits, a repeated token is far more
    // likely to be a real answer than a model loop, so leave it alone.
    if (text && !opts?.expectedInput && looksLikeTranscriptionLoop(text)) {
      // eslint-disable-next-line no-console
      console.warn(`[plymaxx-stt] discarded a degenerate ${language} transcription (repetition loop).`);
      return { text: '' };
    }

    // Prefer what the recognizer reported; fall back to script detection when
    // the model does not report one (the Indic route returns no language).
    const reported = toSupportedLanguage(payload.language ?? payload.detected_language);
    const detectedLanguage = reported ?? detectLanguage(text) ?? undefined;

    return {
      text,
      ...(detectedLanguage
        ? { detectedLanguage, detectedLanguageCode: LANGUAGE_CODES[detectedLanguage] }
        : {}),
    };
  }
}
