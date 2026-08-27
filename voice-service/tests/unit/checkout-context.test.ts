import { describe, expect, it } from 'vitest';
import { buildCheckoutTurnInstruction } from '../../src/conversation/checkout-context.js';
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
});
