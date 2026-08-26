// ─────────────────────────────────────────────────────────────────────────
// KNOWN, ACCEPTED TRADEOFF: this file re-implements pricing/GST/discount
// logic that also exists in the main app, because voice-service (Node/
// Render) and the main app (Vite/Netlify) share no code package today and
// introducing one is a bigger structural change than this feature warrants.
// Source of truth to stay in sync with:
//   - GST split:            ../../src/pages/checkout.tsx  (gstBreakdown useMemo)
//   - Festival deal pricing: ../../src/lib/api.ts          (mapProduct)
//   - Coupon validation:     ../../src/pages/checkout.tsx  (handleApplyCoupon)
// tests/fixtures/pricing-cases.json holds shared *data* (not code) asserted
// against here — if a tax/discount rule changes in one place, update that
// fixture and manually re-check the other implementation.
// ─────────────────────────────────────────────────────────────────────────

import type {
  ActiveFestivalDeal, CartLineInput, CouponRow, GstBreakdown,
  PricedCart, PricedLine, ProductSummary,
} from './types.js';
import { findActiveCouponByCode } from '../repositories/coupons.repository.js';
import { listActiveFestivalDeals, listActiveProducts } from '../repositories/products.repository.js';

/** Line-for-line port of checkout.tsx's `gstBreakdown` useMemo. Do not "improve" — must match exactly. */
export function computeGst(totalAmount: number, country: string, state: string): GstBreakdown {
  const isIndia = (country || '').trim().toLowerCase() === 'india';
  const cleanState = (state || '').trim().toLowerCase();
  const isGujarat = cleanState.includes('gujarat') || cleanState === 'gj' || cleanState === 'guj';

  const taxableValue = totalAmount / 1.18;
  const totalGstAmount = totalAmount - taxableValue;

  if (!isIndia) {
    return {
      isIndia: false, isGujarat: false,
      cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0,
      taxableValue, totalGstAmount: 0, label: 'Exempt / International',
    };
  }

  if (isGujarat) {
    const cgstAmount = totalGstAmount / 2;
    const sgstAmount = totalGstAmount / 2;
    return {
      isIndia: true, isGujarat: true,
      cgstRate: 9, cgstAmount, sgstRate: 9, sgstAmount, igstRate: 0, igstAmount: 0,
      taxableValue, totalGstAmount, label: 'Intra-State GST (Gujarat)',
    };
  }

  return {
    isIndia: true, isGujarat: false,
    cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0,
    igstRate: 18, igstAmount: totalGstAmount,
    taxableValue, totalGstAmount, label: 'Inter-State IGST',
  };
}

/** Port of mapProduct()'s active-deal matching + discount math from src/lib/api.ts. */
export function applyFestivalDealDiscount(
  basePrice: number,
  productId: string,
  deals: ActiveFestivalDeal[]
): number {
  const deal = deals.find((d) => d.productIds.includes(productId));
  if (!deal) return basePrice;

  return deal.discountType === 'percentage'
    ? Math.round(basePrice - (basePrice * deal.discountValue) / 100)
    : Math.max(0, Math.round(basePrice - deal.discountValue));
}

export interface CouponEvaluation {
  valid: boolean;
  discountAmount: number;
  error: string | null;
  coupon: CouponRow | null;
}

/** Pure evaluation of an already-fetched coupon row against a subtotal — no I/O. */
export function evaluateCoupon(coupon: CouponRow | null, subtotal: number): CouponEvaluation {
  if (!coupon) {
    return { valid: false, discountAmount: 0, error: 'Invalid or expired coupon code.', coupon: null };
  }
  if (coupon.minOrder > subtotal) {
    return {
      valid: false, discountAmount: 0, coupon,
      error: `Minimum order amount of ₹${coupon.minOrder} required.`,
    };
  }
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
    return { valid: false, discountAmount: 0, error: 'This coupon has expired.', coupon };
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, discountAmount: 0, error: 'This coupon has reached its usage limit.', coupon };
  }

  const discountAmount =
    coupon.discountType === 'percentage'
      ? (subtotal * coupon.discountValue) / 100
      : Math.min(subtotal, coupon.discountValue);

  return { valid: true, discountAmount, error: null, coupon };
}

/**
 * Orchestrator — does I/O (fetches live products, active deals, and the
 * coupon row) then delegates all math to the pure functions above. This is
 * the single function both `verify-and-price` (Phase 3/4 routes) and the
 * `set_checkout_field`/cart tools (Phase 2) should call for anything that
 * needs an authoritative price — never compute totals ad hoc elsewhere.
 */
export async function priceCart(
  lines: CartLineInput[],
  opts: { country: string; state: string; couponCode?: string | null }
): Promise<PricedCart> {
  const [allProducts, deals] = await Promise.all([listActiveProducts(), listActiveFestivalDeals()]);
  const byId = new Map(allProducts.map((p) => [p.id, p]));

  const pricedLines: PricedLine[] = [];
  const unavailableProductIds: string[] = [];
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) {
      unavailableProductIds.push(line.productId);
      continue;
    }
    const unitPrice = applyFestivalDealDiscount(product.price, product.id, deals);
    pricedLines.push({
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      unitPrice,
      lineTotal: unitPrice * line.quantity,
    });
  }

  if (unavailableProductIds.length > 0) {
    throw new Error(`Cart contains unavailable products: ${unavailableProductIds.join(', ')}`);
  }

  const subtotal = pricedLines.reduce((sum, l) => sum + l.lineTotal, 0);

  let discount = 0;
  let discountReason: string | null = null;
  let couponError: string | null = null;
  const couponCode = opts.couponCode?.trim() || null;

  if (couponCode) {
    const couponRow = await findActiveCouponByCode(couponCode);
    const evaluation = evaluateCoupon(couponRow, subtotal);
    if (evaluation.valid) {
      discount = evaluation.discountAmount;
      discountReason = `Coupon ${couponCode.toUpperCase()}`;
    } else {
      couponError = evaluation.error;
    }
  }

  const shipping = 0; // free shipping, matches checkout.tsx today
  const total = Math.max(0, subtotal - discount + shipping);
  const gst = computeGst(total, opts.country, opts.state);

  return {
    lines: pricedLines,
    subtotal,
    discount,
    discountReason,
    shipping,
    gst,
    total,
    currency: 'INR',
    couponCode: couponError ? null : couponCode,
    couponError,
  };
}

export type { ProductSummary };
