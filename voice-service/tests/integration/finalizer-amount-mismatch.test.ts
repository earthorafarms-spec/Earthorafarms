import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// See webhook-idempotency.test.ts for why these are skipped by default.
const RUN = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!RUN)('finalize_voice_order — amount/currency mismatch', () => {
  let supabase: import('@supabase/supabase-js').SupabaseClient;
  let productId: string;
  let checkoutSessionId: string;

  beforeAll(async () => {
    const { supabase: client } = await import('../../src/lib/supabaseClient.js');
    supabase = client;

    const { data: product } = await supabase
      .from('products')
      .insert({ slug: `test-mismatch-${Date.now()}`, name: 'Test Product', mrp: 100, price: 100 })
      .select('id')
      .single();
    productId = (product as { id: string }).id;

    const { data: callSession } = await supabase
      .from('voice_call_sessions')
      .insert({ provider: 'browser' })
      .select('id')
      .single();

    const { data: checkoutSession } = await supabase
      .from('voice_checkout_sessions')
      .insert({
        call_session_id: (callSession as { id: string }).id,
        verification_token_hash: `test-hash-${Date.now()}`,
        token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        name: 'Test Customer', email: 'test@example.com', phone: '9999999999',
        address: 'Test address', city: 'Ahmedabad', state: 'Gujarat', postal_code: '380001',
        currency: 'INR',
        frozen_pricing: { total: 100, currency: 'INR' },
      })
      .select('id')
      .single();
    checkoutSessionId = (checkoutSession as { id: string }).id;
  });

  afterAll(async () => {
    await supabase.from('voice_checkout_sessions').delete().eq('id', checkoutSessionId);
    await supabase.from('products').delete().eq('id', productId);
  });

  it('raises and creates no order when the paid amount does not match the frozen total', async () => {
    const { finalizeVoiceOrder } = await import('../../src/repositories/orders.repository.js');

    await expect(
      finalizeVoiceOrder({
        checkoutSessionId,
        razorpayPaymentId: 'pay_wrong_amount',
        paidAmount: 1, // frozen total was 100
        paidCurrency: 'INR',
      })
    ).rejects.toThrow();

    const { data: orders } = await supabase.from('orders').select('id').eq('user_id', 'test@example.com');
    expect(orders ?? []).toHaveLength(0);
  });
});
