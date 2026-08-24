import { supabase } from '../lib/supabaseClient.js';
import type { CouponRow } from '../domain/types.js';

interface DbCouponRow {
  id: number;
  coupon_code: string;
  coupon_discount_type: 'percentage' | 'fixed';
  coupon_discount_value: number;
  coupon_min_order: number;
  coupon_max_uses: number | null;
  coupon_used_count: number;
  coupon_expiry_date: string | null;
  coupon_status: 'active' | 'inactive';
}

/**
 * Queries the base `coupon_details` table directly (service-role, not the
 * `coupons` compatibility view the browser app uses) — this is the
 * server-side, authoritative coupon check the spec calls for. The existing
 * client-side check in src/pages/checkout.tsx does the same validation but
 * is not re-verified server-side today; this repository is what closes that
 * gap for the voice checkout path.
 */
export async function findActiveCouponByCode(code: string): Promise<CouponRow | null> {
  const { data, error } = await supabase
    .from('coupon_details')
    .select(
      'id, coupon_code, coupon_discount_type, coupon_discount_value, coupon_min_order, coupon_max_uses, coupon_used_count, coupon_expiry_date, coupon_status'
    )
    .eq('coupon_code', code.trim().toUpperCase())
    .eq('coupon_status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as DbCouponRow;
  return {
    id: row.id,
    code: row.coupon_code,
    discountType: row.coupon_discount_type,
    discountValue: Number(row.coupon_discount_value),
    minOrder: Number(row.coupon_min_order),
    maxUses: row.coupon_max_uses,
    usedCount: row.coupon_used_count,
    expiryDate: row.coupon_expiry_date,
    status: row.coupon_status,
  };
}
