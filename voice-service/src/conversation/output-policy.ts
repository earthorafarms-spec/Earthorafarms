import type { TurnToolFact } from './state.js';
import type { SupportedLanguage } from './language.js';

// The concrete enforcement mechanism behind the spec's single most important
// safety rule: "never speak from model memory — only from a live tool call
// made in this turn." The system prompt asks for this; this module checks
// it. It is a deterministic heuristic, not a perfect parser — it is
// deliberately conservative (over-flagging is safe; silently letting an
// unattributed claim through is not).
//
// Price/stock attribution violations get a two-strike regenerate-then-
// fallback treatment (see PolicyAction below) rather than a silent mask:
// the first violation in a session asks the model to correct itself using
// only this turn's tool facts (conversation/controller.ts feeds `instruction`
// back and re-prompts); a second CONSECUTIVE violation gives up and returns
// a safe canned line instead. Forbidden-claim / payment-credential
// violations are handled differently: the safe replacement text is already
// a good final answer, so those are masked immediately rather than
// round-tripped through the model again.
//
// All canned replacement strings are localized (en/hi/gu) so a safety
// intervention never jars the caller out of the language they've been
// using — see conversation/language.ts. The hi/gu strings are best-effort
// translations, not reviewed by a native speaker; treat them the same way
// the reference pathology-bot project treats its provisional RESPELL
// entries — verify in real use and correct if a native speaker flags
// something off, but don't leave a safety-critical line in English only.

export type PolicyAction = 'pass' | 'regenerate' | 'fallback';

export interface PolicyResult {
  action: PolicyAction;
  /** Final text to speak/display. Only meaningful when action is "pass" or "fallback". */
  text: string;
  violations: string[];
  /** Present only when action is "regenerate" — feed back to the LLM and re-prompt. */
  instruction?: string;
}

const FORBIDDEN_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /order\s+(is|has been|was)?\s*placed/i, label: 'unearned order-placed claim' },
  { pattern: /payment\s+(is|was)?\s*successful/i, label: 'unearned payment-successful claim' },
  { pattern: /payment\s+(has been|is|was)?\s*(received|confirmed)/i, label: 'unearned payment-confirmed claim' },
  { pattern: /order\s+(is|has been|was)?\s*confirmed/i, label: 'unearned order-confirmed claim' },
];

const PAYMENT_CREDENTIAL_REQUEST_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(cvv|card number|otp|upi pin|bank password)\b/i, label: 'requested a payment credential' },
];

const CURRENCY_PATTERN = /₹\s?[\d,]+(?:\.\d+)?/g;

