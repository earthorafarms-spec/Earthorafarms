import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeGst, applyFestivalDealDiscount, evaluateCoupon, type CouponRow } from './pricing.js';

/** Data-driven parity with the shared fixture ported from voice-service (GST + discount rules must not drift). */
const fixture = JSON.parse(readFileSync(resolve('../../voice-service/tests/fixtures/pricing-cases.json'), 'utf8')) as {
  gst: { name: string; input: { totalAmount: number; country: string; state: string }; expected: Record<string, number | boolean> }[];
};

describe('computeGst — fixture parity', () => {
  for (const c of fixture.gst) {
    it(c.name, () => {
      const g = computeGst(c.input.totalAmount, c.input.country, c.input.state);
      if (c.expected.isIndia !== undefined) expect(g.isIndia).toBe(c.expected.isIndia);
      if (c.expected.isGujarat !== undefined) expect(g.isGujarat).toBe(c.expected.isGujarat);
      if (c.expected.cgstAmount !== undefined) expect(Math.round(g.cgstAmount)).toBe(Math.round(c.expected.cgstAmount as number));
      if (c.expected.sgstAmount !== undefined) expect(Math.round(g.sgstAmount)).toBe(Math.round(c.expected.sgstAmount as number));
      if (c.expected.igstAmount !== undefined) expect(Math.round(g.igstAmount)).toBe(Math.round(c.expected.igstAmount as number));
    });
  }
});

describe('computeGst — edge cases', () => {
  it('international order is exempt', () => { const g = computeGst(1000, 'United States', 'California'); expect(g.isIndia).toBe(false); expect(g.totalGstAmount).toBe(0); });
  it('Gujarat abbreviation splits CGST/SGST', () => { const g = computeGst(1180, 'India', 'GJ'); expect(g.isGujarat).toBe(true); expect(Math.round(g.cgstAmount)).toBe(90); expect(Math.round(g.sgstAmount)).toBe(90); });
  it('other Indian state uses IGST', () => { const g = computeGst(1180, 'India', 'Maharashtra'); expect(g.isGujarat).toBe(false); expect(Math.round(g.igstAmount)).toBe(180); });
  it('Devanagari India + Gujarati script state', () => { const g = computeGst(1180, 'भारत', 'ગુજરાત'); expect(g.isIndia).toBe(true); expect(g.isGujarat).toBe(true); });
});

describe('applyFestivalDealDiscount', () => {
  const deals = [{ id: 1, name: 'Diwali', discountType: 'percentage' as const, discountValue: 10, productIds: ['p1'] }, { id: 2, name: 'Flat', discountType: 'fixed' as const, discountValue: 50, productIds: ['p2'] }];
  it('percentage deal', () => { expect(applyFestivalDealDiscount(1000, 'p1', deals).price).toBe(900); });
  it('fixed deal clamps at zero', () => { expect(applyFestivalDealDiscount(30, 'p2', deals).price).toBe(0); });
  it('no deal returns base', () => { expect(applyFestivalDealDiscount(500, 'p3', deals).price).toBe(500); });
});

describe('evaluateCoupon', () => {
  const base: CouponRow = { id: 1, code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrder: 0, maxUses: null, usedCount: 0, expiryDate: null, status: 'active' };
  it('valid percentage coupon', () => { const r = evaluateCoupon(base, 1000); expect(r.valid).toBe(true); expect(r.discountAmount).toBe(100); });
  it('rejects below min order', () => { expect(evaluateCoupon({ ...base, minOrder: 2000 }, 1000).valid).toBe(false); });
  it('rejects exhausted coupon', () => { expect(evaluateCoupon({ ...base, maxUses: 5, usedCount: 5 }, 1000).valid).toBe(false); });
  it('rejects expired coupon', () => { expect(evaluateCoupon({ ...base, expiryDate: '2000-01-01' }, 1000).valid).toBe(false); });
  it('fixed coupon never exceeds subtotal', () => { expect(evaluateCoupon({ ...base, discountType: 'fixed', discountValue: 5000 }, 1000).discountAmount).toBe(1000); });
  it('null coupon is invalid', () => { expect(evaluateCoupon(null, 1000).valid).toBe(false); });
});
