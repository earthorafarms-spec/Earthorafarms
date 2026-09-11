import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { resetGuardState } from '../../src/conversation/output-policy.js';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(), createSession: vi.fn(), saveItem: vi.fn(), send: vi.fn(),
  findSession: vi.fn(), listProducts: vi.fn(), listDeals: vi.fn(), getProduct: vi.fn(),
}));
vi.mock('../../src/providers.js', () => ({ chatWithRouting: mocks.chat }));
vi.mock('../../../whatsapp-chatbot/provider.js', () => ({ sendWhatsAppCheckoutForm: mocks.send }));
vi.mock('../../src/repositories/checkoutSessions.repository.js', () => ({
  createCheckoutSession: mocks.createSession,
  findCheckoutSessionByTokenHash: mocks.findSession,
}));
vi.mock('../../src/repositories/checkoutItems.repository.js', () => ({ upsertCheckoutItem: mocks.saveItem }));
vi.mock('../../src/repositories/products.repository.js', () => ({
  listActiveProducts: mocks.listProducts,
  listActiveFestivalDeals: mocks.listDeals,
  getProductById: mocks.getProduct,
}));
vi.mock('../../src/repositories/knowledge.repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/repositories/knowledge.repository.js')>()),
  getAllApprovedKnowledge: vi.fn().mockResolvedValue([]),
  getApprovedKnowledge: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config.js')>();
  return { config: { ...actual.config, whatsappCheckoutConfigured: true } };
});
import { processTurn } from '../../src/conversation/controller.js';

function checkoutState() {
  const state = createInitialState();
  state.cart = [
    { productId: 'alpha', productName: 'Alpha', quantity: 2, unitPrice: 90 },
    { productId: 'beta', productName: 'Beta', quantity: 2, unitPrice: 110 },
  ];
  state.checkoutFields = {
    name: 'Test Customer', email: 'test@example.com', phone: '919876543210', address: '35 Test Road',
    city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001', country: 'India',
  };
  return state;
}

function toolCall(name: string, args: Record<string, unknown>, id = 'tool-1') {
  return { id, name, argumentsJson: JSON.stringify(args) };
}

