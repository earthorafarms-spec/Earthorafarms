import { supabase } from '../lib/supabaseClient.js';
import type { ProductSummary, ActiveFestivalDeal } from '../domain/types.js';

interface DbProductRow {
  id: string;
  slug: string;
  name: string;
  mrp: number;
  price: number;
  status: string;
  tag: string | null;
  badge: string | null;
  description: string | null;
  highlights: string[] | null;
  inventory: { total_stock: number; low_stock_threshold: number }[] | null;
}

function stockLabel(qty: number, lowStockThreshold: number): ProductSummary['stockLabel'] {
  if (qty <= 0) return 'Out of Stock';
  if (qty <= lowStockThreshold) return 'Low Stock';
  return 'In Stock';
}

function mapRow(row: DbProductRow): ProductSummary {
  const inv = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory;
  const qty = inv?.total_stock ?? 0;
  const threshold = inv?.low_stock_threshold ?? 15;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    mrp: Number(row.mrp),
    price: Number(row.price),
    status: row.status as ProductSummary['status'],
    stockQty: qty,
    stockLabel: stockLabel(qty, threshold),
    tag: row.tag ?? '',
    badge: row.badge ?? '',
    description: row.description ?? '',
    highlights: row.highlights ?? [],
  };
}

/** Only active products — this is the entire universe of things the agent may ever offer. */
export async function listActiveProducts(): Promise<ProductSummary[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, slug, name, mrp, price, status, tag, badge, description, highlights, inventory(total_stock, low_stock_threshold)')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as DbProductRow[]).map(mapRow);
}

export async function getProductById(productId: string): Promise<ProductSummary | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, slug, name, mrp, price, status, tag, badge, description, highlights, inventory(total_stock, low_stock_threshold)')
    .eq('id', productId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as DbProductRow);
}

/** Resolves a fuzzy caller-spoken name to the closest active product, or null. */
export async function findProductByName(query: string): Promise<ProductSummary | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, slug, name, mrp, price, status, tag, badge, description, highlights, inventory(total_stock, low_stock_threshold)')
    .eq('status', 'active')
    .ilike('name', `%${query}%`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as DbProductRow);
}

interface DbFestivalDealRow {
  id: number;
  festival_name: string;
  festival_start_date: string;
  festival_end_date: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  festival_deal_products: { product_id: string }[] | null;
}

export async function listActiveFestivalDeals(): Promise<ActiveFestivalDeal[]> {
  const { data, error } = await supabase
    .from('festival_details')
    .select('id, festival_name, festival_start_date, festival_end_date, discount_type, discount_value, festival_deal_products(product_id)')
    .eq('festival_status', 'active');

  if (error) throw error;

  const now = new Date();
  return ((data ?? []) as unknown as DbFestivalDealRow[])
    .filter((d) => {
      const starts = new Date(d.festival_start_date);
      const ends = new Date(d.festival_end_date);
      return now >= starts && now <= ends;
    })
    .map((d) => ({
      id: String(d.id),
      festivalName: d.festival_name,
      discountType: d.discount_type,
      discountValue: Number(d.discount_value),
      productIds: (d.festival_deal_products ?? []).map((p) => String(p.product_id)),
    }));
}
