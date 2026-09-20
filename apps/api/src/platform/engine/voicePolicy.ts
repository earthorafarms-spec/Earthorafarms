import { checkOutput, type PolicyResult } from './outputPolicy.js';

export function spokenLanguageInstruction(language: string): string {
  const style = language === 'hi'
    ? 'Use conversational Hindi with familiar English words when the customer uses Hinglish. Write Hindi words in Devanagari and English words in Latin script. Use feminine first-person Hindi (कर सकती हूँ, बताती हूँ).'
    : language === 'gu'
      ? 'Use natural Gujarati in Gujarati script, retaining familiar English product terms in Latin script. Do not answer in Hindi.'
      : 'Use natural Indian English in Latin script. Do not answer in Hindi, Gujarati, or Hinglish, even if earlier turns used those languages.';
  return `${voiceTurnLanguageRule(language)} ${style} You are one Indian female assistant across all languages. Never change persona or voice when language changes. Write monetary amounts in digits with rupees. Never translate a product's canonical name.`;
}

export function voiceTurnLanguageRule(language: string): string {
  const lang = { en: 'English', hi: 'Hindi/Hinglish', gu: 'Gujarati' }[language] || 'English';
  return `CURRENT TURN LANGUAGE: ${lang} (${language}). This is authoritative for the next reply, including after tools. Previous conversation language must not override it. Use earlier turns only for customer facts and context; answer the latest customer message in ${lang}.`;
}

/** Only prices from current catalogue/pricing tool results can be spoken. */
export function collectLiveAmounts(value: unknown, amounts = new Set<number>()): Set<number> {
  if (Array.isArray(value)) for (const item of value) collectLiveAmounts(item, amounts);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(price|unit_?price|mrp|total|total_?amount|subtotal|shipping|shipping_?fee|discount|tax)$/i.test(key)) {
        const amount = typeof item === 'number' ? item : typeof item === 'string' && /^\d+(\.\d+)?$/.test(item) ? Number(item) : NaN;
        if (Number.isFinite(amount)) amounts.add(amount);
      }
      if (item && typeof item === 'object') collectLiveAmounts(item, amounts);
    }
  }
  return amounts;
}

export function checkVoiceOutput(text: string, liveAmounts: Set<number>, language?: string): PolicyResult {
  const base = checkOutput(text);
  if (!base.ok) return base;
  const hasHindi = /[\u0900-\u097f]/u.test(text);
  const hasGujarati = /[\u0a80-\u0aff]/u.test(text);
  if ((language === 'en' && (hasHindi || hasGujarati)) || (language === 'hi' && (!hasHindi || hasGujarati)) || (language === 'gu' && (!hasGujarati || hasHindi))) return { ok: false, reason: 'language-mismatch' };
  if (/(?:ऑर्डर|आर्डर).{0,12}(?:कन्फर्म|पक्का|हो गया)|(?:भुगतान|पेमेंट).{0,12}(?:मिल गया|सफल|हो गया)|(?:ઓર્ડર).{0,12}(?:કન્ફર્મ|પાકો|થઈ ગયો)|(?:ચુકવણી|પેમેન્ટ).{0,12}(?:મળી ગઈ|સફળ|થઈ ગય)/u.test(text)) return { ok: false, reason: 'claims-order-or-payment' };
  if (/(?:ओटीपी|सीवीवी|कार्ड नंबर|यूपीआई पिन|ઓટીપી|કાર્ડ નંબર|યુપીઆઈ પિન)/u.test(text)) return { ok: false, reason: 'asks-sensitive' };
  const normalized = text.replace(/[०-९૦-૯]/gu, (digit) => String(digit.charCodeAt(0) - (digit >= '૦' ? 0x0ae6 : 0x0966)));
  const prices = /(?:₹\s*|\bINR\s*|\bRs\.?\s*|\brupees?\s+)([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rupees?\b|रुपये|रुपए|રૂપિયા)|\b(?:price|cost|total)\s*(?:is|of|:)?\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of normalized.matchAll(prices)) {
    const amount = Number((match[1] || match[2] || match[3]).replaceAll(',', ''));
    if (!liveAmounts.has(amount)) return { ok: false, reason: 'ungrounded-price' };
  }
  return { ok: true };
}

export function safeVoiceReply(language: string, reason?: string): string {
  if (reason === 'language-mismatch') return { en: 'How can I help you with your Earthora products or order?', hi: 'मैं Earthora के products या आपके order के बारे में क्या मदद कर सकती हूँ?', gu: 'Earthora ના products કે તમારા order વિશે હું શું મદદ કરી શકું?' }[language] || 'How can I help you?';
  return { en: 'Let me check that accurately. You can review and confirm your details on the secure checkout page.', hi: 'मैं यह सही से चेक कर लेती हूँ। आप secure checkout page पर अपनी details देखकर confirm कर सकते हैं।', gu: 'હું આ બરાબર ચેક કરી લઉં. તમે secure checkout page પર તમારી details જોઈને confirm કરી શકો છો.' }[language] || 'Let me check that accurately.';
}
