import { describe, it, expect } from 'vitest';
import { detectLanguageHint, requestedLanguage, replyMatchesLanguage } from '../../src/conversation/language.js';

describe('detectLanguageHint', () => {
  it('recognizes explicit language preferences, not place names', () => {
    expect(requestedLanguage('Please speak Hindi')).toBe('hi');
    expect(requestedLanguage('हिंदी में बात करें')).toBe('hi');
    expect(requestedLanguage('English please')).toBe('en');
    expect(requestedLanguage('ગુજરાતીમાં વાત કરો')).toBe('gu');
    expect(requestedLanguage('Ahmedabad, Gujarat')).toBeNull();
  });
  it('blocks unrelated output scripts and full English replies through Indic voices', () => {
    expect(replyMatchesLanguage('Здравствуйте!', 'hi')).toBe(false);
    expect(replyMatchesLanguage('તમારું નામ શું છે?', 'hi')).toBe(false);
    expect(replyMatchesLanguage('Hello! Please provide your correct phone number.', 'hi')).toBe(false);
    expect(replyMatchesLanguage('Morilife+ के कितने पैक चाहिए?', 'hi')).toBe(true);
    expect(replyMatchesLanguage('What is your name?', 'en')).toBe(true);
  });
  it('detects Devanagari (Hindi) script', () => {
    const hint = detectLanguageHint('इस उत्पाद की कीमत क्या है');
    expect(hint).toContain('Hindi');
  });

  it('detects Gujarati Unicode script', () => {
    const hint = detectLanguageHint('આ પ્રોડક્ટની કિંમત શું છે');
    expect(hint).toContain('Gujarati');
  });

  it('detects plain English', () => {
    const hint = detectLanguageHint('What is the price of this product?');
    expect(hint).toContain('English');
  });

  it('detects romanized Hindi via common word list', () => {
    const hint = detectLanguageHint('yeh product kitna hai aur kya milega');
    expect(hint).toContain('Hindi');
  });

  it('detects romanized Gujarati via common word list', () => {
    const hint = detectLanguageHint('a product ni kimat shu che ane ketla che');
    expect(hint).toContain('Gujarati');
  });

  it('returns null for very short/ambiguous text', () => {
    expect(detectLanguageHint('ok')).toBeNull();
    expect(detectLanguageHint('')).toBeNull();
  });

  it('always instructs the model that facts must still come from tool results', () => {
    const hint = detectLanguageHint('इस उत्पाद की कीमत क्या है');
    expect(hint).toMatch(/tool results/i);
  });
});
