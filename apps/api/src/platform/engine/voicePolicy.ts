import { checkOutput, type PolicyResult } from './outputPolicy.js';

export function spokenLanguageInstruction(language: string): string {
  const lang = { en: 'Indian English', hi: 'Hindi', gu: 'Gujarati' }[language] || 'Indian English';
  return `LANGUAGE: Speak naturally in ${lang} and follow the customer's language switches. For Hindi, use conversational Hindi with familiar English words when the customer uses Hinglish; do not force formal Hindi or translate ordinary English product terms. Write Hindi words in Devanagari, Gujarati words in Gujarati script, and English words in Latin script so speech pronunciation stays natural. You are one Indian female assistant across all languages; use feminine first-person Hindi (कर सकती हूँ, बताती हूँ). Never change persona or voice when language changes. Write monetary amounts in digits with rupees. Never translate a product's canonical name.`;
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

export function checkVoiceOutput(text: string, liveAmounts: Set<number>): PolicyResult {
  const base = checkOutput(text);
  if (!base.ok) return base;
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

export function safeVoiceReply(language: string): string {
  return { en: 'Let me check that accurately. You can review and confirm your details on the secure checkout page.', hi: 'मैं यह सही से चेक कर लेती हूँ। आप secure checkout page पर अपनी details देखकर confirm कर सकते हैं।', gu: 'હું આ બરાબર ચેક કરી લઉં. તમે secure checkout page પર તમારી details જોઈને confirm કરી શકો છો.' }[language] || 'Let me check that accurately.';
}
