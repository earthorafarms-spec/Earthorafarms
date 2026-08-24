import type { ToolModule, ToolContext } from './types.js';
import type { CheckoutFieldSnapshot } from '../conversation/state.js';
import { generateVerificationToken, hashToken } from '../lib/crypto.js';
import {
  createCheckoutSession,
  attachPaymentLink,
  freezeCheckoutPricing,
} from '../repositories/checkoutSessions.repository.js';
import { upsertCheckoutItem } from '../repositories/checkoutItems.repository.js';
import { createPaymentLink } from '../payments/razorpay-links.js';
import { priceCart } from '../domain/pricing.js';
import { config } from '../config.js';

const ALLOWED_FIELDS = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country', 'gst', 'couponCode', 'marketingConsent',
] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

const REQUIRED_FIELDS: AllowedField[] = ['name', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country'];

function missingRequiredFields(fields: CheckoutFieldSnapshot): AllowedField[] {
  return REQUIRED_FIELDS.filter((f) => !fields[f as keyof CheckoutFieldSnapshot]);
}

function normalizeAndValidate(field: AllowedField, rawValue: unknown): { value: unknown; error?: string } {
  if (field === 'marketingConsent') {
    return { value: Boolean(rawValue) };
  }
  const value = String(rawValue ?? '').trim();
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

export const createVerificationLinkTool: ToolModule = {
  definition: {
    name: 'create_verification_link',
    description:
      'Prices the cart, creates a Razorpay payment link, and sends it directly to the caller ' +
      'via SMS and email — Razorpay handles delivery automatically. Call this only after the ' +
      'cart is non-empty and all required checkout fields are set.',
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

    const fields = ctx.state.checkoutFields;

    // Price the cart live — applies festival deals, coupon, GST (Gujarat vs inter-state).
    const priced = await priceCart(
      ctx.state.cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      {
        country: fields.country ?? 'India',
        state: fields.state ?? '',
        couponCode: fields.couponCode,
      }
    );

    // Create a session record so the Razorpay webhook can look up order details and
    // finalize the order when payment completes. The verification token is generated
    // purely to satisfy the DB NOT NULL constraint — it is never sent to the caller;
    // there is no form step in this flow.
    const tokenHash = hashToken(generateVerificationToken());
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    const session = await createCheckoutSession({
      callSessionId: ctx.callSessionId,
      tokenHash,
      tokenExpiresAt,
      draft: fields,
    });

    for (const line of ctx.state.cart) {
      await upsertCheckoutItem(session.id, line.productId, line.quantity, line.unitPrice);
    }

    // Freeze pricing so the finalizer RPC has authoritative amounts to validate against.
    await freezeCheckoutPricing(session.id, priced);

    // Normalize phone to E.164 (assume India +91 if no country code).
    const rawPhone = fields.phone!;
    const contact = rawPhone.startsWith('+') ? rawPhone : `+91${rawPhone.replace(/\D/g, '')}`;
    const referenceId = `VOICE-${session.id.slice(0, 8).toUpperCase()}`;

    // Razorpay sends the payment link via SMS to `contact` and email to `email`
    // automatically (notify.sms + notify.email are enabled in razorpay-links.ts).
    const link = await createPaymentLink({
      amountPaise: Math.round(priced.total * 100),
      currency: 'INR',
      referenceId,
      customer: { name: fields.name!, email: fields.email!, contact },
      callbackUrl: config.PUBLIC_APP_URL,
    });

    await attachPaymentLink(session.id, { paymentLinkId: link.id, referenceId });

    return { ok: true, paymentLinkSent: true, totalAmount: priced.total };
  },
};
