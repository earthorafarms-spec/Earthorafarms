import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../src/lib/supabaseClient.js', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('../../../whatsapp-chatbot/provider.js', () => ({
  sendWhatsAppMessage: vi.fn(),
  sendWhatsAppImage: vi.fn(),
  sendWhatsAppProductCard: vi.fn(),
  WhatsAppDeliveryError: class WhatsAppDeliveryError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = 'WhatsAppDeliveryError';
      this.status = status;
    }
  },
}));

import {
  WHATSAPP_TIMEOUT_DISCLAIMER,
  WHATSAPP_TIMEOUT_NOTICES,
  buildWhatsAppTimeoutReply,
  resetWhatsAppTimeoutState,
  getWhatsAppActiveSubFlow,
  nextWhatsAppCheckoutQuestion,
  buildCartRemovalPromptReply,
} from '../../src/conversation/controller.js';
import { createInitialState } from '../../src/conversation/state.js';
import {
  saveWhatsAppTurn,
  claimExpiredWhatsAppFlowTimeout,
} from '../../../whatsapp-chatbot/events.repository.js';
import {
  drainExpiredFlowTimeouts,
  processInboxEvent,
} from '../../../whatsapp-chatbot/worker.js';
import {
  sendWhatsAppMessage,
  WhatsAppDeliveryError,
} from '../../../whatsapp-chatbot/provider.js';

