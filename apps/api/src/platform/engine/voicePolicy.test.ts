import { describe, expect, it } from 'vitest';
import { checkVoiceOutput, collectLiveAmounts, safeVoiceReply, spokenLanguageInstruction } from './voicePolicy.js';

describe('validated Indian female voice replies', () => {
  it('blocks unsupported prices, including Hindi and Gujarati digits', () => {
    const prices = collectLiveAmounts([{ price: 499, mrp: 599, stock: 999 }]);
    expect(checkVoiceOutput('The price is ₹ 499.', prices).ok).toBe(true);
    for (const text of ['It costs ₹999.', 'The price is 999.', '९९९ रुपये', '૯૯૯ રૂપિયા', 'Rs. 999']) expect(checkVoiceOutput(text, prices)).toEqual({ ok: false, reason: 'ungrounded-price' });
  });
  it('blocks sensitive requests and finalization claims in each spoken language', () => {
    for (const text of ['Payment received.', 'आपका ऑर्डर कन्फर्म हो गया।', 'તમારી ચુકવણી સફળ થઈ ગઈ.', 'ओटीपी बताएं', 'તમારો કાર્ડ નંબર આપો']) expect(checkVoiceOutput(text, new Set()).ok).toBe(false);
  });
  it('keeps Hinglish pronunciation and one female persona with neutral safe replies', () => {
    expect(spokenLanguageInstruction('hi')).toContain('Hinglish');
    expect(spokenLanguageInstruction('hi')).toContain('कर सकती हूँ');
    for (const lang of ['en', 'hi', 'gu']) expect(checkVoiceOutput(safeVoiceReply(lang), new Set()).ok).toBe(true);
  });
  it('requires actual reply script to match the current language while allowing Hindi-English mixing', () => {
    expect(checkVoiceOutput('नमस्ते, आपका order number बताएं।', new Set(), 'en')).toEqual({ ok: false, reason: 'language-mismatch' });
    expect(checkVoiceOutput('How can I help?', new Set(), 'gu')).toEqual({ ok: false, reason: 'language-mismatch' });
    expect(checkVoiceOutput('હું મદદ કરી શકું છું.', new Set(), 'hi')).toEqual({ ok: false, reason: 'language-mismatch' });
    expect(checkVoiceOutput('मैं आपका order status check कर सकती हूँ।', new Set(), 'hi').ok).toBe(true);
    for (const lang of ['en', 'hi', 'gu']) expect(checkVoiceOutput(safeVoiceReply(lang, 'language-mismatch'), new Set(), lang).ok).toBe(true);
  });
});
