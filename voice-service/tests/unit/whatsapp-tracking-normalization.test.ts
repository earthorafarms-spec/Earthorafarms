import { describe, expect, it } from 'vitest';
import { normalizeTrackingPhone } from '../../../whatsapp-chatbot/provider.js';

describe('WhatsApp tracking phone number normalization (P2)', () => {
  it('normalizes 10-digit Indian numbers to +91XXXXXXXXXX', () => {
    expect(normalizeTrackingPhone('9825346884')).toBe('+919825346884');
    expect(normalizeTrackingPhone('8765432109')).toBe('+918765432109');
    expect(normalizeTrackingPhone('7012345678')).toBe('+917012345678');
    expect(normalizeTrackingPhone('6234567890')).toBe('+916234567890');
  });

  it('normalizes 11-digit Indian numbers with trunk prefix 0 to +91XXXXXXXXXX', () => {
    expect(normalizeTrackingPhone('09825346884')).toBe('+919825346884');
    expect(normalizeTrackingPhone('08765432109')).toBe('+918765432109');
  });

  it('normalizes 12-digit Indian numbers starting with 91 to +91XXXXXXXXXX', () => {
    expect(normalizeTrackingPhone('919825346884')).toBe('+919825346884');
    expect(normalizeTrackingPhone('918765432109')).toBe('+918765432109');
  });

  it('preserves already-prefixed +91 Indian numbers', () => {
    expect(normalizeTrackingPhone('+919825346884')).toBe('+919825346884');
    expect(normalizeTrackingPhone('+91 98253-46884')).toBe('+919825346884');
  });

  it('preserves valid international E.164 numbers', () => {
    expect(normalizeTrackingPhone('+14155552671')).toBe('+14155552671');
    expect(normalizeTrackingPhone('+447911123456')).toBe('+447911123456');
    expect(normalizeTrackingPhone('+971501234567')).toBe('+971501234567');
    expect(normalizeTrackingPhone('+6591234567')).toBe('+6591234567');
    expect(normalizeTrackingPhone('+61412345678')).toBe('+61412345678');
  });

  it('rejects invalid, malformed, or out-of-range phone numbers', () => {
    expect(normalizeTrackingPhone('')).toBeNull();
    expect(normalizeTrackingPhone('   ')).toBeNull();
    expect(normalizeTrackingPhone('invalid')).toBeNull();
    expect(normalizeTrackingPhone('12345')).toBeNull();
    expect(normalizeTrackingPhone('+0123456789')).toBeNull();
    expect(normalizeTrackingPhone('000000000000000000')).toBeNull();
    expect(normalizeTrackingPhone(null as unknown as string)).toBeNull();
    expect(normalizeTrackingPhone(undefined as unknown as string)).toBeNull();
  });
});
