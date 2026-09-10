import { describe, it, expect } from 'vitest';
import {
  limitSpokenReply,
  MAX_SPOKEN_REPLY_CHARS,
  normalizeIndicSpeechText,
  toSpokenText,
} from '../../src/conversation/speech-format.js';

describe('toSpokenText', () => {
  it('strips bold markers', () => {
    expect(toSpokenText('**Alpha** is available')).toBe('Alpha is available');
  });

  it('strips a numbered list into comma-separated speech', () => {
    const input = '1. Alpha\n2. Moringa Tablets\n3. Wellness Supplement';
    expect(toSpokenText(input)).toBe('Alpha, Moringa Tablets, Wellness Supplement');
  });

  it('strips bullet markers', () => {
    const input = '- Alpha\n- Moringa Tablets';
    expect(toSpokenText(input)).toBe('Alpha, Moringa Tablets');
  });

  it('strips markdown headings', () => {
    expect(toSpokenText('# Products\nWe have a few')).toBe('Products, We have a few');
  });

  it('strips inline code/backticks', () => {
    expect(toSpokenText('the field is `email`')).toBe('the field is email');
  });

  it('leaves plain conversational text untouched', () => {
    const input = "Alpha is one hundred milligrams, and it's ninety-nine rupees.";
    expect(toSpokenText(input)).toBe(input);
  });

  it('collapses a paragraph break into a sentence separator', () => {
    expect(toSpokenText('First part.\n\nSecond part.')).toBe('First part. Second part.');
  });

  it('removes stray punctuation that creates unnatural Hindi TTS pauses', () => {
    expect(toSpokenText('हमारे पास प्रोडक्ट्स हैं। . पहला Alpha है।')).toBe('हमारे पास प्रोडक्ट्स हैं। पहला Alpha है।');
    expect(toSpokenText('तीन प्रोडक्ट्स हैं:, Alpha, Beta')).toBe('तीन प्रोडक्ट्स हैं: Alpha, Beta');
  });

  it('keeps at most two sentences for a live phone reply', () => {
    expect(limitSpokenReply('First answer. Second answer. Third answer.')).toBe('First answer. Second answer.');
  });

  it('applies a word-safe hard ceiling to an overlong reply', () => {
    const result = limitSpokenReply(`This is ${'a useful detail '.repeat(30)}`);
    expect(result.length).toBeLessThanOrEqual(MAX_SPOKEN_REPLY_CHARS);
    expect(result.endsWith('.')).toBe(true);
    expect(result.endsWith(' detai.')).toBe(false);
  });
});

describe('normalizeIndicSpeechText', () => {
  it('corrects recurring Gujarati agreement and doubled-particle artifacts', () => {
    expect(normalizeIndicSpeechText('અમારા પાસે Morilife+ છે. આ ટેબ્લેટ્સ એ એન્ટીઓક્સિડન્ટ્સથી ભરપૂર છે.', 'gu'))
      .toBe('અમારી પાસે મોરીલાઇફ પ્લસ છે. આ ટેબ્લેટ્સ એન્ટીઓક્સિડન્ટ્સથી ભરપૂર છે.');
  });

  it('does not rewrite English or Hindi text', () => {
    expect(normalizeIndicSpeechText('We have one product.', 'en')).toBe('We have one product.');
    expect(normalizeIndicSpeechText('हमारे पास एक प्रोडक्ट है।', 'hi')).toBe('हमारे पास एक प्रोडक्ट है।');
  });

  it('changes recurring male Hindi self-reference into the female voice persona', () => {
    expect(normalizeIndicSpeechText('मैं मदद करता हूं और जानकारी लूंगा।', 'hi'))
      .toBe('मैं मदद करती हूँ और जानकारी लूँगी।');
    expect(normalizeIndicSpeechText('मैं यह कर दूंगा और फिर बताऊंगा।', 'hi'))
      .toBe('मैं यह कर दूँगी और फिर बताऊँगी।');
  });

  it('speaks phone numbers and PIN codes digit by digit in the active Indic language', () => {
    expect(normalizeIndicSpeechText('आपका नंबर 7984-7694-72 है।', 'hi'))
      .toBe('आपका नंबर सात, नौ, आठ, चार, सात, छह, नौ, चार, सात, दो है।');
    expect(normalizeIndicSpeechText('તમારો પિન ૩૮૪૪૭૦ છે.', 'gu'))
      .toBe('તમારો પિન ત્રણ, આઠ, ચાર, ચાર, સાત, શૂન્ય છે.');
  });
});
