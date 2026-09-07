import type { ToolModule, ToolContext } from './types.js';
import type { CheckoutFieldSnapshot } from '../conversation/state.js';
import { decryptPii, encryptPii, generateVerificationToken, hashToken } from '../lib/crypto.js';
import { createCheckoutSession, findCheckoutSessionByTokenHash } from '../repositories/checkoutSessions.repository.js';
import { upsertCheckoutItem } from '../repositories/checkoutItems.repository.js';
import { sendWhatsAppCheckoutForm } from '../../../whatsapp-chatbot/provider.js';
import { config } from '../config.js';

const ALLOWED_FIELDS = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country', 'gst', 'couponCode', 'marketingConsent',
] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

const REQUIRED_FIELDS: AllowedField[] = ['name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country'];

const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'शून्य': '0', 'जीरो': '0', 'ज़ीरो': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  'શૂન્ય': '0', 'ઝીરો': '0', 'એક': '1', 'બે': '2', 'ત્રણ': '3', 'ચાર': '4', 'પાંચ': '5', 'છ': '6', 'સાત': '7', 'આઠ': '8', 'નવ': '9',
};

function normalizeNativeDigits(raw: string): string {
  return raw.normalize('NFKC').replace(/[०-९૦-૯]/gu, (digit) =>
    String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x0ae6 ? 0x0ae6 : 0x0966)));
}

/** Converts a caller/LLM-provided digit-by-digit sequence without guessing a missing digit. */
export function normalizeSpokenDigitSequence(raw: string): string | null {
  const normalized = normalizeNativeDigits(raw).toLowerCase().trim();
  if (/^[\d\s().,+-]+$/.test(normalized)) return normalized.replace(/\D/g, '');
  const tokens = normalized.match(/[a-z]+|[\u0900-\u097f]+|[\u0a80-\u0aff]+|\d/gu) ?? [];
  const digits = tokens.map((token) => /^\d$/.test(token) ? token : SPOKEN_DIGITS[token]).filter(Boolean);
  return digits.length > 0 ? digits.join('') : null;
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

export function isCheckoutReady(state: ToolContext['state']): boolean {
  return state.cart.length > 0 && missingRequiredFields(state.checkoutFields).length === 0 &&
    state.checkoutFields.gst !== undefined;
}

function missingRequiredFields(fields: CheckoutFieldSnapshot): AllowedField[] {
  return REQUIRED_FIELDS.filter((f) => !fields[f as keyof CheckoutFieldSnapshot]);
}

function checkoutFingerprint(ctx: ToolContext): string {
  const fields = ctx.state.checkoutFields;
  return hashToken(JSON.stringify({
    cart: ctx.state.cart.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    fields: {
      name: fields.name ?? '', email: fields.email ?? '', phone: fields.phone ?? '',
      address: fields.address ?? '', city: fields.city ?? '', state: fields.state ?? '',
      postalCode: fields.postalCode ?? '', country: fields.country ?? '', gst: fields.gst ?? null,
      couponCode: fields.couponCode ?? null, marketingConsent: fields.marketingConsent ?? false,
    },
  }));
}

async function deliverReviewUrl(contact: string, verificationUrl: string, ctx: ToolContext): Promise<void> {
  if (ctx.channel === 'text' && ctx.outboundActions) {
    ctx.outboundActions.push({ type: 'checkout_review', url: verificationUrl });
    return;
  }
  await sendWhatsAppCheckoutForm(contact, verificationUrl);
}

function normalizeSpokenPlace(field: 'city' | 'state', rawValue: unknown): string {
  let value = String(rawValue ?? '').trim();
  value = value
    .replace(/^(?:my\s+)?(?:city|state)\s+(?:is\s+)?/i, '')
    .replace(/^(?:i\s+(?:am|live)\s+in)\s+/i, '')
    .replace(/^(?:मेरा|मेरी)\s+(?:शहर|राज्य)\s+/u, '')
    .replace(/^(?:मैं|हम)\s+/u, '')
    .replace(/\s+में\s*(?:रहता|रहती|हूँ|है)?\s*$/u, '')
    .replace(/^(?:મારું|મારી)\s+(?:શહેર|રાજ્ય)\s+/u, '')
    .replace(/[.,]+$/g, '')
    .trim();

  const key = value.toLocaleLowerCase('en-IN').replace(/[\s-]+/g, ' ');
  if (field === 'state') {
    const stateAliases: Record<string, string> = {
      gujarat: 'Gujarat', gujrat: 'Gujarat', gujrath: 'Gujarat', 'गुजरात': 'Gujarat', 'ગુજરાત': 'Gujarat',
      maharashtra: 'Maharashtra', 'महाराष्ट्र': 'Maharashtra', 'મહારાષ્ટ્ર': 'Maharashtra',
      rajasthan: 'Rajasthan', 'राजस्थान': 'Rajasthan', 'રાજસ્થાન': 'Rajasthan',
      'madhya pradesh': 'Madhya Pradesh', 'मध्य प्रदेश': 'Madhya Pradesh',
      delhi: 'Delhi', 'दिल्ली': 'Delhi', 'દિલ્હી': 'Delhi',
    };
    return stateAliases[key] ?? value;
  }

  const cityAliases: Record<string, string> = {
    ahmedabad: 'Ahmedabad', ahemdabad: 'Ahmedabad', ahmedbad: 'Ahmedabad', amdavad: 'Ahmedabad',
    'अहमदाबाद': 'Ahmedabad', 'અમદાવાદ': 'Ahmedabad',
    surat: 'Surat', 'सूरत': 'Surat', 'સુરત': 'Surat',
    vadodara: 'Vadodara', baroda: 'Vadodara', 'वडोदरा': 'Vadodara', 'વડોદરા': 'Vadodara',
  };
  return cityAliases[key] ?? value;
}

function normalizeAndValidate(field: AllowedField, rawValue: unknown): { value: unknown; error?: string } {
  if (field === 'marketingConsent') {
    if (typeof rawValue === 'boolean') return { value: rawValue };
    const normalized = String(rawValue).trim().toLowerCase();
    if (normalized === 'true') return { value: true };
    if (normalized === 'false') return { value: false };
    return { value: false, error: 'Marketing consent must be true or false.' };
  }
  const value = String(rawValue ?? '').trim();
  if (field === 'phone') {
    const spokenDigits = normalizeSpokenDigitSequence(value);
    const phone = normalizeWhatsAppPhone(spokenDigits ?? value);
    return phone ? { value: phone } : { value, error: 'Please provide a valid WhatsApp mobile number with country code if outside India.' };
  }
  if (field === 'postalCode') {
    const postalCode = normalizeSpokenDigitSequence(value);
    return postalCode && /^\d{6}$/.test(postalCode)
      ? { value: postalCode }
      : { value, error: 'Please provide an Indian PIN code with exactly 6 digits.' };
  }
  if (field === 'name' && /\b(?:bottles?|packs?|tablets?|order|want|need)\b|बॉटल|बोतल|बोटल|टैबलेट|ऑर्डर|चाहिए|બોટલ|ટેબ્લેટ|ઓર્ડર|જોઈએ/iu.test(value)) {
    return { value, error: 'That sounds like an order request, not the customer name. Please ask for the full name again.' };
  }
  if (['name', 'address', 'city', 'state'].includes(field) && /^(?:yes|no|ok(?:ay)?|hello|hi|हाँ|हां|नहीं|હા|ના)[.!?]*$/iu.test(value)) {
    return { value, error: 'That is an acknowledgement, not the requested checkout detail. Use the preceding question to interpret it.' };
  }
  if (field === 'city' || field === 'state') {
    return { value: normalizeSpokenPlace(field, value) };
  }
  if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { value, error: "That doesn't look like a valid email address." };
  }
  return { value };
}

