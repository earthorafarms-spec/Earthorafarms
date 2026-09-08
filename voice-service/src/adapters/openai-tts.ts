import OpenAI from 'openai';
import { config } from '../config.js';
import type { TtsAdapter } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';
import { splitSentences, stitchWavs } from './wav-utils.js';
import { wavToMulaw8k } from '../telephony/mulaw.js';

// OpenAI TTS is the primary English voice and the availability fallback for
// Hindi/Gujarati when Sarvam cannot synthesize. See buildTtsForLanguage().
//
// gpt-4o-mini-tts supports delivery instructions; unlike the old tts-1
// fallback, it can be explicitly told to use native Hindi/Gujarati rhythm
// when Sarvam is temporarily unavailable.
const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE = 'nova';
const SILENCE_GAP_MS = 80;

const DELIVERY_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  en: 'Speak as a warm female customer-service agent in clear Indian English at a calm, natural pace.',
  hi: 'Speak as a native female Hindi speaker. Use a clear neutral Indian accent, careful consonants, and a natural conversational pace. Do not draw out words or syllables. Read every number exactly as written.',
  gu: 'Speak as a native female Gujarati speaker. Use a clear neutral Gujarati accent, careful consonants, and a natural conversational pace. Do not draw out words or syllables. Read every number exactly as written.',
};

let singleton: OpenAI | null = null;
function getClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  return singleton;
}

async function synthesizeOne(text: string, language: SupportedLanguage): Promise<Buffer> {
  const response = await getClient().audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    instructions: DELIVERY_INSTRUCTIONS[language],
    speed: language === 'en' ? 1 : 1.08,
    response_format: 'wav',
  });
  return Buffer.from(await response.arrayBuffer());
}

export class OpenAiTtsAdapter implements TtsAdapter {
  async synthesize(text: string, language: SupportedLanguage): Promise<Buffer> {
    const clipped = text.length > 4096 ? text.slice(0, 4096) : text;
    const sentences = splitSentences(clipped);

    if (sentences.length === 1) {
      return synthesizeOne(sentences[0], language);
    }

    // Synthesize all sentences in parallel — the first sentence starts
    // arriving in the same time as one sequential call would take,
    // saving (n-1) × ~500ms for a typical 3-sentence reply.
    const wavBuffers = await Promise.all(sentences.map((sentence) => synthesizeOne(sentence, language)));
    return stitchWavs(wavBuffers, SILENCE_GAP_MS);
  }

  async synthesizeMulaw8k(text: string, language: SupportedLanguage): Promise<Buffer> {
    const clipped = text.length > 4096 ? text.slice(0, 4096) : text;
    return wavToMulaw8k(await synthesizeOne(clipped, language));
  }
}
