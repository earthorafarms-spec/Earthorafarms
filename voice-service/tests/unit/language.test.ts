import { describe, it, expect } from 'vitest';
import { detectLanguageHint } from '../../src/conversation/language.js';

describe('detectLanguageHint', () => {
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
