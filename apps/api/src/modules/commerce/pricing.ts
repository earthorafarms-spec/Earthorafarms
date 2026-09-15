/**
 * The single pricing contract for storefront, admin, channels and the AI functions.
 * Ported from voice-service/src/domain/pricing.ts (kept numerically identical — see
 * voice-service/tests/fixtures/pricing-cases.json for the shared fixture data).
 */
import { sql } from '../../db/client.js';

export interface GstBreakdown {
  isIndia: boolean; isGujarat: boolean;
  cgstRate: number; cgstAmount: number; sgstRate: number; sgstAmount: number; igstRate: number; igstAmount: number;
  taxableValue: number; totalGstAmount: number; label: string;
}

export function computeGst(totalAmount: number, country: string, state: string): GstBreakdown {
  const cleanCountry = (country || '').trim().toLowerCase();
  const isIndia = cleanCountry === 'india' || cleanCountry === 'भारत' || cleanCountry === 'ભારત';
  const cleanState = (state || '').trim().toLowerCase();
  const isGujarat = cleanState.includes('gujarat') || cleanState === 'gj' || cleanState === 'guj' ||
    cleanState.includes('गुजरात') || cleanState.includes('ગુજરાત');
  const taxableValue = totalAmount / 1.18;
  const totalGstAmount = totalAmount - taxableValue;
  if (!isIndia) {
    return { isIndia: false, isGujarat: false, cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0, taxableValue, totalGstAmount: 0, label: 'Exempt / International' };
  }
  if (isGujarat) {
    return { isIndia: true, isGujarat: true, cgstRate: 9, cgstAmount: totalGstAmount / 2, sgstRate: 9, sgstAmount: totalGstAmount / 2, igstRate: 0, igstAmount: 0, taxableValue, totalGstAmount, label: 'Intra-State GST (Gujarat)' };
  }
  return { isIndia: true, isGujarat: false, cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 18, igstAmount: totalGstAmount, taxableValue, totalGstAmount, label: 'Inter-State IGST' };
}

export interface ActiveFestivalDeal { id: number; name: string; discountType: 'percentage' | 'fixed'; discountValue: number; productIds: string[] }

export function applyFestivalDealDiscount(basePrice: number, productId: string, deals: ActiveFestivalDeal[]): { price: number; deal: ActiveFestivalDeal | null } {
  const deal = deals.find((d) => d.productIds.includes(productId));
  if (!deal) return { price: basePrice, deal: null };
  const price = deal.discountType === 'percentage'
    ? Math.round(basePrice - (basePrice * deal.discountValue) / 100)
    : Math.max(0, Math.round(basePrice - deal.discountValue));
  return { price, deal };
}

export interface CouponRow {
  id: number; code: string; discountType: 'percentage' | 'fixed'; discountValue: number; minOrder: number;
  maxUses: number | null; usedCount: number; expiryDate: string | null; status: string;
}

export interface CouponEvaluation { valid: boolean; discountAmount: number; error: string | null; coupon: CouponRow | null }

export function evaluateCoupon(coupon: CouponRow | null, subtotal: number): CouponEvaluation {
  if (!coupon || coupon.status !== 'active') return { valid: false, discountAmount: 0, error: 'Invalid or expired coupon code.', coupon: null };
  if (coupon.minOrder > subtotal) return { valid: false, discountAmount: 0, coupon, error: `Minimum order amount of ₹${coupon.minOrder} required.` };
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) return { valid: false, discountAmount: 0, error: 'This coupon has expired.', coupon };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return { valid: false, discountAmount: 0, error: 'This coupon has reached its usage limit.', coupon };
  const discountAmount = coupon.discountType === 'percentage' ? (subtotal * coupon.discountValue) / 100 : Math.min(subtotal, coupon.discountValue);
  return { valid: true, discountAmount, error: null, coupon };
}

export interface ProductSummary {
  id: string; slug: string; name: string; description: string; highlights: string[]; price: number; mrp: number; status: string;
  tag: string; badge: string; images: { url: string; is_primary?: boolean }[]; rating: number; stockQty: number; lowStockThreshold: number;
  hsn: string; created_at: string;
}

export async function listProducts(opts: { includeArchived?: boolean } = {}): Promise<ProductSummary[]> {
  const rows = await sql<any[]>`
    SELECT p.id, p.slug, p.name, p.description, p.highlights, p.price, p.mrp, p.status, p.tag, p.badge, p.images, p.rating, p.hsn_code, p.created_at,
           COALESCE(i.total_stock, 0) AS total_stock, COALESCE(i.low_stock_threshold, 15) AS low_stock_threshold
    FROM products p LEFT JOIN inventory i ON i.product_id = p.id
    WHERE ${opts.includeArchived ? sql`true` : sql`p.status <> 'archived'`}
    ORDER BY p.created_at ASC`;
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description ?? '', highlights: Array.isArray(r.highlights) ? r.highlights : [],
    price: Number(r.price), mrp: Number(r.mrp), status: r.status, tag: r.tag ?? '', badge: r.badge ?? '',
    images: Array.isArray(r.images) ? r.images : [], rating: Number(r.rating ?? 4.5), stockQty: Number(r.total_stock), lowStockThreshold: Number(r.low_stock_threshold),
    hsn: r.hsn_code ?? '', created_at: r.created_at,
  }));
}

