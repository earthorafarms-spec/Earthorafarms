import { api } from './apiClient';
import type { DbProduct, DbReview, FestiveDeal, Product } from '@/types';
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

export interface Catalog { products: DbProduct[]; deals: FestiveDeal[]; reviews: DbReview[] }

let catalogCache: { at: number; promise: Promise<Catalog> } | null = null;
const CATALOG_TTL = 30_000;

/** One request for everything the storefront needs; deduped + cached for 30s so sections don't refetch in parallel. */
export function fetchCatalog(force = false): Promise<Catalog> {
  if (!force && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL) return catalogCache.promise;
  const promise = api<Catalog>('/api/store/catalog', { signal: AbortSignal.timeout(10_000) }).catch((err) => { catalogCache = null; throw err; });
  catalogCache = { at: Date.now(), promise };
  return promise;
}

function mapProduct(p: DbProduct, dbDeals: FestiveDeal[], dbReviews: DbReview[], now: Date): Product {
  const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
  const images = Array.isArray(p.images) ? p.images : [];
  const fallback = staticImageMap[p.slug] || staticImageMap.powder;
  const rawPrimary = images.find((i) => i.is_primary)?.url || images[0]?.url;
  const rawSecondary = images.find((i) => !i.is_primary)?.url;
  const primaryImg = rawPrimary && !rawPrimary.includes('undefined') ? rawPrimary : fallback.main;
  const secondaryImg = rawSecondary && !rawSecondary.includes('undefined') ? rawSecondary : primaryImg;
  const stockQty = inv?.total_stock ?? 0;
  const mrp = Number(p.mrp);
  let price = Number(p.price);
  const activeDeal = dbDeals.find((d) => {
    const starts = new Date(d.festival_start_date); const ends = new Date(d.festival_end_date);
    return now >= starts && now <= ends && (d.festival_deal_products || []).some((dp) => String(dp.product_id) === String(p.id));
  });
  let badge = p.badge || '';
  if (activeDeal) {
    const discountVal = Number(activeDeal.discount_value);
    price = activeDeal.discount_type === 'percentage' ? Math.round(price - (price * discountVal) / 100) : Math.max(0, Math.round(price - discountVal));
    badge = `${activeDeal.festival_name} Deal`;
  }
  const prodReviews = dbReviews.filter((r) => r.review_product_id === p.id);
  const reviewCount = prodReviews.length;
  const avgRating = reviewCount > 0 ? Number((prodReviews.reduce((acc, r) => acc + Number(r.review_rating), 0) / reviewCount).toFixed(1)) : Number(p.rating) || 4.5;
  return {
    id: p.id, name: p.name, mrp, price,
    discount: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
    rating: avgRating, reviewCount, tag: p.tag || '', imageMain: primaryImg, imageHover: secondaryImg,
    allImages: (() => { const urls = images.map((i) => i.url).filter((u) => u && !u.includes('undefined')); if (urls.length > 0) return urls; return secondaryImg !== primaryImg ? [primaryImg, secondaryImg] : [primaryImg]; })(),
    badge, stock: stockQty > 15 ? 'In Stock' : stockQty > 0 ? 'Low Stock' : 'Out of Stock',
    highlights: Array.isArray(p.highlights) ? p.highlights : [], description: p.description || '',
  };
}

export async function fetchPublicProducts(): Promise<Product[]> {
  const { products, deals, reviews } = await fetchCatalog();
  const now = new Date();
  return products.filter((p) => p.status !== 'archived').map((p) => mapProduct(p, deals, reviews, now));
}

export async function fetchReviews(): Promise<DbReview[]> {
  return (await fetchCatalog()).reviews;
}

export async function fetchActiveDeals(): Promise<FestiveDeal[]> {
  return (await fetchCatalog()).deals;
}

export function getDiscountedPrice(productId: string, originalPrice: number, deals: FestiveDeal[]): number {
  const now = new Date();
  for (const d of deals) {
    const starts = new Date(d.festival_start_date); const ends = new Date(d.festival_end_date);
    if (now >= starts && now <= ends && (d.festival_deal_products || []).some((dp) => dp.product_id === productId)) {
      const val = Number(d.discount_value);
      return d.discount_type === 'percentage' ? Math.round(originalPrice - (originalPrice * val) / 100) : Math.max(0, Math.round(originalPrice - val));
    }
  }
  return originalPrice;
}

export async function submitReview(input: { productId: string; name: string; rating: number; comment: string }): Promise<void> {
  await api('/api/store/reviews', { method: 'POST', json: input });
  catalogCache = null;
}

export async function submitContact(input: { name: string; email: string; phone: string; topic: string; message: string; marketingConsent: boolean }): Promise<void> {
  await api('/api/store/contact', { method: 'POST', json: input });
}

export async function subscribeNewsletter(email: string): Promise<void> {
  await api('/api/store/newsletter', { method: 'POST', json: { email } });
}

export async function requestRestock(productId: string, phone: string): Promise<void> {
  await api('/api/store/restock-request', { method: 'POST', json: { productId, phone } });
}
