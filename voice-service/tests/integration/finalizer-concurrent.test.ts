import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const RUN = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!RUN)('finalize_voice_order — concurrent calls for one session', () => {
  let supabase: import('@supabase/supabase-js').SupabaseClient;
  let productId: string;
  let checkoutSessionId: string;
  let orderIds: string[] = [];

  beforeAll(async () => {
    const { supabase: client } = await import('../../src/lib/supabaseClient.js');
    supabase = client;

    const { data: product } = await supabase
      .from('products')
      .insert({ slug: `test-concurrent-${Date.now()}`, name: 'Test Product', mrp: 250, price: 250 })
      .select('id')
      .single();
    productId = (product as { id: string }).id;

    await supabase.from('inventory').insert({ product_id: productId, total_stock: 100 });

    const { data: callSession } = await supabase
      .from('voice_call_sessions')
      .insert({ provider: 'browser' })
      .select('id')
      .single();

    const { data: checkoutSession } = await supabase
      .from('voice_checkout_sessions')
      .insert({
        call_session_id: (callSession as { id: string }).id,
        verification_token_hash: `test-hash-concurrent-${Date.now()}`,
        token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        name: 'Test Customer', email: `concurrent-${Date.now()}@example.com`, phone: '9999999999',
        address: 'Test address', city: 'Surat', state: 'Gujarat', postal_code: '395003',
        currency: 'INR',
        frozen_pricing: { total: 250, currency: 'INR' },
      })
      .select('id')
      .single();
    checkoutSessionId = (checkoutSession as { id: string }).id;

    await supabase.from('voice_checkout_items').insert({
      checkout_session_id: checkoutSessionId,
      product_id: productId,
      quantity: 1,
      provisional_unit_price: 250,
      frozen_unit_price: 250,
    });
  });

  afterAll(async () => {
    for (const id of orderIds) {
      await supabase.from('order_items').delete().eq('order_id', id);
      await supabase.from('Payments').delete().eq('payment_order_id', id);
      await supabase.from('Order_history').delete().eq('order_id', id);
      await supabase.from('orders').delete().eq('id', id);
    }
    await supabase.from('voice_checkout_items').delete().eq('checkout_session_id', checkoutSessionId);
    await supabase.from('voice_checkout_sessions').delete().eq('id', checkoutSessionId);
    await supabase.from('inventory').delete().eq('product_id', productId);
    await supabase.from('products').delete().eq('id', productId);
  });

  it('two concurrent finalize calls for the same session return the same order and create one row', async () => {
    const { finalizeVoiceOrder } = await import('../../src/repositories/orders.repository.js');

    const [orderIdA, orderIdB] = await Promise.all([
      finalizeVoiceOrder({ checkoutSessionId, razorpayPaymentId: 'pay_concurrent', paidAmount: 250, paidCurrency: 'INR' }),
      finalizeVoiceOrder({ checkoutSessionId, razorpayPaymentId: 'pay_concurrent', paidAmount: 250, paidCurrency: 'INR' }),
    ]);

    expect(orderIdA).toBe(orderIdB);
    orderIds = [orderIdA];

    const { data: orders } = await supabase.from('orders').select('id').eq('id', orderIdA);
    expect(orders).toHaveLength(1);

    const { data: items } = await supabase.from('order_items').select('id').eq('order_id', orderIdA);
    expect(items).toHaveLength(1); // not duplicated
  });
});
