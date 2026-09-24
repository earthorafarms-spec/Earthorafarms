import { api } from './apiClient';
import { invalidateCatalog } from './catalog';

export interface ProductImage { url: string; alt: string; is_primary: boolean }
export interface ProductFields {
  name: string; mrp: number; price: number; tag: string; badge: string;
  description: string; highlights: string[]; rating: number; category: string; hsn_code: string;
}
interface SaveInput {
  id?: string | null;
  publishNew: boolean;
  slug: string;
  fields: ProductFields;
  stock: number;
  files: File[];
  images: string[];
  onCreated: (id: string) => void;
}

function durableUrl(value: unknown): value is string {
  return typeof value === 'string' && (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value));
}

async function query<T>(body: Record<string, unknown>): Promise<T[]> {
  return (await api<{ data: T[] }>('/api/admin/query', { method: 'POST', json: body })).data;
}

/** New products become public only after their durable images and stock are ready. */
export async function saveAdminProduct(input: SaveInput): Promise<string> {
  if (!Number.isFinite(input.fields.mrp) || input.fields.mrp < 0 ||
      !Number.isFinite(input.fields.price) || input.fields.price < 0 ||
      !Number.isInteger(input.stock) || input.stock < 0) {
    throw new Error('Enter valid non-negative prices and a whole-number stock quantity.');
  }
  if (!input.files.length && input.images.some(url => !durableUrl(url))) {
    throw new Error('These images are local previews. Select the original image files again before saving.');
  }

  let id = input.id;
  if (!id) {
    const rows = await query<{ id: string }>({
      table: 'products', op: 'insert', columns: 'id',
      values: { ...input.fields, slug: input.slug, status: 'archived', images: [] },
    });
    if (!rows[0]?.id) throw new Error('The product could not be created. Please retry.');
    id = rows[0].id;
    // Keep this UUID in the form even if a later upload fails, so Retry saves
    // the same unpublished row rather than creating a second product.
    input.onCreated(id);
  }

  const images: ProductImage[] = [];
  if (input.files.length) {
    for (const [index, file] of input.files.entries()) {
      const body = new FormData();
      body.append('is_primary', String(index === 0));
      body.append('alt', `${input.fields.name} view ${index + 1}`);
      body.append('persist', 'false');
      body.append('file', file);
      const uploaded = await api<{ url: string }>(`/api/admin/products/${encodeURIComponent(id)}/images`, { method: 'POST', body });
      if (!durableUrl(uploaded.url)) throw new Error('The image upload did not return a permanent URL. Please retry.');
      images.push({ url: uploaded.url, alt: `${input.fields.name} view ${index + 1}`, is_primary: index === 0 });
    }
  } else {
    images.push(...input.images.map((url, index) => ({ url, alt: `${input.fields.name} view ${index + 1}`, is_primary: index === 0 })));
  }

  // Upsert also repairs products left without an inventory row by the previous
  // two-request create path. Preserve reserved stock and alert thresholds.
  await query({ table: 'inventory', op: 'upsert', onConflict: 'product_id', values: { product_id: id, total_stock: input.stock } });
  const saved = await query<{ id: string }>({
    table: 'products', op: 'update', columns: 'id', filters: [{ op: 'eq', col: 'id', value: id }],
    values: { ...input.fields, images, ...(input.publishNew ? { status: 'active' } : {}) },
  });
  if (!saved.length) throw new Error('The product no longer exists. Refresh the product list and try again.');
  invalidateCatalog();
  return id;
}