export async function listActiveFestivalDeals(now = new Date()): Promise<ActiveFestivalDeal[]> {
  const rows = await sql<any[]>`
    SELECT f.id, f.festival_name, f.discount_type, f.discount_value,
           COALESCE(array_agg(d.product_id::text) FILTER (WHERE d.product_id IS NOT NULL), '{}') AS product_ids
    FROM festival_details f LEFT JOIN festival_deal_products d ON d.deal_id = f.id
    WHERE f.festival_status = 'active' AND f.festival_start_date <= ${now} AND f.festival_end_date >= ${now}
    GROUP BY f.id ORDER BY f.id`;
  return rows.map((r) => ({ id: r.id, name: r.festival_name, discountType: r.discount_type, discountValue: Number(r.discount_value), productIds: r.product_ids }));
}

export async function findCoupon(code: string): Promise<CouponRow | null> {
  const [r] = await sql<any[]>`SELECT * FROM coupon_details WHERE upper(coupon_code) = upper(${code.trim()}) LIMIT 1`;
  if (!r) return null;
  return {
    id: r.id, code: r.coupon_code, discountType: r.coupon_discount_type, discountValue: Number(r.coupon_discount_value ?? r.coupon_discount_amount ?? 0),
    minOrder: Number(r.coupon_min_order ?? 0), maxUses: r.coupon_max_uses === null ? null : Number(r.coupon_max_uses), usedCount: Number(r.coupon_used_count ?? 0),
    expiryDate: r.coupon_expiry_date, status: r.coupon_status,
  };
}

export interface CartLineInput { productId: string; quantity: number }
export interface PricedLine { productId: string; slug: string; name: string; quantity: number; unitPrice: number; mrp: number; lineTotal: number; hsn: string; stockQty: number; dealName: string | null }
export interface PricedCart {
  lines: PricedLine[]; subtotal: number; discount: number; discountReason: string | null; couponCode: string | null; couponError: string | null;
  shipping: number; total: number; gst: GstBreakdown; unavailable: string[]; outOfStock: { productId: string; requested: number; available: number }[];
}

/** Authoritative pricing: live products, live deals, coupon rule, GST split. Never trust client amounts. */
export async function priceCart(lines: CartLineInput[], opts: { country?: string; state?: string; couponCode?: string | null } = {}): Promise<PricedCart> {
  const [products, deals] = await Promise.all([listProducts(), listActiveFestivalDeals()]);
  const byKey = new Map<string, ProductSummary>();
  for (const p of products) { byKey.set(p.id, p); byKey.set(p.slug, p); }
  const merged = new Map<string, number>();
  for (const l of lines) {
    const p = byKey.get(String(l.productId));
    const key = p ? p.id : String(l.productId);
    merged.set(key, (merged.get(key) ?? 0) + Math.max(1, Math.round(Number(l.quantity) || 1)));
  }
  const priced: PricedLine[] = []; const unavailable: string[] = []; const outOfStock: PricedCart['outOfStock'] = [];
  for (const [key, qty] of merged) {
    const p = byKey.get(key);
    if (!p || p.status !== 'active') { unavailable.push(key); continue; }
    const { price, deal } = applyFestivalDealDiscount(p.price, p.id, deals);
    if (p.stockQty < qty) outOfStock.push({ productId: p.id, requested: qty, available: p.stockQty });
    priced.push({ productId: p.id, slug: p.slug, name: p.name, quantity: qty, unitPrice: price, mrp: p.mrp, lineTotal: price * qty, hsn: p.hsn, stockQty: p.stockQty, dealName: deal?.name ?? null });
  }
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  let discount = 0; let discountReason: string | null = null; let couponError: string | null = null;
  const couponCode = opts.couponCode?.trim() || null;
  if (couponCode) {
    const ev = evaluateCoupon(await findCoupon(couponCode), subtotal);
    if (ev.valid) { discount = Math.round(ev.discountAmount * 100) / 100; discountReason = `Coupon ${ev.coupon!.code}`; } else couponError = ev.error;
  }
  const shipping = 0;
  const total = Math.max(0, Math.round((subtotal - discount + shipping) * 100) / 100);
  return { lines: priced, subtotal, discount, discountReason, couponCode: couponError ? null : couponCode, couponError, shipping, total, gst: computeGst(total, opts.country ?? 'India', opts.state ?? ''), unavailable, outOfStock };
}
