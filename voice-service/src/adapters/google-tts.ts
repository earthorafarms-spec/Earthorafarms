import { config } from '../config.js';
import { AdapterNotConfiguredError, type TtsAdapter } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

/**
 * Real interface, stub implementation — see google-stt.ts for the
 * rationale. Sarvam (adapters/sarvam-tts.ts) is the real, currently-active
 * TTS implementation. When implementing this for real, use
 * @google-cloud/text-to-speech; nothing upstream needs to change.
 */
export class GoogleTtsAdapter implements TtsAdapter {
  async synthesize(_text: string, _language: SupportedLanguage): Promise<Buffer> {
    if (!config.googleSttTtsConfigured) {
      throw new AdapterNotConfiguredError(
        'GoogleTtsAdapter',
        'GOOGLE_CLOUD_PROJECT_ID/GOOGLE_APPLICATION_CREDENTIALS_JSON are unset. Use TTS_PROVIDER=sarvam instead.'
      );
    }
    throw new Error('GoogleTtsAdapter is configured but not yet implemented.');
  }
}
