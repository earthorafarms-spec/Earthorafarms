// Thin fetch wrapper for the voice-service checkout API, used by
// src/pages/voice-checkout.tsx. Mirrors the plain-fetch style already used
// throughout src/lib/api.ts rather than introducing a new HTTP client.

const VOICE_SERVICE_URL = (import.meta.env.VITE_VOICE_SERVICE_URL as string | undefined) || '';

export interface VoiceCheckoutItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface VoiceCheckoutCustomer {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  gst: string | null;
  couponCode: string | null;
  marketingConsent: boolean;
}

export interface VoiceCheckoutPricing {
  subtotal: number;
  discount: number;
  discountReason: string | null;
  shipping: number;
  total: number;
  currency: string;
  gst: {
    isIndia: boolean;
    isGujarat: boolean;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
  };
  couponError: string | null;
}

export interface VoiceCheckoutSession {
  status: string;
  customer: VoiceCheckoutCustomer;
  items: VoiceCheckoutItem[];
  pricing: VoiceCheckoutPricing | null;
  tokenExpiresAt: string;
}

function assertConfigured() {
  if (!VOICE_SERVICE_URL) {
    throw new Error('VITE_VOICE_SERVICE_URL is not configured.');
  }
}

async function parseOrThrow(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchVoiceCheckoutSession(token: string): Promise<VoiceCheckoutSession> {
  assertConfigured();
  const res = await fetch(`${VOICE_SERVICE_URL}/checkout/${token}`);
  return parseOrThrow(res);
}

export async function patchVoiceCheckoutSession(
  token: string,
  patch: Partial<VoiceCheckoutCustomer> & { items?: { productId: string; quantity: number }[] }
): Promise<void> {
  assertConfigured();
  const res = await fetch(`${VOICE_SERVICE_URL}/checkout/${token}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await parseOrThrow(res);
}

export async function verifyAndPriceVoiceCheckout(
  token: string
): Promise<{ pricing: VoiceCheckoutPricing; requiresReconfirmation: boolean }> {
  assertConfigured();
  const res = await fetch(`${VOICE_SERVICE_URL}/checkout/${token}/verify-and-price`, { method: 'POST' });
  return parseOrThrow(res);
}

export async function createVoiceCheckoutPaymentLink(token: string): Promise<{ paymentLinkUrl: string }> {
  assertConfigured();
  const res = await fetch(`${VOICE_SERVICE_URL}/checkout/${token}/payment-link`, { method: 'POST' });
  return parseOrThrow(res);
}

export async function fetchVoiceCheckoutStatus(
  token: string
): Promise<{ status: string; orderNumber: string | null }> {
  assertConfigured();
  const res = await fetch(`${VOICE_SERVICE_URL}/checkout/${token}/status`);
  return parseOrThrow(res);
}
