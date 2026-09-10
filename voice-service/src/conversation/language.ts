// Deterministic, per-turn language detection — runs OUTSIDE the LLM, same
// principle as output-policy.ts: the model is told which language to reply
// in for this turn, not left to infer it from vibes every time. This is a
// heuristic (Unicode script counting + a small romanized-word list for
// Latin-script Hindi/Gujarati, which is extremely common in India), not a
// full language-ID model — good enough to steer a reply, not to gate safety
// on. If detection is uncertain, it returns null and the model falls back
// to its own judgment (usually: keep replying in whatever language the
// conversation has already been using).

export type SupportedLanguage = 'en' | 'hi' | 'gu';

const LANG_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  gu: 'Gujarati (Gujarati Unicode script)',
};

const LANG_RULES: Record<SupportedLanguage, string> = {
  en: 'Reply entirely in English.',
  hi:
    'Reply in simple, everyday spoken Hindi using Devanagari script. Use familiar Hinglish words such as ' +
    'प्रोडक्ट, ऑर्डर, प्राइस, सिटी, स्टेट, फोन, ईमेल, पेमेंट, और एड्रेस instead of formal or literary Hindi. ' +
    'Write every Hindi word in Devanagari, not Romanized Hindi, because native script is required for clear text-to-speech. ' +
    'Write ordinary numbers as Hindi words, not digits. ' +
    'The assistant has a female voice, so every Hindi first-person verb must be feminine: use करती हूँ, दूँगी, लूँगी, and बताऊँगी; never करता हूँ, दूँगा, लूँगा, or बताऊँगा. ' +
    'Keep only brand/product names (e.g. Earthora, Morilife+) in their normal Roman spelling.',
  gu:
    'Reply in simple, everyday spoken Gujarati using Gujarati Unicode script. Avoid formal, literary, or word-for-word translated phrasing. ' +
    'Write every Gujarati word in Gujarati script, not Romanized Gujarati, because native script is required for clear text-to-speech. ' +
    'Write ordinary numbers as Gujarati words, not digits. ' +
    'Keep only brand/product names (e.g. Earthora, Morilife+) in their normal Roman spelling.',
};

// Small, general-purpose romanized word lists — enough to catch common
// Latin-script Hindi/Gujarati phrasing ("kitna hai", "shu che"), not a
// domain-specific vocabulary. Extend if real usage shows systematic misses.
const ROMAN_HI_WORDS = new Set([
  'hai', 'hain', 'nahi', 'nahin', 'kya', 'kyun', 'kaise', 'kitna', 'kitne', 'kitni',
  'chahiye', 'mujhe', 'aap', 'aapka', 'aapki', 'karna', 'karo', 'batao', 'bataiye',
  'dijiye', 'accha', 'theek', 'haan', 'shukriya', 'dhanyavaad', 'kab', 'kahan',
  'faayda', 'faayde', 'fayda', 'fayde', 'nuksan', 'keemat', 'kimat', 'daam',
]);
const ROMAN_GU_WORDS = new Set([
  'che', 'chhe', 'nathi', 'shu', 'kem', 'keva', 'ketla', 'ketli', 'joie', 'jarur',
  'su', 'shun', 'mane', 'mare', 'tamaru', 'tamne', 'saru', 'thay', 'pachi', 'malse', 'kya', 'haji',
  'janvu', 'jaanvu', 'janu', 'jaanu', 'kimat', 'kimmat', 'bhav', 'faayda', 'fayda',
  'gerfaayda', 'gerfayda', 'nuksan', 'ma', 'ni', 'no', 'na',
]);

// Field values must not change the language of the conversation. In real
// Smartflo transcripts, callers often spell an email address or say English
// digit names rendered in Devanagari/Gujarati script (for example
// "थ्री एट टू" or "થ્રી એટ ટુ"). Those are data, not a request to switch
// languages.
const SPOKEN_DIGIT_TOKENS = new Set([
  'zero', 'oh', 'o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'शून्य', 'जीरो', 'ज़ीरो', 'वन', 'टू', 'थ्री', 'फोर', 'फाइव', 'सिक्स', 'सेवन', 'सैवन', 'एट', 'आर्ट', 'नाइन',
  'एक', 'दो', 'तीन', 'चार', 'पांच', 'पाँच', 'छह', 'छः', 'सात', 'आठ', 'नौ',
  'શૂન્ય', 'ઝીરો', 'વન', 'ટુ', 'ટૂ', 'થ્રી', 'ફોર', 'ફાઇવ', 'સિક્સ', 'સેવન', 'એટ', 'એઇટ', 'નાઇન',
  'એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ', 'છ', 'સાત', 'આઠ', 'નવ',
  'shunya', 'sunya', 'ek', 'do', 'teen', 'tin', 'char', 'chaar', 'panch', 'paanch',
  'chhah', 'chha', 'saat', 'sat', 'aath', 'ath', 'nau', 'be', 'tran', 'nav',
]);

