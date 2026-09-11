import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { generateInvoicePdf } from './invoice-pdf.js';
import type { SupportedLanguage } from '../conversation/language.js';

function invoiceDigest(paymentLinkId: string): Buffer {
  return createHmac('sha256', config.TOKEN_SIGNING_SECRET)
    .update(`voice-invoice:${paymentLinkId}`)
    .digest();
}

export function signInvoiceReference(paymentLinkId: string): string {
  return invoiceDigest(paymentLinkId).toString('hex');
}

export function verifyInvoiceReference(paymentLinkId: string, signature: string | undefined): boolean {
  if (!signature || !/^[a-f0-9]{64}$/iu.test(signature)) return false;
  const received = Buffer.from(signature, 'hex');
  const expected = invoiceDigest(paymentLinkId);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function buildPublicInvoiceUrl(paymentLinkId: string): string {
  // The storefront currently serves its SPA fallback for /api/voice/*, which
  // turns a valid invoice link into HTML. Serve the signed document directly
  // from the voice service so WhatsApp always receives a real PDF response.
  const serviceUrl = config.PUBLIC_VOICE_SERVICE_URL.replace(/\/$/, '');
  return `${serviceUrl}/payments/invoice/${encodeURIComponent(paymentLinkId)}?signature=${signInvoiceReference(paymentLinkId)}`;
}

export async function fetchInvoicePdf(orderId: string, language: SupportedLanguage): Promise<Buffer> {
  const bytes = await generateInvoicePdf(orderId, language);
  if (bytes.length < 100 || bytes.length > 10 * 1024 * 1024) {
    throw new Error(`Invoice generator returned invalid PDF size: ${bytes.length}`);
  }
  return bytes;
}
