import { supabase } from '../lib/supabaseClient.js';
import type { PricedCart } from '../domain/types.js';

export type CheckoutSessionStatus =
  | 'draft' | 'link_sent' | 'opened' | 'verified' | 'repriced'
  | 'payment_link_created' | 'payment_confirmed' | 'finalizing' | 'order_created'
  | 'expired' | 'abandoned' | 'payment_failed' | 'finalization_failed';

export interface CheckoutSessionRow {
  id: string;
  callSessionId: string;
  status: CheckoutSessionStatus;
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
  currency: string;
  frozenPricing: PricedCart | null;
  tokenExpiresAt: string;
  verifiedAt: string | null;
  pricingFrozenAt: string | null;
  razorpayPaymentLinkId: string | null;
  razorpayReferenceId: string | null;
  razorpayPaymentId: string | null;
  paymentStatus: string | null;
  orderId: string | null;
}

interface DbRow {
  id: string;
  call_session_id: string;
  status: CheckoutSessionStatus;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  gst: string | null;
  coupon_code: string | null;
  marketing_consent: boolean;
  currency: string;
  frozen_pricing: PricedCart | null;
  token_expires_at: string;
  verified_at: string | null;
  pricing_frozen_at: string | null;
  razorpay_payment_link_id: string | null;
  razorpay_reference_id: string | null;
  razorpay_payment_id: string | null;
  payment_status: string | null;
  order_id: string | null;
}

const SELECT_COLUMNS =
  'id, call_session_id, status, name, email, phone, address, city, state, postal_code, country, ' +
  'gst, coupon_code, marketing_consent, currency, frozen_pricing, token_expires_at, verified_at, ' +
  'pricing_frozen_at, razorpay_payment_link_id, razorpay_reference_id, razorpay_payment_id, ' +
  'payment_status, order_id';

function mapRow(row: DbRow): CheckoutSessionRow {
  return {
    id: row.id,
    callSessionId: row.call_session_id,
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    gst: row.gst,
    couponCode: row.coupon_code,
    marketingConsent: row.marketing_consent,
    currency: row.currency,
    frozenPricing: row.frozen_pricing,
    tokenExpiresAt: row.token_expires_at,
    verifiedAt: row.verified_at,
    pricingFrozenAt: row.pricing_frozen_at,
    razorpayPaymentLinkId: row.razorpay_payment_link_id,
    razorpayReferenceId: row.razorpay_reference_id,
    razorpayPaymentId: row.razorpay_payment_id,
    paymentStatus: row.payment_status,
    orderId: row.order_id,
  };
}

export async function createCheckoutSession(input: {
  callSessionId: string;
  tokenHash: string;
  tokenExpiresAt: string;
  draft: Partial<Pick<CheckoutSessionRow,
    'name' | 'email' | 'phone' | 'address' | 'city' | 'state' | 'postalCode' | 'country' | 'gst' | 'couponCode' | 'marketingConsent'
  >>;
}): Promise<CheckoutSessionRow> {
  const { data, error } = await supabase
    .from('voice_checkout_sessions')
    .insert({
      call_session_id: input.callSessionId,
      status: 'link_sent',
      verification_token_hash: input.tokenHash,
      token_expires_at: input.tokenExpiresAt,
      name: input.draft.name ?? '',
      email: input.draft.email ?? '',
      phone: input.draft.phone ?? '',
      address: input.draft.address ?? '',
      city: input.draft.city ?? '',
      state: input.draft.state ?? '',
      postal_code: input.draft.postalCode ?? '',
      country: input.draft.country ?? 'India',
      gst: input.draft.gst ?? null,
      coupon_code: input.draft.couponCode ?? null,
      marketing_consent: input.draft.marketingConsent ?? false,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as unknown as DbRow);
}

export async function findCheckoutSessionByTokenHash(tokenHash: string): Promise<CheckoutSessionRow | null> {
  const { data, error } = await supabase
    .from('voice_checkout_sessions')
    .select(SELECT_COLUMNS)
    .eq('verification_token_hash', tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as DbRow);
}

export async function findCheckoutSessionByPaymentLinkId(linkId: string): Promise<CheckoutSessionRow | null> {
  const { data, error } = await supabase
    .from('voice_checkout_sessions')
    .select(SELECT_COLUMNS)
    .eq('razorpay_payment_link_id', linkId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as DbRow);
}

export async function updateCheckoutSessionFields(
  id: string,
  patch: Partial<{
    name: string; email: string; phone: string; address: string; city: string;
    state: string; postalCode: string; country: string; gst: string | null;
    couponCode: string | null; marketingConsent: boolean; status: CheckoutSessionStatus;
  }>
): Promise<void> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone;
  if (patch.address !== undefined) dbPatch.address = patch.address;
  if (patch.city !== undefined) dbPatch.city = patch.city;
  if (patch.state !== undefined) dbPatch.state = patch.state;
  if (patch.postalCode !== undefined) dbPatch.postal_code = patch.postalCode;
  if (patch.country !== undefined) dbPatch.country = patch.country;
  if (patch.gst !== undefined) dbPatch.gst = patch.gst;
  if (patch.couponCode !== undefined) dbPatch.coupon_code = patch.couponCode;
  if (patch.marketingConsent !== undefined) dbPatch.marketing_consent = patch.marketingConsent;
  if (patch.status !== undefined) dbPatch.status = patch.status;

  const { error } = await supabase.from('voice_checkout_sessions').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function freezeCheckoutPricing(id: string, pricedCart: PricedCart): Promise<void> {
  const { error } = await supabase
    .from('voice_checkout_sessions')
    .update({
      status: 'repriced',
      frozen_pricing: pricedCart,
      pricing_frozen_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function attachPaymentLink(
  id: string,
  input: { paymentLinkId: string; referenceId: string }
): Promise<void> {
  const { error } = await supabase
    .from('voice_checkout_sessions')
    .update({
      status: 'payment_link_created',
      razorpay_payment_link_id: input.paymentLinkId,
      razorpay_reference_id: input.referenceId,
      payment_status: 'created',
    })
    .eq('id', id);
  if (error) throw error;
}
