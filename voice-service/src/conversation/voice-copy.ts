import type { SupportedLanguage } from './language.js';

const REPEAT_PROMPTS: Record<SupportedLanguage, string> = {
  en: "Sorry, I didn't catch that clearly. Please say it again.",
  hi: 'माफ कीजिए, बात साफ़ समझ नहीं आई। कृपया दोबारा बताइए।',
  gu: 'માફ કરશો, વાત સ્પષ્ટ સમજાઈ નહીં. કૃપા કરીને ફરી કહો.',
};

const TURN_FAILURE_PROMPTS: Record<SupportedLanguage, string> = {
  en: "Sorry, I'm having trouble with that request. Could you say it another way?",
  hi: 'माफ कीजिए, यह बात समझने में दिक्कत हो रही है। कृपया आसान शब्दों में दोबारा बताइए।',
  gu: 'માફ કરશો, આ વાત સમજવામાં મુશ્કેલી થઈ રહી છે. કૃપા કરીને બીજી રીતે કહો.',
};

export function repeatPrompt(language: SupportedLanguage): string {
  return REPEAT_PROMPTS[language];
}

export function turnFailurePrompt(language: SupportedLanguage): string {
  return TURN_FAILURE_PROMPTS[language];
}
