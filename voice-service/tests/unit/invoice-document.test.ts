import { describe, expect, it } from 'vitest';
import {
  buildPublicInvoiceUrl,
  signInvoiceReference,
  verifyInvoiceReference,
} from '../../src/payments/invoice-document.js';

describe('signed WhatsApp invoice URL', () => {
  it('accepts only an untampered payment-link reference', () => {
    const signature = signInvoiceReference('plink_test_123');
    expect(verifyInvoiceReference('plink_test_123', signature)).toBe(true);
    expect(verifyInvoiceReference('plink_test_124', signature)).toBe(false);
    expect(verifyInvoiceReference('plink_test_123', 'invalid')).toBe(false);
  });

  it('uses the public voice-service document route so the link returns a PDF', () => {
    const url = buildPublicInvoiceUrl('plink_test_123');
    expect(url).toMatch(/^https:\/\/earthorafarms-mhwv\.onrender\.com\/payments\/invoice\/plink_test_123\?signature=[a-f0-9]{64}$/u);
  });
});
