import { config } from '../config.js';

export interface CreatePaymentLinkInput {
  amountPaise: number;
  currency: string;
  referenceId: string;
  customer: { name: string; email: string; contact: string };
  callbackUrl: string;
}

export interface CreatePaymentLinkResult {
  id: string;
  shortUrl: string;
}

/**
 * Razorpay Payment Links API — a different endpoint/payload shape than the
 * Orders API used by ../../netlify/functions/create-razorpay-order.mjs (that
 * function powers the OLD checkout.js-modal flow; this one is for the
 * email-a-link voice flow). Same Basic-auth style, different surface.
 */
export async function createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
  const authHeader = 'Basic ' + Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64');

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(input.amountPaise),
      currency: input.currency,
      reference_id: input.referenceId,
      description: 'Earthora Farms order',
      customer: input.customer,
      notify: { sms: true, email: true },
      reminder_enable: true,
      callback_url: input.callbackUrl,
      callback_method: 'get',
      // Partial payment must stay disabled — the finalizer asserts an exact
      // amount match and has no concept of a partially-paid order.
      accept_partial: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Razorpay create payment link failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { id: string; short_url: string };
  return { id: data.id, shortUrl: data.short_url };
}
