import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Verifies Razorpay's X-Razorpay-Signature header: HMAC-SHA256 over the RAW
 * request body bytes, keyed with RAZORPAY_WEBHOOK_SECRET. Mirrors the
 * createHmac/timingSafeEqual primitives already used in
 * ../../netlify/functions/verify-razorpay-payment.mjs, but that function
 * verifies a different message (`order_id|payment_id` for the Checkout.js
 * flow) — Payment Links webhooks sign the whole raw body instead, and
 * MUST be verified before any JSON.parse happens (see routes/payment-webhook.ts,
 * which registers a raw-body content-type parser for this one route).
 */
export function verifyRazorpayWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signatureHeader, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;

  return timingSafeEqual(expectedBuf, receivedBuf);
}

export interface RazorpayPaymentLinkWebhookPayload {
  event: string;
  payload: {
    payment_link?: { entity?: { id?: string; reference_id?: string } };
    payment?: { entity?: { id?: string; amount?: number; currency?: string; status?: string } };
  };
}

/** Events that indicate a successful, capturable payment for a Payment Link. */
const SUCCESS_EVENT_TYPES = new Set(['payment_link.paid', 'payment.captured']);

export function isPaymentSuccessEvent(eventType: string): boolean {
  return SUCCESS_EVENT_TYPES.has(eventType);
}

/**
 * Razorpay does not always guarantee a stable top-level webhook event id
 * across all event types in the same way — practically, the payment entity
 * id is the reliable dedupe key for payment-link events. If a future event
 * type lacks even that, fall back to hashing the raw body (still stable
 * across identical retried deliveries). Verify this against real webhook
 * payloads during Phase 4 testing.
 */
export function extractIdempotencyKey(rawBody: Buffer, payload: RazorpayPaymentLinkWebhookPayload): string {
  const paymentId = payload.payload?.payment?.entity?.id;
  if (paymentId) return `${payload.event}:${paymentId}`;

  return `${payload.event}:${createHmac('sha256', 'idempotency-fallback').update(rawBody).digest('hex')}`;
}
