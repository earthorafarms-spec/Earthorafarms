import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Full-stack e2e: real OpenAI call, real Supabase test project. Skipped
// unless RUN_INTEGRATION_TESTS=1 AND a real OPENAI_API_KEY are both present
// — this test costs real money/tokens per run, so it must never run by
// accident in CI without both being deliberately configured.
const RUN = process.env.RUN_INTEGRATION_TESTS === '1'
  && Boolean(process.env.OPENAI_API_KEY)
  && (
    (process.env.WHATSAPP_PROVIDER === 'tata_omni'
      && Boolean(process.env.TATA_OMNI_ACCESS_TOKEN)
      && Boolean(process.env.WHATSAPP_CHECKOUT_TEMPLATE_NAME))
    || (Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID) && Boolean(process.env.WHATSAPP_TOKEN))
  )
  && Boolean(process.env.E2E_WHATSAPP_PHONE);
const testWhatsappPhone = process.env.E2E_WHATSAPP_PHONE ?? '';

describe.skipIf(!RUN)('text-mode conversation end to end', () => {
  let supabase: import('@supabase/supabase-js').SupabaseClient;
  let productId: string;
  let callSessionId: string;

  beforeAll(async () => {
    const { supabase: client } = await import('../../src/lib/supabaseClient.js');
    supabase = client;

    const { data: product } = await supabase
      .from('products')
      .insert({ slug: `test-e2e-${Date.now()}`, name: 'E2E Test Moringa Powder', mrp: 500, price: 500, status: 'active' })
      .select('id')
      .single();
    productId = (product as { id: string }).id;
    await supabase.from('inventory').insert({ product_id: productId, total_stock: 50 });

    const { createCallSession } = await import('../../src/repositories/callSessions.repository.js');
    const { createInitialState } = await import('../../src/conversation/state.js');
    const session = await createCallSession(createInitialState());
    callSessionId = session.id;
  });

  afterAll(async () => {
    await supabase.from('voice_checkout_items').delete().eq('product_id', productId);
    await supabase.from('voice_checkout_sessions').delete().eq('email', 'e2e-test@example.com');
    await supabase.from('voice_call_sessions').delete().eq('id', callSessionId);
    await supabase.from('inventory').delete().eq('product_id', productId);
    await supabase.from('products').delete().eq('id', productId);
  });

  it('builds a cart, collects checkout fields, and sends a review form without leaking the raw token', async () => {
    const { processTurn } = await import('../../src/conversation/controller.js');
    const { getCallSession } = await import('../../src/repositories/callSessions.repository.js');

    let state = (await getCallSession(callSessionId))!.conversationState;

    const turns = [
      'I want to buy the E2E Test Moringa Powder, one unit.',
      `My name is Jane Doe, email e2e-test@example.com, phone ${testWhatsappPhone}.`,
      'My address is 123 Test Lane, Ahmedabad, Gujarat, 380001, India.',
      "That's everything, please send me the checkout link.",
    ];

    for (const turn of turns) {
      const outcome = await processTurn(callSessionId, state, turn);
      state = outcome.state;
    }

    // The raw verification token/URL must never appear anywhere in the
    // persisted transcript — see tools/checkout.ts's create_verification_link.
    const fullTranscript = JSON.stringify(state.messages);
    expect(fullTranscript).not.toMatch(/voice-checkout\/[A-Za-z0-9_-]{20,}/);

    const { data: checkoutSessions } = await supabase
      .from('voice_checkout_sessions')
      .select('id, verification_token_hash')
      .eq('email', 'e2e-test@example.com');

    expect(checkoutSessions ?? []).toHaveLength(1);
    // Hash is 64 hex chars (sha256) — confirms a hash was stored, not the raw token.
    expect(checkoutSessions![0].verification_token_hash).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
