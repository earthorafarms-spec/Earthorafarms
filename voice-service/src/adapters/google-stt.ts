import { config } from '../config.js';
import { AdapterNotConfiguredError, type SttAdapter, type TranscriptionResult } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

/**
 * Real interface, stub implementation. Google Cloud credentials are not
 * available — this deliberately does NOT contain placeholder/fake
 * transcription logic. Sarvam (adapters/sarvam-stt.ts) is the real,
 * currently-active STT implementation; this stays as a second seam in case
 * Google credentials arrive later and a comparison/fallback is wanted. When
 * implementing for real, use @google-cloud/speech's streaming recognize API
 * — conversation/controller.ts and everything downstream does not need to
 * change either way.
 */
export class GoogleSttAdapter implements SttAdapter {
  async transcribe(_audio: Buffer, _opts?: { languageHint?: SupportedLanguage; format?: 'webm' | 'wav' }): Promise<TranscriptionResult> {
    if (!config.googleSttTtsConfigured) {
      throw new AdapterNotConfiguredError(
        'GoogleSttAdapter',
        'GOOGLE_CLOUD_PROJECT_ID/GOOGLE_APPLICATION_CREDENTIALS_JSON are unset. Use STT_PROVIDER=sarvam instead.'
      );
    }
    throw new Error('GoogleSttAdapter is configured but not yet implemented.');
  }
}
