import { requireSarvamKeys, withSarvamClient } from './sarvam-client.js';
import { config } from '../config.js';
import type { SttAdapter, SttTranscriptionOptions, TranscriptionResult } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

// Verified against the installed `sarvamai` SDK's type definitions before
// writing this (SpeechToTextTranscriptionRequest/-Response) — not guessed.
// Saaras v3 is pinned in config instead of inheriting a moving provider
// default. Auto-detection permits supported language switching. Unsupported
// detections remain visible to the transcript guard and are rejected instead
// of being relabelled by a forced-language retry. Low-confidence supported
// detections are retried once using the conversation language.
const BCP47_TO_SUPPORTED: Record<string, SupportedLanguage> = {
  'en-IN': 'en',
  'hi-IN': 'hi',
  'gu-IN': 'gu',
};
const SUPPORTED_TO_BCP47: Record<SupportedLanguage, 'en-IN' | 'hi-IN' | 'gu-IN'> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
};

export class SarvamSttAdapter implements SttAdapter {
  constructor() {
    requireSarvamKeys();
  }

  async transcribe(audio: Buffer, opts?: SttTranscriptionOptions): Promise<TranscriptionResult> {
    const format = opts?.format ?? 'webm';
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/webm';

    // Numeric turns are especially vulnerable to auto-language mistakes
    // (for example Hindi "teen" being heard as another number). Once the
    // conversation language is known, pin only those turns to that language.
    const requestedCode = opts?.expectedInput && opts.languageHint
      ? SUPPORTED_TO_BCP47[opts.languageHint]
      : 'unknown';
    const response = await withSarvamClient((client, requestOptions) => client.speechToText.transcribe({
      file: { data: audio, filename: `utterance.${format}`, contentType },
      model: config.SARVAM_STT_MODEL,
      mode: 'transcribe',
      language_code: requestedCode,
    }, requestOptions), config.VOICE_STT_TIMEOUT_MS);

    const autoCode = response.language_code;
    const probability = response.language_probability;
    const unsupportedLanguage = Boolean(autoCode && !BCP47_TO_SUPPORTED[autoCode]);
    const lowConfidence = probability !== undefined && probability < config.SARVAM_STT_MIN_LANGUAGE_PROBABILITY;

    if (!opts?.expectedInput && opts?.languageHint && !unsupportedLanguage && lowConfidence) {
      const languageHint = opts.languageHint;
      const retry = await withSarvamClient((client, requestOptions) => client.speechToText.transcribe({
        file: { data: audio, filename: `utterance.${format}`, contentType },
        model: config.SARVAM_STT_MODEL,
        mode: 'transcribe',
        language_code: SUPPORTED_TO_BCP47[languageHint],
      }, requestOptions), config.VOICE_STT_TIMEOUT_MS);

      return {
        text: retry.transcript,
        detectedLanguage: opts.languageHint,
        detectedLanguageCode: SUPPORTED_TO_BCP47[opts.languageHint],
        languageProbability: probability,
        wasRetried: true,
      };
    }

    const detectedLanguage = autoCode ? BCP47_TO_SUPPORTED[autoCode] : opts?.languageHint;

    return {
      text: response.transcript,
      detectedLanguage,
      detectedLanguageCode: autoCode,
      languageProbability: probability,
      wasRetried: false,
    };
  }
}
