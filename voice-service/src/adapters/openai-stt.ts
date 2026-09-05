import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';
import { detectLanguage } from '../conversation/language.js';
import { normalizeVoiceTranscript } from '../conversation/transcript.js';
import type { SttAdapter, TranscriptionResult } from './types.js';
import type { SupportedLanguage } from '../conversation/language.js';

const LANGUAGE_CODES: Record<SupportedLanguage, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  gu: 'gu-IN',
};

const TRANSCRIPTION_CONTEXT: Record<SupportedLanguage, string> = {
  en: 'An Earthora Farms ordering call in English, Hindi or Gujarati. Transcribe only audible speech, without translation. Short answers, quantities and Indian place names are valid. Do not complete fragments or invent speech during silence.',
  hi: 'Earthora Farms का ऑर्डर कॉल। हिंदी, English या ગુજરાતી में कही गई बात ही लिखें, अनुवाद न करें। छोटे जवाब, संख्या और जगहों के नाम भी सही जवाब हैं। अधूरी बात को पूरा न करें, चुप्पी में शब्द न जोड़ें।',
  gu: 'Earthora Farms નો ઓર્ડર કોલ. ગુજરાતી, Hindi અથવા English માં સાંભળેલી વાત જ લખો, અનુવાદ ન કરો. ટૂંકા જવાબો, સંખ્યાઓ અને સ્થળના નામ પણ માન્ય છે. અધૂરી વાત પૂરી ન કરો, મૌનમાં શબ્દો ન ઉમેરો.',
};

// Keep the first attempt multilingual; retry unrelated scripts with the
// conversation's language hint, within the ORIGINAL per-turn deadline.
export class OpenAiSttAdapter implements SttAdapter {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 0 });

  async transcribe(
    audio: Buffer,
    opts?: { languageHint?: SupportedLanguage; format?: 'webm' | 'wav' }
  ): Promise<TranscriptionResult> {
    const format = opts?.format ?? 'webm';
    const contentType = format === 'wav' ? 'audio/wav' : 'audio/webm';
    const file = await toFile(audio, `utterance.${format}`, { type: contentType });
    const startedAt = Date.now();
    const request = {
      file,
      model: config.OPENAI_STT_MODEL,
      response_format: 'json' as const,
      prompt: TRANSCRIPTION_CONTEXT[opts?.languageHint ?? 'en'],
    };
    let response = await this.client.audio.transcriptions.create(request, { timeout: config.VOICE_STT_TIMEOUT_MS });
    let wasRetried = false;
    const decision = normalizeVoiceTranscript({ text: response.text });
    const remainingMs = config.VOICE_STT_TIMEOUT_MS - (Date.now() - startedAt);
    if (!decision.accepted && decision.reason === 'unsupported_script' && opts?.languageHint && remainingMs >= 500) {
      wasRetried = true;
      response = await this.client.audio.transcriptions.create({
        ...request,
        language: opts.languageHint,
      }, { timeout: remainingMs });
    }

    const detectedLanguage = detectLanguage(response.text) ?? undefined;
    return {
      text: response.text,
      wasRetried,
      detectedLanguage,
      detectedLanguageCode: detectedLanguage ? LANGUAGE_CODES[detectedLanguage] : undefined,
    };
  }
}