export const setCheckoutFieldTool: ToolModule = {
  definition: {
    name: 'set_checkout_field',
    description:
      'Records one checkout field the caller has provided. Call once per field, or a couple of ' +
      'closely related address fields together.',
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: [...ALLOWED_FIELDS] },
        value: { type: ['string', 'boolean'], description: 'String value, or true/false for marketingConsent.' },
      },
      required: ['field', 'value'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const field = args.field as AllowedField;
    if (!ALLOWED_FIELDS.includes(field)) {
      return { ok: false, reason: 'unknown_field' };
    }

    const { value, error } = normalizeAndValidate(field, args.value);
    if (error) {
      return { ok: false, reason: 'invalid_value', message: error };
    }

    (ctx.state.checkoutFields as Record<string, unknown>)[field] = value;

    return {
      ok: true,
      missingRequiredFields: missingRequiredFields(ctx.state.checkoutFields),
    };
  },
};

export const setDeliveryLocationTool: ToolModule = {
  definition: {
    name: 'set_delivery_location',
    description:
      'Records city and state together. Use this whenever the caller provides both place values in one ' +
      'reply, including Hindi, Gujarati, Romanized, or informal phrasing. Do not ask for them again after this succeeds.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'The caller-spoken city.' },
        state: { type: 'string', description: 'The caller-spoken Indian state.' },
      },
      required: ['city', 'state'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const city = normalizeSpokenPlace('city', args.city);
    const state = normalizeSpokenPlace('state', args.state);
    if (!city || !state) return { ok: false, reason: 'missing_location_value' };

    ctx.state.checkoutFields.city = city;
    ctx.state.checkoutFields.state = state;
    return {
      ok: true,
      city,
      state,
      missingRequiredFields: missingRequiredFields(ctx.state.checkoutFields),
    };
  },
};

