import { describe, it, expect } from 'vitest';
import { computeGst, applyFestivalDealDiscount, evaluateCoupon } from '../../src/domain/pricing.js';
import fixtures from '../fixtures/pricing-cases.json' with { type: 'json' };

describe('computeGst (must match src/pages/checkout.tsx gstBreakdown exactly)', () => {
  for (const c of fixtures.gst) {
    it(c.name, () => {
      const result = computeGst(c.input.totalAmount, c.input.country, c.input.state);
      expect(result.isIndia).toBe(c.expected.isIndia);
      expect(result.isGujarat).toBe(c.expected.isGujarat);
      expect(result.cgstAmount).toBeCloseTo(c.expected.cgstAmount, 5);
      expect(result.sgstAmount).toBeCloseTo(c.expected.sgstAmount, 5);
      expect(result.igstAmount).toBeCloseTo(c.expected.igstAmount, 5);
    });
  }
});

describe('applyFestivalDealDiscount (must match src/lib/api.ts mapProduct)', () => {
  for (const c of fixtures.festivalDeal as any[]) {
    it(c.name, () => {
      const result = applyFestivalDealDiscount(c.input.basePrice, c.input.productId, c.input.deals);
      expect(result).toBe(c.expected);
    });
  }
});

describe('evaluateCoupon', () => {
  for (const c of fixtures.coupon as any[]) {
    it(c.name, () => {
      const result = evaluateCoupon(c.input.coupon, c.input.subtotal);
      expect(result.valid).toBe(c.expected.valid);
      expect(result.discountAmount).toBeCloseTo(c.expected.discountAmount, 5);
    });
  }
});
