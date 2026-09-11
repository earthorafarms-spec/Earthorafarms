import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { createVerificationLinkTool, setCheckoutFieldTool, setDeliveryLocationTool, normalizeSpokenDigitSequence, normalizeWhatsAppPhone } from '../../src/tools/checkout.js';
import { createPaymentLinkBodySchema } from '../../src/schemas/checkout.js';

describe('checkout field validation', () => {
  it.each(['9876543210', '919876543210', '+91 98765-43210', '09876543210', '९८७६५४३२१०'])('normalizes %s without duplicating the country code', (phone) => {
    expect(normalizeWhatsAppPhone(phone)).toBe('+919876543210');
  });
  it.each(['1234', '+91919876543210', 'yes', '9876543210 garbage'])('rejects an invalid WhatsApp number: %s', (phone) => {
    expect(normalizeWhatsAppPhone(phone)).toBeNull();
  });

  it('converts English, Hindi and Gujarati spoken digits without inventing missing digits', () => {
    expect(normalizeSpokenDigitSequence('seven nine eight four seven six nine four seven two')).toBe('7984769472');
    expect(normalizeSpokenDigitSequence('सात नौ आठ चार सात छह नौ चार सात दो')).toBe('7984769472');
    expect(normalizeSpokenDigitSequence('સાત નવ આઠ ચાર સાત છ નવ ચાર સાત બે')).toBe('7984769472');
    expect(normalizeSpokenDigitSequence('थ्री एट टू फोर सेवन ज़ीरो')).toBe('382470');
    expect(normalizeSpokenDigitSequence('થ્રી એટ ટુ ફોર સેવન ઝીરો')).toBe('382470');
    expect(normalizeSpokenDigitSequence('three eight two four seven टू')).toBe('382472');
    expect(normalizeSpokenDigitSequence('customer7@example.com')).toBeNull();
  });

  it('extracts an exact PIN or phone from natural Hindi, Gujarati, and Romanized phrases', () => {
    expect(normalizeSpokenDigitSequence('मेरा पिन कोड तीन आठ दो चार सात शून्य है', 6)).toBe('382470');
    expect(normalizeSpokenDigitSequence('મારો પિન કોડ ત્રણ આઠ બે ચાર સાત શૂન્ય છે', 6)).toBe('382470');
    expect(normalizeSpokenDigitSequence('maro pin tran aath be char saat shunya che', 6)).toBe('382470');
    expect(normalizeSpokenDigitSequence('my phone is nine eight seven six five four three two one zero', 10)).toBe('9876543210');
    expect(normalizeSpokenDigitSequence('my PIN is 38447', 6)).toBeNull();
  });

  it('requires exactly ten Indian mobile digits and six PIN-code digits', async () => {
    const state = createInitialState();
    const ctx = { callSessionId: 'test', state, channel: 'voice' as const, outboundActions: [] };
    expect(await setCheckoutFieldTool.handler({ field: 'phone', value: 'सात नौ चार सात छह नौ चार सात दो' }, ctx))
      .toMatchObject({ ok: false, reason: 'invalid_value' });
    expect(await setCheckoutFieldTool.handler({ field: 'phone', value: 'सात नौ आठ चार सात छह नौ चार सात दो' }, ctx))
      .toMatchObject({ ok: true });
    expect(state.checkoutFields.phone).toBe('+917984769472');
    expect(await setCheckoutFieldTool.handler({ field: 'postalCode', value: '38447' }, ctx))
      .toMatchObject({ ok: false, reason: 'invalid_value' });
    expect(await setCheckoutFieldTool.handler({ field: 'postalCode', value: 'तीन आठ चार चार सात शून्य' }, ctx))
      .toMatchObject({ ok: true });
    expect(state.checkoutFields.postalCode).toBe('384470');
  });

  it('does not save a quantity/order sentence as the customer name', async () => {
    const state = createInitialState();
    const result = await setCheckoutFieldTool.handler(
      { field: 'name', value: 'दो बॉटल चाहिए मुझे' },
      { callSessionId: 'test', state, channel: 'voice', outboundActions: [] },
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_value' });
    expect(state.checkoutFields.name).toBeUndefined();
  });
  it('does not save an acknowledgement as an address', async () => {
    const state = createInitialState();
    const result = await setCheckoutFieldTool.handler({ field: 'address', value: 'okay' }, { callSessionId: 'session-1', state });
    expect(result).toMatchObject({ ok: false });
    expect(state.checkoutFields.address).toBeUndefined();
  });
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

  it('stores city and state together without changing the caller\'s script', async () => {
    const state = createInitialState();
    const result = await setDeliveryLocationTool.handler(
      { city: 'अहमदाबाद', state: 'गुजरात' },
      { callSessionId: 'session-1', state }
    );

    expect(result).toMatchObject({ ok: true, city: 'अहमदाबाद', state: 'गुजरात' });
    expect(state.checkoutFields).toMatchObject({ city: 'अहमदाबाद', state: 'गुजरात' });
  });

  it('keeps Hindi and Gujarati names and addresses in their caller-provided script', async () => {
    const state = createInitialState();
    const ctx = { callSessionId: 'session-1', state };

    await setCheckoutFieldTool.handler({ field: 'name', value: 'મનોજભાઈ પટેલ' }, ctx);
    await setCheckoutFieldTool.handler({ field: 'address', value: 'शांति नगर मेन रोड' }, ctx);

    expect(state.checkoutFields.name).toBe('મનોજભાઈ પટેલ');
    expect(state.checkoutFields.address).toBe('शांति नगर मेन रोड');
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

  it.each([
    'Yes', 'Yup', 'Yep', 'Yeah', 'Sure', 'Correct', 'Haan', 'हाँ', 'હા', 'India',
    'yes', 'yup', 'yep', 'yeah', 'sure', 'correct', 'right', 'ha', 'haan', 'ji',
    'ji haan', 'Haanji', 'हाँ', 'हां', 'जी', 'जी हाँ', 'હા', 'હાં', 'જી', 'હાજી',
    'bharat', 'Bharat', 'in india', 'In India',
  ])('normalizes affirmative country response "%s" to India', async (input) => {
    const state = createInitialState();
    const ctx = { callSessionId: 'session-1', state };
    const result = await setCheckoutFieldTool.handler({ field: 'country', value: input }, ctx);
    expect(result).toMatchObject({ ok: true });
    expect(state.checkoutFields.country).toBe('India');
  });

  it('normalizes affirmative country response to localized script according to call language', async () => {
    const hindiState = createInitialState();
    hindiState.currentLanguage = 'hi';
    const hindiResult = await setCheckoutFieldTool.handler({ field: 'country', value: 'Yup' }, { callSessionId: 'session-1', state: hindiState });
    expect(hindiResult).toMatchObject({ ok: true });
    expect(hindiState.checkoutFields.country).toBe('भारत');

    const gujaratiState = createInitialState();
    gujaratiState.currentLanguage = 'gu';
    const gujaratiResult = await setCheckoutFieldTool.handler({ field: 'country', value: 'Yes' }, { callSessionId: 'session-1', state: gujaratiState });
    expect(gujaratiResult).toMatchObject({ ok: true });
    expect(gujaratiState.checkoutFields.country).toBe('ભારત');
  });

  it.each([
    'No', 'Nope', 'Nah', 'nahi', 'nathi', 'नहीं', 'ना', 'ના', 'USA', 'United States', 'UAE', 'London', 'okay', 'hello',
  ])('rejects non-India and negative country response "%s" and never stores it', async (input) => {
    const state = createInitialState();
    const ctx = { callSessionId: 'session-1', state };
    const result = await setCheckoutFieldTool.handler({ field: 'country', value: input }, ctx);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_value' });
    expect(state.checkoutFields.country).toBeUndefined();
  });
});

describe('payment confirmation validation', () => {
  it('requires an explicit true confirmation from the reviewed form', () => {
    expect(createPaymentLinkBodySchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(createPaymentLinkBodySchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(createPaymentLinkBodySchema.safeParse({}).success).toBe(false);
  });
});
