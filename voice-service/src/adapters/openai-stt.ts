import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';
import { detectLanguage } from '../conversation/language.js';
import type { SttAdapter, TranscriptionResult } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

const LANGUAGE_CODES: Record<SupportedLanguage, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
};

/**
 * OpenAI speech-to-text fallback. This is intentionally language-neutral:
 * callers can switch between English, Hindi, and Gujarati during one call,
 * and the deterministic conversation language detector handles the returned
 * transcript before the LLM is invoked.
 */
export class OpenAiSttAdapter implements SttAdapter {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async transcribe(
    audio: Buffer,
    opts?: { languageHint?: SupportedLanguage; format?: 'webm' | 'wav' }
  ): Promise<TranscriptionResult> {
    const format = opts?.format ?? 'webm';
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/webm';
    const file = await toFile(audio, `utterance.${format}`, { type: contentType });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: config.OPENAI_STT_MODEL,
      response_format: 'json',
    }, { timeout: config.VOICE_STT_TIMEOUT_MS });

    const detectedLanguage = detectLanguage(response.text) ?? undefined;
    return {
      text: response.text,
      detectedLanguage,
      detectedLanguageCode: detectedLanguage ? LANGUAGE_CODES[detectedLanguage] : undefined,
    };
  }
}
