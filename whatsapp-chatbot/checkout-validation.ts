import type { CheckoutFieldSnapshot } from '../voice-service/src/conversation/state.js';

export const ALLOWED_FIELDS = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country', 'gst', 'couponCode', 'marketingConsent',
] as const;
export type AllowedField = (typeof ALLOWED_FIELDS)[number];

export const REQUIRED_FIELDS: AllowedField[] = ['name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country'];

export const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'शून्य': '0', 'जीरो': '0', 'ज़ीरो': '0', 'वन': '1', 'टू': '2', 'थ्री': '3', 'फोर': '4', 'फाइव': '5', 'सिक्स': '6', 'सेवन': '7', 'सैवन': '7', 'एट': '8', 'आर्ट': '8', 'नाइन': '9',
  'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  'શૂન્ય': '0', 'ઝીરો': '0', 'વન': '1', 'ટુ': '2', 'ટૂ': '2', 'થ્રી': '3', 'ફોર': '4', 'ફાઇવ': '5', 'સિક્સ': '6', 'સેવન': '7', 'એટ': '8', 'એઇટ': '8', 'નાઇન': '9',
  'એક': '1', 'બે': '2', 'ત્રણ': '3', 'ચાર': '4', 'પાંચ': '5', 'છ': '6', 'સાત': '7', 'આઠ': '8', 'નવ': '9',
  shunya: '0', sunya: '0', ek: '1', do: '2', teen: '3', tin: '3', char: '4', chaar: '4',
  panch: '5', paanch: '5', chha: '6', chhah: '6', saat: '7', sat: '7', aath: '8', ath: '8',
  nau: '9', be: '2', tran: '3', nav: '9',
};

export function normalizeNativeDigits(raw: string): string {
  return raw.normalize('NFKC').replace(/[०-९૦-૯]/gu, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x0ae6 ? 0x0ae6 : 0x0966)));
}

/** Converts a caller/LLM-provided digit-by-digit sequence without guessing a missing digit. */
export function normalizeSpokenDigitSequence(raw: string, expectedLength?: number): string | null {
  const normalized = normalizeNativeDigits(raw).toLowerCase().trim();
  if (/^[\d\s().,+-]+$/.test(normalized)) {
    const digits = normalized.replace(/\D/g, '');
    return expectedLength === undefined || digits.length === expectedLength ? digits : null;
  }
  if (/@|https?:\/\//u.test(normalized)) return null;
  const tokens = normalized.match(/[a-z]+|[\u0900-\u097f]+|[\u0a80-\u0aff]+|\d+/gu) ?? [];
  if (tokens.length === 0) return null;

  // Treat this as a digit sequence only when every spoken token is a digit.
  // Otherwise an email such as "customer7@example.com" can be reduced to
  // "7" and incorrectly rejected as a partial phone number.
  const mapped = tokens.map((token) => /^\d+$/u.test(token) ? token : SPOKEN_DIGITS[token]);
  if (expectedLength === undefined) {
    return mapped.every((digit): digit is string => Boolean(digit)) ? mapped.join('') : null;
  }

  // STT commonly returns a correct value inside a natural phrase, for example
  // "my PIN is three eight two four seven zero". During a known numeric field
  // we can safely ignore filler words, but only accept an exact-length result.
  const digits = mapped.filter((digit): digit is string => Boolean(digit)).join('');
  return digits.length === expectedLength ? digits : null;
}

export function normalizeWhatsAppPhone(raw: string): string | null {
  const normalized = normalizeNativeDigits(raw);
  if (!/^[+\d\s().-]+$/.test(normalized.trim())) return null;
  const digits = normalized.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (normalized.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits) && !digits.startsWith('91')) return `+${digits}`;
  return null;
}

export const INDIA_AFFIRMATIVE_PATTERN =
  /^(?:yes|yup|yep|yeah|ya|sure|correct|right|definitely|certainly|of\s+course|ha|haa|haan|han|ji|ji\s+ha|ji\s+haan|ji\s+han|haan\s*ji|hanji|haji|sahi|bilkul|barabar|sachu|हाँ|हां|जी|जी\s*हाँ|जी\s*हां|हाँ\s*जी|हां\s*जी|सही|बिल्कुल|હા|હાં|જી|હા\s*જી|જી\s*હા|બરાબર|સાચું|india|in\s+india|bharat|in\s+bharat|hindustan|भारत|भारत\s*में|हिंदुस्तान|ભારત|ભારતમાં|હિન્દુસ્તાન|(?:yes|yup|yep|yeah|ya|sure|correct|right|ha|haa|haan|han|ji|हाँ|हां|હા)[,\s]+(?:india|in\s+india|bharat|in\s+bharat|hindustan|भारत|ભારત))[.!?]*$/iu;

export const NON_INDIA_NEGATIVE_PATTERN =
  /^(?:no|nope|nah|not\s+in\s+india|outside\s+india|nahi|naa?|nathi|not\s+india|नहीं|ना|ના|નથી|(?:no|nope|nah|nahi|नहीं|ના)[,\s]+(?:not\s+in\s+india|outside\s+india|other\s+country))[.!?]*$/iu;

export function isIndiaAffirmative(raw: string): boolean {
  return INDIA_AFFIRMATIVE_PATTERN.test(raw.trim());
}

export function isNonIndiaOrNegative(raw: string): boolean {
  return NON_INDIA_NEGATIVE_PATTERN.test(raw.trim());
}

export function missingRequiredFields(fields: CheckoutFieldSnapshot): AllowedField[] {
  return REQUIRED_FIELDS.filter((f) => !fields[f as keyof CheckoutFieldSnapshot]);
}

export function isCheckoutReady(state: { cart: unknown[]; checkoutFields: CheckoutFieldSnapshot }): boolean {
  return state.cart.length > 0 && missingRequiredFields(state.checkoutFields).length === 0 &&
    state.checkoutFields.gst !== undefined;
}
