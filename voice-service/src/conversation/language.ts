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
    'Keep brand/product names (e.g. Earthora, Morilife+) in their normal Roman spelling.',
  gu: 'Reply entirely in Gujarati, using Gujarati Unicode script. Keep brand/product names (e.g. Earthora, Morilife+) in their normal Roman spelling.',
};

// Small, general-purpose romanized word lists — enough to catch common
// Latin-script Hindi/Gujarati phrasing ("kitna hai", "shu che"), not a
// domain-specific vocabulary. Extend if real usage shows systematic misses.
const ROMAN_HI_WORDS = new Set([
  'hai', 'hain', 'nahi', 'nahin', 'kya', 'kyun', 'kaise', 'kitna', 'kitne', 'kitni',
  'chahiye', 'mujhe', 'aap', 'aapka', 'aapki', 'karna', 'karo', 'batao', 'bataiye',
  'dijiye', 'accha', 'theek', 'haan', 'shukriya', 'dhanyavaad', 'kab', 'kahan',
]);
const ROMAN_GU_WORDS = new Set([
  'che', 'chhe', 'nathi', 'shu', 'kem', 'keva', 'ketla', 'ketli', 'joie', 'jarur',
  'mane', 'tamaru', 'tamne', 'saru', 'thay', 'pachi', 'malse', 'kya', 'haji',
]);

/**
 * Returns the detected language code, or null if it can't be determined
 * with reasonable confidence from this one utterance (too short, ambiguous
 * script mix, no romanized keyword hits).
 */
export function detectLanguage(text: string): SupportedLanguage | null {
  const t = text.trim();
  if (!t || t.length < 3) return null;

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
    if (guHits >= 2) return 'gu';
    if (hiHits >= 2) return 'hi';
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