describe('conversation checkout regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.mockReset();
    mocks.createSession.mockResolvedValue({ id: 'checkout-1' });
    mocks.findSession.mockReset().mockResolvedValue({ id: 'checkout-1' });
    mocks.saveItem.mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue(undefined);
    mocks.listProducts.mockReset().mockResolvedValue([]);
    mocks.listDeals.mockReset().mockResolvedValue([]);
    mocks.getProduct.mockReset().mockResolvedValue(null);
    resetGuardState('flow');
  });

  it('automatically sends both product lines after GST is declined, without another model turn', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('set_checkout_field', { field: 'gst', value: '' })] });
    const result = await processTurn('flow', checkoutState(), 'No');
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.saveItem.mock.calls).toEqual([['checkout-1', 'alpha', 2, 90], ['checkout-1', 'beta', 2, 110]]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith('+919876543210', expect.stringContaining('/voice-checkout/'));
    expect(result.replyText).toContain('review or edit');
    expect(result.replyText).toContain('say yes');
    expect(result.state.awaitingReviewReceiptConfirmation).toBe(true);
    expect(result.callShouldEnd).not.toBe(true);
    expect(JSON.stringify(result.state)).not.toContain(mocks.send.mock.calls[0][1]);
    expect(result.state.currentTurnFacts.some(f => f.toolName === 'create_verification_link' && JSON.parse(f.resultJson).ok)).toBe(true);
  });

  it('ends only after the caller confirms receiving the WhatsApp review link', async () => {
    const state = checkoutState();
    state.awaitingReviewReceiptConfirmation = true;

    const result = await processTurn('flow', state, 'Yes, I received it');

    expect(result.callShouldEnd).toBe(true);
    expect(result.state.awaitingReviewReceiptConfirmation).toBe(false);
    expect(result.replyText).toContain('Thank you for confirming');
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('does not treat "not received" as a positive review-link confirmation', async () => {
    const state = checkoutState();
    state.awaitingReviewReceiptConfirmation = true;
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'I will keep the call open while we check it.' });

    const result = await processTurn('flow', state, 'No, I have not received it');

    expect(result.callShouldEnd).not.toBe(true);
    expect(result.state.awaitingReviewReceiptConfirmation).toBe(true);
  });

  it('does not report success when WhatsApp fails', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('set_checkout_field', { field: 'gst', value: '' })] });
    mocks.send.mockRejectedValue(new Error('provider failure'));
    const result = await processTurn('flow', checkoutState(), 'No');
    expect(result.replyText).toContain('couldn’t send');
    expect(result.state.currentTurnFacts.some(f => f.toolName === 'create_verification_link' && JSON.parse(f.resultJson).ok)).toBe(false);
  });

  it('does not auto-send twice when the model already sent the form in the same batch', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'tool_calls', calls: [
      toolCall('set_checkout_field', { field: 'gst', value: '' }),
      toolCall('create_verification_link', {}, 'tool-2'),
    ] });
    await processTurn('flow', checkoutState(), 'No');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('returns one durable review link for an inbound WhatsApp turn instead of sending a second template', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('set_checkout_field', { field: 'gst', value: '' })] });

    const result = await processTurn('flow', checkoutState(), 'No', 'text');

    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.replyText).toMatch(/order-review form is ready:\nhttps?:\/\/[^\s]+\/voice-checkout\/[a-f0-9]{32}/i);
    expect(result.replyText).toContain('No order or payment has been completed yet');
    expect(result.outboundActions).toHaveLength(1);
  });

  it('resends the same valid review form without creating a duplicate checkout session', async () => {
    mocks.chat
      .mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('set_checkout_field', { field: 'gst', value: '' })] })
      .mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('create_verification_link', {})] });

    const first = await processTurn('flow', checkoutState(), 'No', 'text');
    const second = await processTurn('flow', first.state, 'Please send the form again', 'text');
    const firstUrl = first.replyText.match(/https?:\/\/\S+/)?.[0];
    const secondUrl = second.replyText.match(/https?:\/\/\S+/)?.[0];

    expect(firstUrl).toBeTruthy();
    expect(secondUrl).toBe(firstUrl);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.findSession).toHaveBeenCalledTimes(1);
  });

  it('refreshes the expected field after recording both short location values', async () => {
    const state = checkoutState();
    delete state.checkoutFields.city;
    delete state.checkoutFields.state;
    delete state.checkoutFields.postalCode;
    mocks.chat.mockResolvedValueOnce({ kind: 'tool_calls', calls: [toolCall('set_delivery_location', { city: 'Ahmedabad', state: 'Gujarat' })] })
      .mockResolvedValueOnce({ kind: 'message', content: 'What is your PIN code?' });
    const result = await processTurn('flow', state, 'Ahmedabad, Gujarat');
    expect(result.state.checkoutFields).toMatchObject({ city: 'Ahmedabad', state: 'Gujarat' });
    expect(mocks.chat.mock.calls[1][0][0].content).toContain('CHECKOUT FIELD EXPECTED NOW: postalCode');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('switches to the confidently detected language even during checkout', async () => {
    const state = checkoutState();
    state.checkoutFields = {};
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'आपका ईमेल एड्रेस क्या है?' });
    const result = await processTurn('flow', state, 'हेली');
    expect(result.state.currentLanguage).toBe('hi');
  });

  it('allows an explicit language change during checkout', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'जी, हम हिंदी में बात कर सकते हैं।' });
    const result = await processTurn('flow', checkoutState(), 'Please speak Hindi');
    expect(result.state.currentLanguage).toBe('hi');
  });

  it('keeps a voice call in its initially established language through later code switching', async () => {
    const state = checkoutState();
    state.currentLanguage = 'hi';
    state.languageEstablished = true;
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'कृपया अपना ईमेल एड्रेस बताइए।' });

    const result = await processTurn('flow', state, 'My email is customer@example.com');

    expect(result.state.currentLanguage).toBe('hi');
    expect(result.state.languageEstablished).toBe(true);
  });

  it('uses a proper Hindi farewell instead of namaste when the caller ends without an order', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.languageEstablished = true;

    const result = await processTurn('flow', state, 'अलविदा');

    expect(result.callShouldEnd).toBe(true);
    expect(result.replyText).not.toMatch(/नमस्ते/u);
    expect(result.replyText).toMatch(/धन्यवाद|फिर बात/u);
  });

  it('regenerates an unrelated-language reply and uses a same-language fallback if it repeats', async () => {
    const state = checkoutState();
    state.currentLanguage = 'hi';
    mocks.chat.mockResolvedValue({ kind: 'message', content: 'Здравствуйте, как ваши дела?' });
    const result = await processTurn('flow', state, 'हाँ');
    expect(mocks.chat).toHaveBeenCalledTimes(2);
    expect(result.replyText).toContain('मेरे पास');
    expect(result.replyText).not.toContain('Здравствуйте');
  });

  describe('WhatsApp deterministic GST checkout flow', () => {
    beforeEach(() => {
      mocks.listProducts.mockResolvedValue([
        { id: 'alpha', name: 'Alpha', price: 90, status: 'active', stockLabel: 'In Stock' },
      ]);
      mocks.getProduct.mockResolvedValue({
        id: 'alpha', name: 'Alpha', price: 90, found: true, stockLabel: 'In Stock', imageUrl: 'https://cdn.example.com/alpha.png',
      });
    });

    it('returns GST question only and NO product card when user answers country with Yes', async () => {
      const state = checkoutState();
      delete state.checkoutFields.country;
      state.messages.push({ role: 'assistant', content: 'Is the delivery address in India?' });

      const result = await processTurn('flow', state, 'Yes', 'text');

      expect(result.state.checkoutFields.country).toBe('India');
      expect(result.state.checkoutFields.gst).toBeUndefined();
      expect(result.replyText).toContain('Do you have a GST number for a business tax invoice?');
      expect(result.replyText).toContain("Please reply within 5 minutes. If we don't receive a response, we'll return you to the main menu.");
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it.each([
      'Yes', 'Yup', 'Yep', 'Yeah', 'Sure', 'Correct', 'Haan', 'हाँ', 'હા', 'India',
      'haanji', 'ji haan', 'हां', 'જી હા', 'in india', 'Bharat',
    ])('normalizes affirmative answer "%s" to country India deterministically and asks GST question', async (input) => {
      const state = checkoutState();
      delete state.checkoutFields.country;
      state.messages.push({ role: 'assistant', content: 'Is the delivery address in India?' });

      const result = await processTurn('flow', state, input, 'text');

      expect(['India', 'भारत', 'ભારત']).toContain(result.state.checkoutFields.country);
      expect(result.state.checkoutFields.gst).toBeUndefined();
      expect(result.replyText).toMatch(/Do you have a GST number for a business tax invoice\?|क्या आपके पास बिजनेस टैक्स इनवॉइस|શું તમારી પાસે બિઝનેસ ટેક્સ ઇનવોઇસ/i);
      expect(result.replyText).toMatch(/Please reply within 5 minutes|कृपया 5 मिनट के भीतर उत्तर दें|કૃપા કરીને 5 મિનિટની અંદર જવાબ આપો/i);
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it.each([
      'No', 'Nope', 'Nah', 'nahi', 'नहीं', 'ના', 'Dubai', 'USA',
    ])('handles negative/non-India answer "%s" deterministically without storing country', async (input) => {
      const state = checkoutState();
      delete state.checkoutFields.country;
      state.messages.push({ role: 'assistant', content: 'Is the delivery address in India?' });

      const result = await processTurn('flow', state, input, 'text');

      expect(result.state.checkoutFields.country).toBeUndefined();
      expect(result.replyText).toMatch(/deliver(?:y)?\s+only\s+within\s+India|केवल\s+भारत|ફક્ત\s+ભારતમાં/iu);
      expect(result.replyText).toMatch(/Is the delivery address in India\?|क्या डिलीवरी एड्रेस भारत में है\?|શું ડિલિવરી એડ્રેસ ભારતમાં છે\?/i);
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it('continues checkout to review form when GST is declined with No', async () => {
      const state = checkoutState();
      state.messages.push({ role: 'assistant', content: 'Do you have a GST number for a business tax invoice?' });

      const result = await processTurn('flow', state, 'No', 'text');

      expect(result.state.checkoutFields.gst).toBe('');
      expect(result.replyText).toMatch(/order-review form is ready/i);
      expect(result.outboundActions?.find((a) => a.type === 'checkout_review')).toBeDefined();
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it('continues checkout to review form when valid GST number is provided', async () => {
      const state = checkoutState();
      state.messages.push({ role: 'assistant', content: 'Do you have a GST number for a business tax invoice?' });

      const result = await processTurn('flow', state, '27ABCDE1234F1Z5', 'text');

      expect(result.state.checkoutFields.gst).toBe('27ABCDE1234F1Z5');
      expect(result.replyText).toMatch(/order-review form is ready/i);
      expect(result.outboundActions?.find((a) => a.type === 'checkout_review')).toBeDefined();
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it('prompts for GST number and does not resolve to a product card when answering Yes while awaiting GST', async () => {
      const state = checkoutState();
      state.messages.push({ role: 'assistant', content: 'Do you have a GST number for a business tax invoice?' });

      const result = await processTurn('flow', state, 'Yes', 'text');

      expect(result.replyText).toContain('Please share your GST number for a business tax invoice, or reply No to skip.');
      expect(result.state.checkoutFields.gst).toBeUndefined();
      expect(result.productCard).toBeUndefined();
      expect(result.productImage).toBeUndefined();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it('allows normal product browsing/card flow outside of checkout', async () => {
      mocks.listProducts.mockResolvedValue([
        { id: 'alpha', name: 'Alpha', price: 90, status: 'active', stockLabel: 'In Stock', description: 'Alpha description' },
      ]);
      mocks.getProduct.mockResolvedValue({
        id: 'alpha', name: 'Alpha', price: 90, mrp: 100, stockLabel: 'In Stock',
        description: 'Alpha description', imageUrl: 'https://cdn.example.com/alpha.png',
      });
      const state = createInitialState();
      state.messages.push({
        role: 'assistant',
        content: '1. Alpha — ₹90 (Tax Included) — In Stock\n\nReply with the product number.\nTo return to the main menu, type Menu.',
      });
      mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'Here is information on Alpha.' });

      const result = await processTurn('flow', state, '1', 'text');

      expect(result.productCard).toBeDefined();
      expect(result.productCard?.productId).toBe('alpha');
    });
  });
});