function isFieldValueOnly(text: string): boolean {
  if (/@|https?:\/\//iu.test(text)) return true;
  const tokens = text.toLowerCase().match(/[a-z]+|[\u0900-\u097f]+|[\u0a80-\u0aff]+|\d+/gu) ?? [];
  return tokens.length > 0 && tokens.every((token) => /^\d+$/u.test(token) || SPOKEN_DIGIT_TOKENS.has(token));
}

/**
 * Returns the detected language code, or null if it can't be determined
 * with reasonable confidence from this one utterance (too short, ambiguous
 * script mix, no romanized keyword hits).
 */
export function detectLanguage(text: string): SupportedLanguage | null {
  const t = text.trim();
  if (!t || t.length < 3) return null;
  if (isFieldValueOnly(t)) return null;

  const guChars = (t.match(/[઀-૿]/g) ?? []).length; // Gujarati Unicode block
  const hiChars = (t.match(/[ऀ-ॿ]/g) ?? []).length; // Devanagari Unicode block
  const latChars = (t.match(/[a-zA-Z]/g) ?? []).length;
  const total = guChars + hiChars + latChars;
  if (total < 3) return null;

  if (guChars > hiChars && guChars > latChars / 3) return 'gu';
  if (hiChars > guChars && hiChars > latChars / 3) return 'hi';
  if (latChars > 0) {
    const words = new Set(t.toLowerCase().match(/[a-z]+/g) ?? []);
    const guHits = [...ROMAN_GU_WORDS].filter((w) => words.has(w)).length;
    const hiHits = [...ROMAN_HI_WORDS].filter((w) => words.has(w)).length;
    if (guHits >= 2 && guHits > hiHits) return 'gu';
    if (hiHits >= 2 && hiHits > guHits) return 'hi';
    if (guHits >= 2 && hiHits >= 2) return null;
    // Don't switch to English on short Latin-only utterances — a single city
    // name ("Ahmedabad"), a yes/no answer, or any ≤ 2-word reply during
    // Hindi/Gujarati checkout would incorrectly flip the language and make the
    // agent switch to English mid-conversation. Require ≥ 3 distinct words to
    // be confident this is actually English, not a proper noun or short answer.
    if (words.size >= 3) return 'en';
    return null; // ambiguous — caller keeps the language already in use
  }
  return null;
}

/** Builds the per-turn system instruction injected into the conversation for a detected language. */
export function buildLanguageInstruction(lang: SupportedLanguage): string {
  return (
    `RESPONSE LANGUAGE FOR THIS REPLY: ${LANG_NAMES[lang]}.\n` +
    `${LANG_RULES[lang]} This is a hard requirement, not a preference. Keep every user-facing sentence ` +
    'consistent with this language and speaking style. This only changes the language you speak in — every price, stock level, and product ' +
    "fact must still come only from this turn's tool results, same as always."
  );
}

/** Convenience wrapper: detect + build in one call, or null if undetermined. */
export function detectLanguageHint(text: string): string | null {
  const lang = detectLanguage(text);
  return lang ? buildLanguageInstruction(lang) : null;
}

/** Explicit preferences can change language even during checkout. Mere place/name values cannot. */
export function requestedLanguage(text: string): SupportedLanguage | null {
  const t = text.toLowerCase().trim();
  const request = /\b(?:speak|talk|reply|respond|continue|switch|please|bolo|boliye|baat|vato)\b|बोल|बात|जवाब|बताइ|बता|બોલ|વાત|જવાબ/u;
  if (!request.test(t)) return null;
  if (/\b(?:english|angrezi)\b|अंग्रेज़ी|अंग्रेजी|અંગ્રેજી/u.test(t)) return 'en';
  if (/\bhindi\b|हिंदी|हिन्दी|હિન્દી/u.test(t)) return 'hi';
  if (/\bgujarati\b|गुजराती|ગુજરાતી/u.test(t)) return 'gu';
  return null;
}

/** Script-level guard, not a full language classifier. Brand names in Latin are allowed in Indic replies. */
export function replyMatchesLanguage(text: string, language: SupportedLanguage): boolean {
  for (const char of text) {
    if (/\p{L}/u.test(char) && !/[A-Za-z\u0900-\u097F\u0A80-\u0AFF]/u.test(char)) return false;
  }
  const hi = /[\u0900-\u097F]/u.test(text);
  const gu = /[\u0A80-\u0AFF]/u.test(text);
  if (language === 'en') return !hi && !gu;
  if ((language === 'hi' && gu) || (language === 'gu' && hi)) return false;
  // A full English sentence must not be spoken through a Hindi/Gujarati voice.
  if ((text.match(/[a-z]+/gi) ?? []).length >= 4 && !(language === 'hi' ? hi : gu)) return false;
  return true;
}
