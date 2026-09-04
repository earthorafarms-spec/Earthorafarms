import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { createVerificationLinkTool, setCheckoutFieldTool, setDeliveryLocationTool } from '../../src/tools/checkout.js';
import { createPaymentLinkBodySchema } from '../../src/schemas/checkout.js';

describe('checkout field validation', () => {
  it('does not coerce the string "false" to true', async () => {
    const state = createInitialState();
    const result = await setCheckoutFieldTool.handler(
      { field: 'marketingConsent', value: 'false' },
      { callSessionId: 'session-1', state }
    );
    expect(result).toMatchObject({ ok: true });
    expect(state.checkoutFields.marketingConsent).toBe(false);
  });

  it('rejects ambiguous consent values', async () => {
    const state = createInitialState();
    const result = await setCheckoutFieldTool.handler(
      { field: 'marketingConsent', value: 'yes' },
      { callSessionId: 'session-1', state }
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_value' });
  });

  it('stores city and state together and normalizes common spoken forms', async () => {
    const state = createInitialState();
    const result = await setDeliveryLocationTool.handler(
      { city: 'अहमदाबाद', state: 'गुजरात' },
      { callSessionId: 'session-1', state }
    );

    expect(result).toMatchObject({ ok: true, city: 'Ahmedabad', state: 'Gujarat' });
    expect(state.checkoutFields).toMatchObject({ city: 'Ahmedabad', state: 'Gujarat' });
  });

  it('asks the optional GST question before creating the form and accepts a decline', async () => {
    const state = createInitialState();
    state.cart.push({ productId: 'product-1', productName: 'Alpha', quantity: 1, unitPrice: 90 });
    Object.assign(state.checkoutFields, {
      name: 'Heli Parmar', email: 'heli@example.com', phone: '9876543210', address: '35 Test Road',
      city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001', country: 'India',
    });

    const unanswered = await createVerificationLinkTool.handler({}, { callSessionId: 'session-1', state });
    expect(unanswered).toMatchObject({ ok: false, reason: 'gst_question_not_answered' });

    state.checkoutFields.gst = '';
    const declined = await createVerificationLinkTool.handler({}, { callSessionId: 'session-1', state });
    expect(declined).toMatchObject({ ok: false, reason: 'whatsapp_not_configured' });
  });
});

describe('payment confirmation validation', () => {
  it('requires an explicit true confirmation from the reviewed form', () => {
    expect(createPaymentLinkBodySchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(createPaymentLinkBodySchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(createPaymentLinkBodySchema.safeParse({}).success).toBe(false);
  });
});
