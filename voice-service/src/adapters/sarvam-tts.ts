import type { SarvamAIClient } from 'sarvamai';
import { requireSarvamKeys, withSarvamClient } from './sarvam-client.js';
import { config } from '../config.js';
import type { TtsAdapter } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';
import { splitSentences, stitchWavs } from './wav-utils.js';

// bulbul:v3 (default model) returns `audios: string[]` — base64-encoded WAV.
//
// Keep the request type derived from the installed SDK so model and codec
// fields stay aligned with the version used in production.
type TtsConvertParams = Parameters<SarvamAIClient['textToSpeech']['convert']>[0];

const SUPPORTED_TO_BCP47: Record<SupportedLanguage, 'en-IN' | 'hi-IN' | 'gu-IN'> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
};

// Empirically tuned per-language pace from the reference project at
// D:\Work\Sun\Agent after direct comparison against the default (1.0).
const PACE_BY_LANGUAGE: Record<SupportedLanguage, number> = {
  en: 1.15,
  hi: 1.2,
  gu: 1.15,
};

// Lower temperature = more stable/consistent output, fewer word-mixing
// artifacts. Default is 0.6; 0.3 is the fix for garbled long replies.
const TTS_TEMPERATURE = 0.3;
const SILENCE_GAP_MS = 100;

export class SarvamTtsAdapter implements TtsAdapter {
  constructor() {
    requireSarvamKeys();
  }

  private async synthesizeOne(text: string, language: SupportedLanguage): Promise<Buffer> {
    const rawRequest = {
      text,
      language_code: SUPPORTED_TO_BCP47[language],
      model: 'bulbul:v3',
      speaker: config.SARVAM_TTS_SPEAKER,
      pace: PACE_BY_LANGUAGE[language],
      temperature: TTS_TEMPERATURE,
      speech_sample_rate: 24000,
      output_audio_codec: 'wav',
    };
    const response = await withSarvamClient((client, requestOptions) => client.textToSpeech.convert(
      rawRequest as unknown as TtsConvertParams,
      requestOptions,
    ), config.VOICE_TTS_TIMEOUT_MS);
    const audioBase64 = response.audios[0];
    if (!audioBase64) throw new Error('Sarvam textToSpeech.convert returned no audio.');
    return Buffer.from(audioBase64, 'base64');
  }

  async synthesize(text: string, language: SupportedLanguage): Promise<Buffer> {
    // bulbul:v3 caps at 2500 characters.
    const clipped = text.length > 2500 ? text.slice(0, 2500) : text;
    const sentences = splitSentences(clipped);

    if (sentences.length === 1) {
      return this.synthesizeOne(sentences[0], language);
    }

    // Sarvam is more reliable per-sentence than on a long paragraph AND
    // parallel calls cut total TTS time from (n × ~600ms) to ~600ms.
    const wavBuffers = await Promise.all(sentences.map((s) => this.synthesizeOne(s, language)));
    return stitchWavs(wavBuffers, SILENCE_GAP_MS);
  }

  async synthesizeMulaw8k(text: string, language: SupportedLanguage): Promise<Buffer> {
    const clipped = text.length > 2500 ? text.slice(0, 2500) : text;
    const sentences = splitSentences(clipped);
    const chunks = await Promise.all(sentences.map(async (sentence) => {
      const request = {
        text: sentence,
        language_code: SUPPORTED_TO_BCP47[language],
        model: 'bulbul:v3',
        speaker: config.SARVAM_TTS_SPEAKER,
        pace: PACE_BY_LANGUAGE[language],
        temperature: TTS_TEMPERATURE,
        speech_sample_rate: 8000,
        output_audio_codec: 'mulaw',
      };
      const response = await withSarvamClient((client, requestOptions) => client.textToSpeech.convert(
        request as unknown as TtsConvertParams,
        requestOptions,
      ), config.VOICE_TTS_TIMEOUT_MS);
      const audioBase64 = response.audios[0];
      if (!audioBase64) throw new Error('Sarvam textToSpeech.convert returned no mu-law audio.');
      return Buffer.from(audioBase64, 'base64');
    }));

    const silence = Buffer.alloc(Math.round(8000 * SILENCE_GAP_MS / 1_000), 0xff);
    return Buffer.concat(chunks.flatMap((chunk, index) => index === 0 ? [chunk] : [silence, chunk]));
  }
}
