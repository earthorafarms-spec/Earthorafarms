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

const SILENCE_CHECK_PROMPTS: Record<SupportedLanguage, string> = {
  en: 'Are you still there? Please say something if you would like to continue.',
  hi: 'क्या आप लाइन पर हैं? जारी रखने के लिए कुछ बोलिए।',
  gu: 'શું તમે લાઇન પર છો? વાત ચાલુ રાખવા માટે કંઈક બોલો.',
};

const REVIEW_RECEIVED_PROMPTS: Record<SupportedLanguage, string> = {
  en: 'Thank you for confirming. Please review or edit the form before secure payment. Thank you for calling Earthora Farms. Goodbye.',
  hi: 'कन्फर्म करने के लिए धन्यवाद। सुरक्षित पेमेंट से पहले फॉर्म चेक या एडिट कर लीजिए। Earthora Farms से बात करने के लिए धन्यवाद। आपका दिन शुभ हो।',
  gu: 'કન્ફર્મ કરવા બદલ આભાર. સુરક્ષિત પેમેન્ટ પહેલાં ફોર્મ તપાસી અથવા બદલી લેજો. Earthora Farms સાથે વાત કરવા માટે આભાર. તમારો દિવસ શુભ રહે.',
};

export function repeatPrompt(language: SupportedLanguage): string {
  return REPEAT_PROMPTS[language];
}

export function turnFailurePrompt(language: SupportedLanguage): string {
  return TURN_FAILURE_PROMPTS[language];
}

export function silenceCheckPrompt(language: SupportedLanguage): string {
  return SILENCE_CHECK_PROMPTS[language];
}

export function reviewReceivedPrompt(language: SupportedLanguage): string {
  return REVIEW_RECEIVED_PROMPTS[language];
}