export const createVerificationLinkTool: ToolModule = {
  definition: {
    name: 'create_verification_link',
    description:
      'Creates a secure, editable order-review form and sends it to the caller on WhatsApp. ' +
      'This does NOT create a Razorpay payment link. The customer must review or edit the form, ' +
      'confirm the freshly calculated price, and explicitly continue before payment can begin. ' +
      'Call this only after the cart is non-empty, all required checkout fields are set, and ' +
      'the optional GST question was answered (an empty gst value means the caller declined).',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  handler: async (_args, ctx: ToolContext) => {
    if (ctx.state.cart.length === 0) {
      return { ok: false, reason: 'empty_cart' };
    }
    const missing = missingRequiredFields(ctx.state.checkoutFields);
    if (missing.length > 0) {
      return { ok: false, reason: 'missing_fields', missingRequiredFields: missing };
    }
    if (ctx.state.checkoutFields.gst === undefined) {
      return { ok: false, reason: 'gst_question_not_answered' };
    }

    const fields = ctx.state.checkoutFields;
    const contact = normalizeWhatsAppPhone(fields.phone!);
    if (!contact) return { ok: false, reason: 'invalid_phone' };
    if (!config.whatsappCheckoutConfigured) {
      return { ok: false, reason: 'whatsapp_not_configured' };
    }

    const fingerprint = checkoutFingerprint(ctx);
    const active = ctx.state.activeCheckoutReview;
    if (active && active.checkoutFingerprint === fingerprint &&
        new Date(active.tokenExpiresAt).getTime() > Date.now()) {
      try {
        const rawToken = decryptPii(active.encryptedToken);
        const existing = await findCheckoutSessionByTokenHash(hashToken(rawToken));
        if (existing && existing.id === active.checkoutSessionId) {
          const verificationUrl = `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/voice-checkout/${rawToken}`;
          await deliverReviewUrl(contact, verificationUrl, ctx);
          return {
            ok: true,
            verificationFormSent: true,
            reusedExistingForm: true,
            channel: 'whatsapp',
            expiresInMinutes: Math.max(1, Math.ceil((new Date(active.tokenExpiresAt).getTime() - Date.now()) / 60_000)),
          };
        }
      } catch {
        // Corrupt/legacy state should recover by issuing one fresh form below.
      }
    }

    // The checkout row stores only a SHA-256 hash. A separately encrypted copy
    // is kept in the private conversation state solely so the same short-lived
    // form can be resent without creating duplicate checkout sessions.
    const rawToken = generateVerificationToken();
    const tokenHash = hashToken(rawToken);
    const tokenExpiresAt = new Date(
      Date.now() + config.VOICE_CHECKOUT_TTL_MINUTES * 60_000
    ).toISOString();

    const session = await createCheckoutSession({
      callSessionId: ctx.callSessionId,
      tokenHash,
      tokenExpiresAt,
      draft: fields,
    });

    for (const line of ctx.state.cart) {
      await upsertCheckoutItem(session.id, line.productId, line.quantity, line.unitPrice);
    }

    ctx.state.activeCheckoutReview = {
      checkoutSessionId: session.id,
      encryptedToken: encryptPii(rawToken),
      tokenExpiresAt,
      checkoutFingerprint: fingerprint,
    };

    // Do not price or create a Razorpay link here. The checkout page first
    // persists the customer's edits, then calls verify-and-price, and only an
    // explicit confirmation from that page can request the payment link.
    const verificationUrl = `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/voice-checkout/${rawToken}`;
    try {
      // An inbound WhatsApp conversation is already inside the customer-
      // service window. Its durable worker sends one normal text message
      // containing the exact URL, instead of a template plus acknowledgement.
      await deliverReviewUrl(contact, verificationUrl, ctx);
    } catch (err) {
      // Never log the provider body: it may echo phone numbers, tokens or the review URL.
      console.warn('[checkout] WhatsApp review form failed', {
        callSessionId: ctx.callSessionId,
        provider: config.WHATSAPP_PROVIDER,
        httpStatus: typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined,
      });
      return { ok: false, reason: 'whatsapp_delivery_failed' };
    }

    // Never return the raw token or URL to the LLM: tool results are persisted
    // in the conversation transcript and may later be spoken aloud.
    return {
      ok: true,
      verificationFormSent: true,
      channel: 'whatsapp',
      expiresInMinutes: config.VOICE_CHECKOUT_TTL_MINUTES,
    };
  },
};
