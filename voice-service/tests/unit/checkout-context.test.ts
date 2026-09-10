import { describe, expect, it } from 'vitest';
import { buildCheckoutTurnInstruction, getVoiceInputExpectation } from '../../src/conversation/checkout-context.js';
import { createInitialState } from '../../src/conversation/state.js';

describe('checkout turn context', () => {
  it('treats a short location reply as the expected field and accepts city plus state together', () => {
    const state = createInitialState();
    state.cart.push({ productId: 'p1', productName: 'Alpha', quantity: 1, unitPrice: 1 });
    Object.assign(state.checkoutFields, {
      name: 'Heli Parmar', email: 'heli@example.com', phone: '9876543210', address: '35 Test Road',
    });

    const instruction = buildCheckoutTurnInstruction(state);
    expect(instruction).toContain('CHECKOUT FIELD EXPECTED NOW: city');
    expect(instruction).toContain('set_delivery_location');
    expect(instruction).toMatch(/Do not ask.*translate.*English/i);
  });

  it('requires the optional GST question after required delivery fields', () => {
    const state = createInitialState();
    state.cart.push({ productId: 'p1', productName: 'Alpha', quantity: 1, unitPrice: 1 });
    Object.assign(state.checkoutFields, {
      name: 'Heli Parmar', email: 'heli@example.com', phone: '9876543210', address: '35 Test Road',
      city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001', country: 'India',
    });

    expect(buildCheckoutTurnInstruction(state)).toContain('OPTIONAL GST QUESTION REQUIRED NOW');
    state.checkoutFields.gst = '';
    expect(buildCheckoutTurnInstruction(state)).toContain('CHECKOUT READY NOW');
  });

  it('identifies PIN and quantity turns for speech recognition context', () => {
    const state = createInitialState();
    state.cart.push({ productId: 'p1', productName: 'Alpha', quantity: 1, unitPrice: 1 });
    Object.assign(state.checkoutFields, {
      name: 'Test User', email: 'test@example.com', phone: '+919876543210', address: '1 Test Road',
      city: 'Ahmedabad', state: 'Gujarat',
    });
    expect(getVoiceInputExpectation(state)).toBe('postalCode');

    const quantityState = createInitialState();
    quantityState.messages.push({ role: 'assistant', content: 'How many bottles would you like?' });
    expect(getVoiceInputExpectation(quantityState)).toBe('quantity');
  });
});