describe('WhatsApp inactivity timeout specification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Active flow sets timeout (quantity, checkout, cart_removal)', async () => {
    // A. Quantity sub-flow
    const stateQuantity = createInitialState();
    stateQuantity.turnCount = 3;
    stateQuantity.whatsAppProductContext = {
      productId: 'prod-1',
      productName: 'Moringa Powder',
      awaitingQuantity: true,
      lastAction: 'add_to_cart',
    };
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveWhatsAppTurn(
      'evt-1',
      'vs-1',
      stateQuantity,
      'How many units would you like?',
    );

    expect(mockRpc).toHaveBeenCalledWith(
      'complete_whatsapp_message_turn_v2',
      expect.objectContaining({
        p_event_id: 'evt-1',
        p_voice_session_id: 'vs-1',
        p_flow_turn_count: 3,
        p_flow_timeout_kind: 'quantity',
      }),
    );
    const quantityTimeoutCall = mockRpc.mock.calls[0][1] as { p_flow_timeout_at: string };
    expect(quantityTimeoutCall.p_flow_timeout_at).toBeDefined();
    const timeoutDiffMs = new Date(quantityTimeoutCall.p_flow_timeout_at).getTime() - Date.now();
    // Around 5 minutes (300,000 ms)
    expect(timeoutDiffMs).toBeGreaterThanOrEqual(290_000);
    expect(timeoutDiffMs).toBeLessThanOrEqual(310_000);

    // B. Checkout sub-flow
    const stateCheckout = createInitialState();
    stateCheckout.turnCount = 5;
    stateCheckout.cart = [{ productId: 'prod-1', productName: 'Moringa Powder', quantity: 1, unitPrice: 400 }];
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveWhatsAppTurn(
      'evt-2',
      'vs-1',
      stateCheckout,
      "What is your full name?\n\nPlease reply within 5 minutes. If we don't receive a response, we'll return you to the main menu.",
    );

    expect(mockRpc).toHaveBeenLastCalledWith(
      'complete_whatsapp_message_turn_v2',
      expect.objectContaining({
        p_flow_turn_count: 5,
        p_flow_timeout_kind: 'checkout',
      }),
    );

    // C. Cart removal sub-flow
    const stateRemoval = createInitialState();
    stateRemoval.turnCount = 7;
    stateRemoval.awaitingCartRemoval = true;
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveWhatsAppTurn(
      'evt-3',
      'vs-1',
      stateRemoval,
      "Select an item to remove:\n1. Moringa Powder\nReply with the item number to remove.\n\nPlease reply within 5 minutes. If we don't receive a response, we'll return you to the main menu.",
    );

    expect(mockRpc).toHaveBeenLastCalledWith(
      'complete_whatsapp_message_turn_v2',
      expect.objectContaining({
        p_flow_turn_count: 7,
        p_flow_timeout_kind: 'cart_removal',
      }),
    );
  });

  it('2. Timeout expires after 5 minutes and is claimed by RPC', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          event_id: 'evt-timeout-1',
          phone_number: '+919876543210',
          voice_session_id: 'vs-1',
          flow_turn_count: 3,
          flow_timeout_kind: 'quantity',
          reply_text: buildWhatsAppTimeoutReply('en'),
        },
      ],
      error: null,
    });

    const claimed = await claimExpiredWhatsAppFlowTimeout();
    expect(claimed).not.toBeNull();
    expect(claimed?.phoneNumber).toBe('+919876543210');
    expect(claimed?.flowTurnCount).toBe(3);
    expect(claimed?.flowTimeoutKind).toBe('quantity');
    expect(claimed?.replyText).toContain("It looks like you've been away for a while.");

    // When none expired:
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const emptyClaim = await claimExpiredWhatsAppFlowTimeout();
    expect(emptyClaim).toBeNull();
  });

  it('3. Timeout preserves cart', () => {
    const state = createInitialState();
    state.cart = [
      { productId: 'prod-1', productName: 'Moringa Leaf Powder', quantity: 2, unitPrice: 399 },
      { productId: 'prod-2', productName: 'Moringa Capsules', quantity: 1, unitPrice: 499 },
    ];
    state.checkoutFields = { name: 'Adarsh', city: 'Ahmedabad' };
    state.whatsAppProductContext = { productId: 'prod-1', productName: 'Moringa Leaf Powder', awaitingQuantity: true };

    const resetState = resetWhatsAppTimeoutState(state);

    expect(resetState.cart).toEqual([
      { productId: 'prod-1', productName: 'Moringa Leaf Powder', quantity: 2, unitPrice: 399 },
      { productId: 'prod-2', productName: 'Moringa Capsules', quantity: 1, unitPrice: 499 },
    ]);
  });

  it('4. Timeout resets transient state (context, cart removal, checkout fields, review)', () => {
    const state = createInitialState();
    state.currentLanguage = 'gu';
    state.languageEstablished = true;
    state.cart = [{ productId: 'prod-1', productName: 'Moringa', quantity: 1, unitPrice: 399 }];
    state.whatsAppProductContext = { productId: 'prod-1', productName: 'Moringa', awaitingQuantity: true, lastAction: 'add_to_cart' };
    state.awaitingCartRemoval = true;
    state.activeCheckoutReview = {
      checkoutSessionId: 'sess_123',
      encryptedToken: 'enc_token',
      tokenExpiresAt: new Date().toISOString(),
      checkoutFingerprint: 'fp_123',
    };
    state.checkoutFields = { name: 'Adarsh', email: 'a@example.com', city: 'Surat' };

    const resetState = resetWhatsAppTimeoutState(state);

    expect(resetState.whatsAppProductContext).toBeUndefined();
    expect(resetState.awaitingCartRemoval).toBeUndefined();
    expect(resetState.activeCheckoutReview).toBeUndefined();
    expect(resetState.checkoutFields).toEqual({});
    // Durable state preserved:
    expect(resetState.currentLanguage).toBe('gu');
    expect(resetState.languageEstablished).toBe(true);
    expect(resetState.cart.length).toBe(1);
  });

  it('5. Timeout sends main menu with exact copy', () => {
    const reply = buildWhatsAppTimeoutReply('en');
    expect(reply).toBe(
      "It looks like you've been away for a while.\n\n" +
      "To keep things simple, I've returned you to the main menu.\n\n" +
      "Please choose an option:\n" +
      "1 → Products\n" +
      "2 → Benefits\n" +
      "3 → Policies\n" +
      "4 → Contact/Support"
    );
  });

  it('6. User reply before timeout cancels/stales timeout', async () => {
    const state = createInitialState();
    state.turnCount = 4;
    // User types "Menu" to exit active sub-flow:
    expect(getWhatsAppActiveSubFlow(state, 'Please choose an option:\n1 → Products...')).toBeNull();

    mockRpc.mockResolvedValueOnce({ error: null });
    await saveWhatsAppTurn('evt-4', 'vs-1', state, 'Hello! How can I assist you today?\n\nPlease choose an option:');

    expect(mockRpc).toHaveBeenCalledWith(
      'complete_whatsapp_message_turn_v2',
      expect.objectContaining({
        p_flow_timeout_at: null,
        p_flow_turn_count: null,
        p_flow_timeout_kind: null,
      }),
    );
  });

  it('7. User message at boundary: RPC query rejects claim when pending/processing message exists', async () => {
    // The RPC claim_expired_whatsapp_flow_timeout verifies:
    // NOT EXISTS (SELECT 1 FROM whatsapp_message_events WHERE processing_status IN ('pending', 'processing'))
    // When an inbound message is pending, RPC returns empty:
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const claimed = await claimExpiredWhatsAppFlowTimeout();
    expect(claimed).toBeNull();
  });

  it('8. Duplicate scanner ticks produce exactly one timeout', async () => {
    // First scanner tick claims the expired flow
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          event_id: 'evt-timeout-1',
          phone_number: '+919876543210',
          voice_session_id: 'vs-1',
          flow_turn_count: 2,
          flow_timeout_kind: 'quantity',
          reply_text: buildWhatsAppTimeoutReply('en'),
        },
      ],
      error: null,
    });
    // Second scanner tick (or subsequent RPC call in loop) finds no more expired rows
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    const claimedCount = await drainExpiredFlowTimeouts();
    expect(claimedCount).toBe(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+919876543210', expect.stringContaining("It looks like you've been away for a while."));
  });

  it('9. Provider failure retries without duplicate state mutation', async () => {
    const deliveryError = new WhatsAppDeliveryError(503);
    vi.mocked(sendWhatsAppMessage).mockRejectedValueOnce(deliveryError);

    mockRpc.mockResolvedValueOnce({
      data: [
        {
          event_id: 'evt-timeout-fail',
          phone_number: '+919876543210',
          voice_session_id: 'vs-1',
          flow_turn_count: 2,
          flow_timeout_kind: 'checkout',
          reply_text: buildWhatsAppTimeoutReply('en'),
        },
      ],
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    mockFrom.mockReturnValue({ update: mockUpdate });

    // 1. Drain attempts delivery and catches provider error, marking event failed
    const claimedCount = await drainExpiredFlowTimeouts();
    expect(claimedCount).toBe(1);
    expect(mockFrom).toHaveBeenCalledWith('whatsapp_message_events');

    // 2. On retry via processInboxEvent, replyText is already present:
    // It resends replyText directly without calling processTurn or mutating state
    vi.mocked(sendWhatsAppMessage).mockResolvedValueOnce();
    await processInboxEvent({
      id: 'evt-timeout-fail',
      providerMessageId: 'timeout:+919876543210:2',
      phone: '+919876543210',
      messageText: 'Inactivity timeout',
      replyText: buildWhatsAppTimeoutReply('en'),
      mediaUrl: null,
      mediaCaption: null,
      mediaSentAt: null,
      attemptCount: 2,
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith('+919876543210', expect.stringContaining("It looks like you've been away for a while."));
  });

  it('10. Timeout only applies to active sub-flows, not main menu, catalog, info, or conversation', () => {
    const state = createInitialState();

    // Main menu
    expect(getWhatsAppActiveSubFlow(state, 'Please choose an option:\n1 → Products\n2 → Benefits')).toBeNull();

    // Product catalog
    expect(getWhatsAppActiveSubFlow(state, '1. Moringa Leaf Powder — ₹399\n\nReply with the product number.')).toBeNull();

    // Product details / benefits
    expect(getWhatsAppActiveSubFlow(state, '*Benefits of Moringa:*\nBoosts energy and immunity.')).toBeNull();

    // Cart display
    expect(getWhatsAppActiveSubFlow(state, 'Your cart has 1 Moringa Leaf Powder. The exact total is ₹399.')).toBeNull();

    // Normal conversational reply
    expect(getWhatsAppActiveSubFlow(state, 'Moringa oleifera is also known as the drumstick tree.')).toBeNull();

    // ACTIVE: Quantity
    state.whatsAppProductContext = { productId: 'p1', productName: 'Moringa', awaitingQuantity: true };
    expect(getWhatsAppActiveSubFlow(state)).toBe('quantity');

    // ACTIVE: Cart removal
    delete state.whatsAppProductContext;
    state.awaitingCartRemoval = true;
    expect(getWhatsAppActiveSubFlow(state)).toBe('cart_removal');

    // ACTIVE: Checkout
    delete state.awaitingCartRemoval;
    state.cart = [{ productId: 'p1', productName: 'Moringa', quantity: 1, unitPrice: 399 }];
    expect(getWhatsAppActiveSubFlow(state, "What is your full name?\n\nPlease reply within 5 minutes.")).toBe('checkout');
  });

  it('11. Language-specific timeout notice and prompts work for en, hi, gu', () => {
    // English
    const enReply = buildWhatsAppTimeoutReply('en');
    expect(enReply).toContain("It looks like you've been away for a while.");
    expect(enReply).toContain("To keep things simple, I've returned you to the main menu.");
    expect(enReply).toContain("1 → Products");

    // Hindi
    const hiReply = buildWhatsAppTimeoutReply('hi');
    expect(hiReply).toContain("ऐसा लगता है कि आप कुछ समय से दूर हैं।");
    expect(hiReply).toContain("चीजों को सरल रखने के लिए, मैंने आपको मुख्य मेन्यू पर वापस ला दिया है।");
    expect(hiReply).toContain("1 → Products");

    // Gujarati
    const guReply = buildWhatsAppTimeoutReply('gu');
    expect(guReply).toContain("એવું લાગે છે કે તમે થોડા સમય માટે દૂર છો.");
    expect(guReply).toContain("સરળતા ખાતર, હું તમને મુખ્ય મેનુ પર પાછો લાવ્યો છું.");
    expect(guReply).toContain("1 → Products");

    // Active sub-flow prompt disclaimers:
    const stateEn = createInitialState();
    stateEn.currentLanguage = 'en';
    stateEn.cart = [{ productId: 'p1', productName: 'Moringa', quantity: 1, unitPrice: 399 }];
    expect(nextWhatsAppCheckoutQuestion(stateEn)).toContain(WHATSAPP_TIMEOUT_DISCLAIMER.en);

    const stateHi = createInitialState();
    stateHi.currentLanguage = 'hi';
    stateHi.cart = [{ productId: 'p1', productName: 'Moringa', quantity: 1, unitPrice: 399 }];
    expect(nextWhatsAppCheckoutQuestion(stateHi)).toContain(WHATSAPP_TIMEOUT_DISCLAIMER.hi);

    const stateGu = createInitialState();
    stateGu.currentLanguage = 'gu';
    stateGu.cart = [{ productId: 'p1', productName: 'Moringa', quantity: 1, unitPrice: 399 }];
    expect(nextWhatsAppCheckoutQuestion(stateGu)).toContain(WHATSAPP_TIMEOUT_DISCLAIMER.gu);

    // Cart removal prompt with channel === 'text' includes disclaimer:
    const removalText = buildCartRemovalPromptReply(stateEn.cart, 'en', false, 'text');
    expect(removalText).toContain(WHATSAPP_TIMEOUT_DISCLAIMER.en);

    // Cart removal prompt with channel === 'voice' or omitted does NOT include disclaimer:
    const removalVoice = buildCartRemovalPromptReply(stateEn.cart, 'en', false, 'voice');
    expect(removalVoice).not.toContain(WHATSAPP_TIMEOUT_DISCLAIMER.en);
  });

  it('12. Protected POST /whatsapp/timeout-tick rejects unauthorized requests and executes timeout drain when authorized', async () => {
    const { default: Fastify } = await import('fastify');
    const { config } = await import('../../src/config.js');
    const { registerWhatsAppRoutes } = await import('../../../whatsapp-chatbot/routes.js');

    const app = Fastify();
    await registerWhatsAppRoutes(app);

    // 1. Missing secret -> 403 Forbidden
    const unauthed = await app.inject({
      method: 'POST',
      url: '/whatsapp/timeout-tick',
    });
    expect(unauthed.statusCode).toBe(403);
    expect(unauthed.json()).toEqual({ error: 'forbidden' });

    // 2. Wrong secret -> 403 Forbidden
    const wrongSecret = await app.inject({
      method: 'POST',
      url: '/whatsapp/timeout-tick',
      headers: { 'x-timeout-tick-secret': 'invalid-secret-key-123' },
    });
    expect(wrongSecret.statusCode).toBe(403);

    // 3. Authorized secret -> 200 OK with claimed count
    const validSecret = config.WHATSAPP_TIMEOUT_TICK_SECRET
      ?? config.TATA_OMNI_WEBHOOK_SECRET
      ?? config.TOKEN_SIGNING_SECRET;

    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const authed = await app.inject({
      method: 'POST',
      url: '/whatsapp/timeout-tick',
      headers: { 'x-timeout-tick-secret': validSecret },
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual({ ok: true, claimed: 0 });

    await app.close();
  });
});
