import { describe, expect, it } from 'vitest';
import { normalizeVoiceTranscript } from '../../src/conversation/transcript.js';

describe('normalizeVoiceTranscript', () => {
  it('drops the Kannada hallucination observed on a production phone call', () => {
    expect(normalizeVoiceTranscript({
      text: 'ಅಕ್ಕ ಇರ್ತಾ ಇರೋದು',
      detectedLanguageCode: 'kn-IN',
    })).toEqual({ accepted: false, reason: 'unsupported_language' });
  });

  it('drops unsupported scripts even when the provider omits a language code', () => {
    expect(normalizeVoiceTranscript({ text: 'என்னுட்ட' }))
      .toEqual({ accepted: false, reason: 'unsupported_script' });
  });

  it('drops unsupported detected languages written in Latin script', () => {
    expect(normalizeVoiceTranscript({ text: 'Waheguru Ji', detectedLanguageCode: 'pa-IN' }))
      .toEqual({ accepted: false, reason: 'unsupported_language' });
  });

  it('accepts supported Hindi and Gujarati scripts', () => {
    expect(normalizeVoiceTranscript({ text: 'मुझे अल्फा के बारे में बताइए', detectedLanguageCode: 'hi-IN' }).accepted)
      .toBe(true);
    expect(normalizeVoiceTranscript({ text: 'મને આલ્ફા વિશે કહો', detectedLanguageCode: 'gu-IN' }).accepted)
      .toBe(true);
  });

  it('normalizes real Earthora STT name mistakes', () => {
    expect(normalizeVoiceTranscript({ text: 'Products available at Arthora firms?' }))
      .toEqual({ accepted: true, text: 'Products available at Earthora Farms?' });
    expect(normalizeVoiceTranscript({ text: 'Products available at Athora Farms?' }))
      .toEqual({ accepted: true, text: 'Products available at Earthora Farms?' });
    expect(normalizeVoiceTranscript({ text: 'What is available at Ertora Farms?' }))
      .toEqual({ accepted: true, text: 'What is available at Earthora Farms?' });
  });

  it('drops punctuation-only output', () => {
    expect(normalizeVoiceTranscript({ text: '...?!' }))
      .toEqual({ accepted: false, reason: 'no_speech_content' });
  });
});
