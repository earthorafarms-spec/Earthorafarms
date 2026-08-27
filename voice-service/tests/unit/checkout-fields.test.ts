import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { setCheckoutFieldTool, setDeliveryLocationTool } from '../../src/tools/checkout.js';

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
});