// Catches BOTH positive ("in stock") and NEGATIVE ("we don't have any
// products") availability/existence claims — found in real testing that a
// model asserting a product/category DOESN'T exist, with zero tool calls
// this turn, is exactly as dangerous as inventing a price, and is not rare:
// it happened with GPT-4o mini (invented "we don't sell herbal tea") and
// independently with Sarvam (claimed zero products exist when one does).
// Deliberately broad and multilingual — over-flagging a stray "available"
// in a genuinely safe sentence just costs one regenerate attempt; missing a
// real fabricated absence claim costs a caller a wrong answer stated as fact.
const PRODUCT_AVAILABILITY_CLAIM_PATTERN =
  /\b(in stock|out of stock|low stock|available|unavailable|don'?t have|do not have|doesn'?t have|does not have|no products?|not carry|don'?t (sell|carry)|we (have|sell|carry)|\d+\s+units?\s+(left|available))\b|उपलब्ध|मौजूद|स्टॉक\s*में|ઉપલબ્ધ|હાજર|સ્ટોકમાં/gi;

const PRODUCT_HEALTH_CLAIM_PATTERN =
  /\b(benefits?|dosage|ingredients?|contraindications?|side effects?|recommended dose|take\s+\d+|contains?|made from|treats?|cures?|prevents?|reduces?\s+(?:pain|sugar|weight|cholesterol)|supports?\s+(?:immunity|digestion|health|wellness))\b|खुराक|सामग्री|फायदे|लाभ|ચેતવણી|માત્રા|ઘટકો|ફાયદા/gi;

const PRICE_GROUNDING_TOOLS = new Set([
  'list_products', 'get_product_details', 'get_cart', 'add_cart_item',
  'update_cart_item', 'remove_cart_item', 'create_verification_link',
]);
const AVAILABILITY_GROUNDING_TOOLS = new Set(['list_products', 'get_product_details']);

function isSuccessfulFact(fact: TurnToolFact): boolean {
  try {
    const value = JSON.parse(fact.resultJson) as Record<string, unknown>;
    return !value.error && value.ok !== false && value.found !== false;
  } catch {
    return false;
  }
}

const ORDER_STATUS_DEFLECTION: Record<SupportedLanguage, string> = {
  en: 'your order status will be shown once payment is confirmed',
  hi: 'भुगतान की पुष्टि होने के बाद आपके ऑर्डर की स्थिति दिखाई जाएगी',
  gu: 'ચુકવણીની પુષ્ટિ થયા પછી તમારા ઓર્ડરની સ્થિતિ બતાવવામાં આવશે',
};

const PAYMENT_CREDENTIAL_REFUSAL: Record<SupportedLanguage, string> = {
  en:
    "I won't ask for that — please don't share payment passwords, PINs, OTPs, or card " +
    'details with me. Payment happens securely on Razorpay after you verify the form.',
  hi:
    'मैं यह नहीं पूछूंगी — कृपया मुझे भुगतान पासवर्ड, पिन, OTP या कार्ड की जानकारी न बताएं। ' +
    'फॉर्म सत्यापित करने के बाद भुगतान सुरक्षित रूप से Razorpay पर होता है।',
  gu:
    'હું એ નહીં પૂછું — કૃપા કરીને મને પેમેન્ટ પાસવર્ડ, પિન, OTP કે કાર્ડની વિગતો ન આપો. ' +
    'ફોર્મ ચકાસ્યા પછી ચુકવણી સુરક્ષિત રીતે Razorpay પર થાય છે.',
};

const SAFE_DEFLECTION: Record<SupportedLanguage, string> = {
  en:
    "I don't have a confirmed answer for that right now — let me check and get back to you, " +
    'or I can continue helping with your order.',
  hi: 'मेरे पास अभी इसका पक्का जवाब नहीं है — मुझे जांचने दीजिए, या मैं आपके ऑर्डर में मदद जारी रख सकती हूँ।',
  gu: 'મારી પાસે અત્યારે એનો ચોક્કસ જવાબ નથી — મને ચકાસવા દો, અથવા હું તમારા ઓર્ડરમાં મદદ કરવાનું ચાલુ રાખી શકું છું.',
};

function numberFromCurrencyMatch(match: string): string {
  return match.replace(/[₹,\s]/g, '');
}

// Per-session consecutive-attribution-failure counter, mirroring the
// pathology voicebot's guard.py two-strike system. Deliberately in-memory
// and unbounded for now (matches that project's same simplification) —
// worth revisiting if this ever runs long enough for map growth to matter.
const consecutiveAttributionFailures = new Map<string, number>();

export function resetGuardState(sessionId: string): void {
  consecutiveAttributionFailures.delete(sessionId);
}

/**
 * `turnFacts` must be exactly this turn's tool results (see
 * conversation/controller.ts, which clears state.currentTurnFacts at the
 * start of every turn) — never accumulated across turns. `language` picks
 * which localized canned string is used for a mask/fallback; pass the
 * conversation's current language (see ConversationState.currentLanguage),
 * not necessarily this turn's freshly-detected one — a violation can occur
 * even on a turn where detection was uncertain.
 */
export function enforceOutputPolicy(
  replyText: string,
  turnFacts: TurnToolFact[],
  sessionId: string,
  language: SupportedLanguage = 'en'
): PolicyResult {
  const violations: string[] = [];
  let text = replyText;

  // ── Immediate-mask violations: the replacement text is already a good
  // final answer, so these never go through the regenerate loop. ──
  for (const { pattern, label } of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(label);
      text = text.replace(pattern, ORDER_STATUS_DEFLECTION[language]);
    }
  }

  for (const { pattern, label } of PAYMENT_CREDENTIAL_REQUEST_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(label);
      text = PAYMENT_CREDENTIAL_REFUSAL[language];
    }
  }

  // ── Attribution violations: these drive the regenerate/fallback state
  // machine, since (unlike the cases above) there's no safe canned
  // replacement for "the specific price/stock claim you just made" — the
  // best fix is a fresh, correctly-grounded answer from the model. ──
  const attributionViolations: string[] = [];
  const successfulFacts = turnFacts.filter(isSuccessfulFact);
  const priceFactsBlob = successfulFacts
    .filter((f) => PRICE_GROUNDING_TOOLS.has(f.toolName))
    .map((f) => f.resultJson)
    .join('\n');

  const currencyMatches = text.match(CURRENCY_PATTERN) ?? [];
  for (const match of currencyMatches) {
    const numeric = numberFromCurrencyMatch(match);
    if (!priceFactsBlob.includes(numeric)) {
      attributionViolations.push(`unattributed price claim: ${match}`);
    }
  }

  const availabilityMatches = text.match(PRODUCT_AVAILABILITY_CLAIM_PATTERN) ?? [];
  const hasAvailabilityGrounding = successfulFacts.some((f) => AVAILABILITY_GROUNDING_TOOLS.has(f.toolName));
  const hasBadAvailabilityClaim = availabilityMatches.length > 0 && !hasAvailabilityGrounding;
  if (hasBadAvailabilityClaim) {
    attributionViolations.push('product/stock availability claim (positive or negative) made with no tool call this turn');
  }

  const healthClaimMatches = text.match(PRODUCT_HEALTH_CLAIM_PATTERN) ?? [];
  const hasKnowledgeGrounding = successfulFacts.some((f) => f.toolName === 'get_product_knowledge');
  if (healthClaimMatches.length > 0 && !hasKnowledgeGrounding) {
    attributionViolations.push('product health/ingredients/dosage claim made without approved knowledge this turn');
  }

  if (attributionViolations.length === 0) {
    consecutiveAttributionFailures.delete(sessionId);
    return { action: 'pass', text, violations };
  }

  violations.push(...attributionViolations);
  const attempt = (consecutiveAttributionFailures.get(sessionId) ?? 0) + 1;
  consecutiveAttributionFailures.set(sessionId, attempt);

  if (attempt === 1) {
    const instruction =
      `Your last reply included a claim not backed by this turn's tool results: ${attributionViolations.join('; ')}. ` +
      'Re-answer using ONLY facts already returned by a tool call above. If you have not looked up ' +
      'the relevant product yet, call the appropriate tool first, then answer from its result. ' +
      'Reply in the same language as your previous attempt.';
    return { action: 'regenerate', text, violations, instruction };
  }

  // Second consecutive failure — stop asking the model to try again and
  // give a safe, honest line instead (matches guard.py's two-strike design).
  consecutiveAttributionFailures.delete(sessionId);
  return { action: 'fallback', text: SAFE_DEFLECTION[language], violations };
}
