import OpenAI from 'openai';
import { config } from '../config.js';
import type { TtsAdapter } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';
import { splitSentences, stitchWavs } from './wav-utils.js';

// OpenAI TTS is used for English only (in TTS_PROVIDER=auto mode) — its
// English output is noticeably more natural than Sarvam bulbul:v3. Hindi
// and Gujarati go to SarvamTtsAdapter. See providers.ts buildTtsForLanguage().
//
// Model: tts-1 (faster, adequate quality for voice conversations)
// Voice: nova — warm, natural, female; closest to a customer-service agent.
const TTS_MODEL = 'tts-1';
const TTS_VOICE = 'nova';
const SILENCE_GAP_MS = 80;

let singleton: OpenAI | null = null;
function getClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  return singleton;
}

async function synthesizeOne(text: string): Promise<Buffer> {
  const response = await getClient().audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    response_format: 'wav',
  });
  return Buffer.from(await response.arrayBuffer());
}

export class OpenAiTtsAdapter implements TtsAdapter {
  async synthesize(text: string, _language: SupportedLanguage): Promise<Buffer> {
    const clipped = text.length > 4096 ? text.slice(0, 4096) : text;
    const sentences = splitSentences(clipped);

    if (sentences.length === 1) {
      return synthesizeOne(sentences[0]);
    }

    // Synthesize all sentences in parallel — the first sentence starts
    // arriving in the same time as one sequential call would take,
    // saving (n-1) × ~500ms for a typical 3-sentence reply.
    const wavBuffers = await Promise.all(sentences.map(synthesizeOne));
    return stitchWavs(wavBuffers, SILENCE_GAP_MS);
  }
}
