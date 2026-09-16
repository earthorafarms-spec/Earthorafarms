import { describe, it, expect } from 'vitest';
import {
  normalizeWhatsAppPhone,
  normalizeSpokenDigitSequence,
  isIndiaAffirmative,
  isNonIndiaOrNegative,
  isCheckoutReady,
  missingRequiredFields,
  ALLOWED_FIELDS,
  REQUIRED_FIELDS,
} from '../../../whatsapp-chatbot/checkout-validation.js';
import {
  normalizeWhatsAppPhone as reexportedNormalizePhone,
  normalizeSpokenDigitSequence as reexportedNormalizeDigits,
  isIndiaAffirmative as reexportedIsAffirmative,
  isNonIndiaOrNegative as reexportedIsNegative,
  isCheckoutReady as reexportedIsCheckoutReady,
} from '../../src/tools/checkout.js';

describe('Extracted checkout validation utilities (whatsapp-chatbot/checkout-validation.ts)', () => {
  it('normalizes WhatsApp phone numbers identically to original implementation', () => {
    // Standard 10-digit Indian mobile
    expect(normalizeWhatsAppPhone('9876543210')).toBe('+919876543210');
    expect(reexportedNormalizePhone('9876543210')).toBe('+919876543210');

    // Leading 0
    expect(normalizeWhatsAppPhone('09876543210')).toBe('+919876543210');

    // Leading 91 without plus
    expect(normalizeWhatsAppPhone('919876543210')).toBe('+919876543210');

    // International with plus
    expect(normalizeWhatsAppPhone('+14155552671')).toBe('+14155552671');

    // With spaces, parens, hyphens
    expect(normalizeWhatsAppPhone('+91 98765-43210')).toBe('+919876543210');

    // Invalid / incomplete numbers
    expect(normalizeWhatsAppPhone('12345')).toBeNull();
    expect(normalizeWhatsAppPhone('abc')).toBeNull();
  });

  it('normalizes spoken digit sequences across English, Hindi, and Gujarati', () => {
    // English words
    expect(normalizeSpokenDigitSequence('nine eight seven six five four three two one zero')).toBe('9876543210');
    expect(reexportedNormalizeDigits('nine eight seven six five four three two one zero')).toBe('9876543210');

    // With expected length constraint
    expect(normalizeSpokenDigitSequence('my PIN is three eight two four seven zero', 6)).toBe('382470');
    expect(normalizeSpokenDigitSequence('my PIN is three eight two four seven', 6)).toBeNull();

    // Invalid / email rejection
    expect(normalizeSpokenDigitSequence('customer7@example.com')).toBeNull();
  });

  it('detects Indian affirmatives and non-India negatives deterministically', () => {
    // Affirmatives
    expect(isIndiaAffirmative('yes')).toBe(true);
    expect(isIndiaAffirmative('haanji')).toBe(true);
    expect(isIndiaAffirmative('ji haan')).toBe(true);
    expect(isIndiaAffirmative('india')).toBe(true);
    expect(isIndiaAffirmative('bharat')).toBe(true);
    expect(reexportedIsAffirmative('yes')).toBe(true);

    // Negatives
    expect(isNonIndiaOrNegative('no')).toBe(true);
    expect(isNonIndiaOrNegative('nahi')).toBe(true);
    expect(isNonIndiaOrNegative('nathi')).toBe(true);
    expect(isNonIndiaOrNegative('outside india')).toBe(true);
    expect(reexportedIsNegative('no')).toBe(true);

    // Cross-check mutual exclusivity
    expect(isIndiaAffirmative('no')).toBe(false);
    expect(isNonIndiaOrNegative('yes')).toBe(false);
  });

  it('evaluates checkout readiness based on cart, required fields, and GST', () => {
    const validFields = {
      name: 'Test Customer',
      email: 'test@example.com',
      phone: '+919876543210',
      address: '12 Farm Lane',
      city: 'Ahmedabad',
      state: 'Gujarat',
      postalCode: '380001',
      country: 'India',
      gst: '', // explicitly answered (empty = declined)
    };

    const cartItem = { productId: 'p1', productName: 'Moringa Tablets', quantity: 1, unitPrice: 499 };

    // Ready state
    expect(isCheckoutReady({ cart: [cartItem], checkoutFields: validFields })).toBe(true);
    expect(reexportedIsCheckoutReady({ cart: [cartItem], checkoutFields: validFields } as any)).toBe(true);

    // Empty cart -> not ready
    expect(isCheckoutReady({ cart: [], checkoutFields: validFields })).toBe(false);

    // Missing field -> not ready
    const { email, ...missingEmail } = validFields;
    expect(isCheckoutReady({ cart: [cartItem], checkoutFields: missingEmail })).toBe(false);
    expect(missingRequiredFields(missingEmail)).toContain('email');

    // Unanswered GST -> not ready
    const { gst, ...unansweredGst } = validFields;
    expect(isCheckoutReady({ cart: [cartItem], checkoutFields: unansweredGst })).toBe(false);
  });
});
