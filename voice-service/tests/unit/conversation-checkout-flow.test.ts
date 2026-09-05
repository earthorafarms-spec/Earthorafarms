import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { resetGuardState } from '../../src/conversation/output-policy.js';

const mocks = vi.hoisted(() => ({ chat: vi.fn(), createSession: vi.fn(), saveItem: vi.fn(), send: vi.fn() }));
vi.mock('../../src/providers.js', () => ({ chatWithRouting: mocks.chat }));
vi.mock('../../../whatsapp-chatbot/provider.js', () => ({ sendWhatsAppCheckoutForm: mocks.send }));
vi.mock('../../src/repositories/checkoutSessions.repository.js', () => ({ createCheckoutSession: mocks.createSession }));
vi.mock('../../src/repositories/checkoutItems.repository.js', () => ({ upsertCheckoutItem: mocks.saveItem }));
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
    mocks.saveItem.mockResolvedValue(undefined);
    mocks.send.mockReset().mockResolvedValue(undefined);
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
    expect(JSON.stringify(result.state)).not.toContain(mocks.send.mock.calls[0][1]);
    expect(result.state.currentTurnFacts.some(f => f.toolName === 'create_verification_link' && JSON.parse(f.resultJson).ok)).toBe(true);
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

  it('does not switch to Hindi when the first checkout name is transcribed in Devanagari', async () => {
    const state = checkoutState();
    state.checkoutFields = {};
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'What is your email address?' });
    const result = await processTurn('flow', state, 'हेली');
    expect(result.state.currentLanguage).toBe('en');
  });

  it('allows an explicit language change during checkout', async () => {
    mocks.chat.mockResolvedValueOnce({ kind: 'message', content: 'जी, हम हिंदी में बात कर सकते हैं।' });
    const result = await processTurn('flow', checkoutState(), 'Please speak Hindi');
    expect(result.state.currentLanguage).toBe('hi');
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
});
