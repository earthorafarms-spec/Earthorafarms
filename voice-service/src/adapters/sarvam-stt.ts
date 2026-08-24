import { SarvamAIClient } from 'sarvamai';
import { config } from '../config.js';
import type { SttAdapter, TranscriptionResult } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

// Verified against the installed `sarvamai` SDK's type definitions before
// writing this (SpeechToTextTranscriptionRequest/-Response) — not guessed.
// saarika:v2.5 (the default model) supports en-IN/hi-IN/gu-IN plus 9 other
// Indian languages, and auto-detects when language_code is 'unknown' or
// omitted — used here so a caller never has to pre-select a language before
// speaking. WebM (the format browsers' MediaRecorder produces by default)
// is in Sarvam's documented list of auto-detected container formats.
const BCP47_TO_SUPPORTED: Record<string, SupportedLanguage> = {
  'en-IN': 'en',
  'hi-IN': 'hi',
  'gu-IN': 'gu',
};

export class SarvamSttAdapter implements SttAdapter {
  private client: SarvamAIClient;

  constructor() {
    if (!config.SARVAM_API_KEY) {
      throw new Error('SARVAM_API_KEY is not set — cannot use STT_PROVIDER=sarvam.');
    }
    this.client = new SarvamAIClient({ apiSubscriptionKey: config.SARVAM_API_KEY });
  }

  async transcribe(audio: Buffer, opts?: { languageHint?: SupportedLanguage; format?: 'webm' | 'wav' }): Promise<TranscriptionResult> {
    const format = opts?.format ?? 'webm';
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/webm';

    const response = await this.client.speechToText.transcribe({
      file: { data: audio, filename: `utterance.${format}`, contentType },
      // Always let Sarvam auto-detect rather than pin to languageHint — a
      // caller switching languages mid-call must be picked up from their
      // actual speech, not overridden by what the last turn happened to be.
      language_code: 'unknown',
    });

    const detectedLanguage = response.language_code ? BCP47_TO_SUPPORTED[response.language_code] : undefined;

    return { text: response.transcript, detectedLanguage };
  }
}
