import { finalizeVoiceOrder } from '../repositories/orders.repository.js';
import { findCheckoutSessionByPaymentLinkId } from '../repositories/checkoutSessions.repository.js';
import { config } from '../config.js';
import { buildPublicInvoiceUrl } from './invoice-document.js';
import { sendWhatsAppInvoice } from '../../../whatsapp-chatbot/provider.js';

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
 * After a successful finalize, fires the existing invoice email function and
 * sends the same PDF bill to the verified checkout WhatsApp number. Both are
 * best-effort notifications and cannot roll back an already-paid order.
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

  void Promise.allSettled([
    triggerInvoiceEmail(orderId),
    triggerInvoiceWhatsApp({
      phone: session.phone,
      paymentLinkId: input.paymentLinkId,
      orderId,
      total: session.frozenPricing?.total ?? input.paidAmount,
      currency: session.frozenPricing?.currency ?? input.paidCurrency,
    }),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.warn('[invoice] paid order notification failed:', result.reason instanceof Error ? result.reason.message : result.reason);
      }
    }
  });

  return { orderId };
}

async function triggerInvoiceEmail(orderId: string): Promise<void> {
  const netlifyUrl = config.MAIN_APP_NETLIFY_URL;
  if (!netlifyUrl) return; // not fatal — invoice can be resent manually from the admin portal

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.NETLIFY_INTERNAL_KEY) headers['X-Internal-Key'] = config.NETLIFY_INTERNAL_KEY;
  const response = await fetch(`${netlifyUrl.replace(/\/$/, '')}/.netlify/functions/send-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orderId }),
  });
  if (!response.ok) throw new Error(`Invoice email function failed (${response.status})`);
}

async function triggerInvoiceWhatsApp(input: {
  phone: string;
  paymentLinkId: string;
  orderId: string;
  total: number;
  currency: string;
}): Promise<void> {
  const orderNumber = input.orderId;
  const amount = `${input.currency} ${input.total.toFixed(2)}`;
  await sendWhatsAppInvoice(
    input.phone,
    buildPublicInvoiceUrl(input.paymentLinkId),
    `Tax_Invoice_${orderNumber}.pdf`,
    orderNumber,
    amount,
  );
}
