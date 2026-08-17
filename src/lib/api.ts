import { supabase } from './supabase';
import type { DbProduct, DbReview, FestiveDeal, Product, CartItem } from '@/types';
import powderImg from '@assets/generated_images/product_powder.jpg';
import powderImg2 from '@assets/generated_images/product_powder_2.jpg';
import tabletsImg from '@assets/generated_images/product_tablets.jpg';
import tabletsImg2 from '@assets/generated_images/product_tablets_2.jpg';

import heroLeavesImg from '@assets/generated_images/hero_leaves.jpg';

const staticImageMap: Record<string, { main: string; hover: string }> = {
  powder: { main: powderImg, hover: powderImg2 },
  tablets: { main: tabletsImg, hover: tabletsImg2 },

  amla: { main: heroLeavesImg, hover: heroLeavesImg },
};

function mapProduct(p: DbProduct, dbDeals: FestiveDeal[], dbReviews: DbReview[]): Product {
  const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
  const images = Array.isArray(p.images) ? p.images : [];
  
  const fallback = staticImageMap[p.slug] || staticImageMap.powder;
  const rawPrimary = images.find((i) => i.is_primary)?.url || images[0]?.url;
  const rawSecondary = images.find((i) => !i.is_primary)?.url;

  const isPowder = p.slug === 'powder' || (p.name || '').toLowerCase().includes('powder');
  const primaryImg = isPowder ? powderImg : ((rawPrimary && !rawPrimary.includes('undefined')) ? rawPrimary : fallback.main);
  const secondaryImg = isPowder ? powderImg2 : ((rawSecondary && !rawSecondary.includes('undefined')) ? rawSecondary : (fallback.hover || primaryImg));

  const stockQty = inv?.total_stock ?? 0;
  const mrp = Number(p.mrp);
  let price = Number(p.price);

  const now = new Date();
  const activeDeal = dbDeals.find((d) => {
    const starts = new Date(d.festival_start_date);
    const ends = new Date(d.festival_end_date);
    // Use String() coercion to handle numeric vs string id mismatch from DB
    return now >= starts && now <= ends && (d.festival_deal_products || []).some((dp) => String(dp.product_id) === String(p.id));
  });

  let badge = p.badge || '';
  if (activeDeal) {
    const discountVal = Number(activeDeal.discount_value);
    price = activeDeal.discount_type === 'percentage'
      ? Math.round(price - (price * discountVal) / 100)
      : Math.max(0, Math.round(price - discountVal));
    badge = `${activeDeal.festival_name} Deal`;
  }

  const prodReviews = dbReviews.filter((r) => r.review_product_id === p.id);
  const reviewCount = prodReviews.length;
  const avgRating = reviewCount > 0
    ? Number((prodReviews.reduce((acc, r) => acc + Number(r.review_rating), 0) / reviewCount).toFixed(1))
    : Number(p.rating) || 4.5;

  return {
    id: p.id,
    name: p.name,
    mrp,
    price,
    discount: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
    rating: avgRating,
    reviewCount,
    tag: p.tag || '',
    imageMain: primaryImg,
    imageHover: secondaryImg,
    badge,
    stock: stockQty > 15 ? 'In Stock' : stockQty > 0 ? 'Low Stock' : 'Out of Stock',
    highlights: Array.isArray(p.highlights) ? p.highlights : [],
    description: p.description || '',
  };
}

export async function fetchPublicProducts(): Promise<Product[]> {
  const [productsRes, reviewsRes, dealsRes] = await Promise.all([
    (supabase.from('products') as any)
      .select('*, inventory(*)')
      .neq('status', 'archived')
      .order('created_at', { ascending: true }),
    (supabase.from('review_details') as any).select('*'),
    (supabase.from('festival_details') as any)
      .select('*, festival_deal_products(product_id)')
      .eq('festival_status', 'active'),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (reviewsRes.error) throw reviewsRes.error;
  // Don't throw on deals error — just use empty array so products still load
  const dbDeals = (dealsRes.data || []) as FestiveDeal[];
  const dbReviews = (reviewsRes.data || []) as DbReview[];

  return ((productsRes.data as DbProduct[]) || []).map((p) => mapProduct(p, dbDeals, dbReviews));
}

export async function fetchReviews(): Promise<DbReview[]> {
  const { data, error } = await (supabase.from('review_details') as any).select('*');
  if (error) throw error;
  return (data || []) as DbReview[];
}

export async function fetchActiveDeals(): Promise<FestiveDeal[]> {
  const { data, error } = await (supabase.from('festival_details') as any)
    .select('*, festival_deal_products(product_id)')
    .eq('festival_status', 'active');
  if (error) throw error;
  return (data || []) as FestiveDeal[];
}

export function getDiscountedPrice(
  productId: string,
  originalPrice: number,
  deals: FestiveDeal[]
): number {
  const now = new Date();
  for (const d of deals) {
    const starts = new Date(d.festival_start_date);
    const ends = new Date(d.festival_end_date);
    if (now >= starts && now <= ends && (d.festival_deal_products || []).some((dp) => dp.product_id === productId)) {
      const val = Number(d.discount_value);
      return d.discount_type === 'percentage'
        ? Math.round(originalPrice - (originalPrice * val) / 100)
        : Math.max(0, Math.round(originalPrice - val));
    }
  }
  return originalPrice;
}

export async function syncUserProfile(user: {
  id: string;
  email: string;
  user_metadata?: { name?: string };
  email_confirmed_at?: string | null;
}) {
  return (supabase.from('User_details') as any).upsert(
    {
      user_email: user.email ?? '',
      user_name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? '',
      user_password: '', // Placeholder password since they logged in via Supabase Auth
    },
    { onConflict: 'user_email' }
  );
}


