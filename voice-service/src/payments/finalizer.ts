import { finalizeVoiceOrder } from '../repositories/orders.repository.js';
import { findCheckoutSessionByPaymentLinkId } from '../repositories/checkoutSessions.repository.js';
import { config } from '../config.js';

export interface FinalizeInput {
  paymentLinkId: string;
  razorpayPaymentId: string;
  paidAmount: number; // rupees, not paise — matches orders.total_amount's NUMERIC(10,2)
  paidCurrency: string;
}

export interface FinalizeResult {
  orderId: string;
}

/**
 * Looks up the checkout session by Razorpay payment-link id, then calls the
 * `finalize_voice_order` RPC (see
 * supabase/migrations/20260908000000_voice_checkout_finalizer.sql), which
 * does the actual atomic, idempotent order creation. This function adds no
 * safety logic of its own — see that RPC and routes/payment-webhook.ts's
 * `payment_webhook_events` dedupe insert for where the real guarantees live.
 * After a successful finalize, fires the EXISTING invoice email function
 * (fire-and-forget, matching src/pages/checkout.tsx's own "ignore failures"
 * pattern for this call) rather than adding a third copy of PDF generation.
 */
export async function finalizeOrderFromWebhook(input: FinalizeInput): Promise<FinalizeResult> {
  const session = await findCheckoutSessionByPaymentLinkId(input.paymentLinkId);
  if (!session) {
    throw new Error(`No voice_checkout_session found for payment link ${input.paymentLinkId}`);
  }

  const orderId = await finalizeVoiceOrder({
    checkoutSessionId: session.id,
    razorpayPaymentId: input.razorpayPaymentId,
    paidAmount: input.paidAmount,
    paidCurrency: input.paidCurrency,
  });

  triggerInvoiceEmail(orderId).catch(() => {
    /* best-effort, matches existing checkout.tsx behavior of ignoring send-invoice failures */
  });

  return { orderId };
}

async function triggerInvoiceEmail(orderId: string): Promise<void> {
  const netlifyUrl = config.MAIN_APP_NETLIFY_URL;
  if (!netlifyUrl) return; // not fatal — invoice can be resent manually from the admin portal

  await fetch(`${netlifyUrl}/.netlify/functions/send-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
}
