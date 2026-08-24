// Shared domain types for voice-service. Kept deliberately small — these are
// the shapes that cross module boundaries (repository -> domain -> tools),
// not full DB row types (see repositories/*.ts for those).

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  mrp: number;
  price: number; // base price, before festival-deal discount
  status: 'active' | 'inactive' | 'archived';
  stockQty: number;
  stockLabel: 'In Stock' | 'Low Stock' | 'Out of Stock';
  tag: string;
  badge: string;
  description: string;
  highlights: string[];
}

export interface ActiveFestivalDeal {
  id: string;
  festivalName: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
}

export interface CouponRow {
  id: number;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minOrder: number;
  maxUses: number | null;
  usedCount: number;
  expiryDate: string | null;
  status: 'active' | 'inactive';
}

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface PricedLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number; // after festival-deal discount, before coupon
  lineTotal: number;
}

export interface GstBreakdown {
  isIndia: boolean;
  isGujarat: boolean;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  taxableValue: number;
  totalGstAmount: number;
  label: string;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  discount: number;
  discountReason: string | null;
  shipping: number;
  gst: GstBreakdown;
  total: number; // subtotal - discount + shipping (already GST-inclusive, matching checkout.tsx)
  currency: 'INR';
  couponCode: string | null;
  couponError: string | null;
}
