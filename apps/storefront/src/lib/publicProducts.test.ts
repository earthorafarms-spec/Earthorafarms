import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('./catalog', () => ({ fetchCatalog: mocks.catalog, invalidateCatalog: vi.fn() }));
vi.mock('./apiClient', () => ({ api: vi.fn() }));
import { fetchPublicProducts } from './api';

beforeEach(() => vi.resetAllMocks());

describe('storefront publication visibility', () => {
  it('displays a newly active product and hides draft/archived data even from an old cached endpoint', async () => {
    const rows = ['active', 'draft', 'archived'].map((status, index) => ({
      id: String(index), name: `Synthetic Product ${index}`, slug: `synthetic-${index}`,
      status, price: 249, mrp: 299, images: [], inventory: [{ total_stock: 5 }],
    }));
    mocks.catalog.mockImplementation(async () => ({ products: rows, deals: [], reviews: [] }));
    expect((await fetchPublicProducts(true)).map(product => product.id)).toEqual(['0']);
    rows[1].status = 'active';
    expect((await fetchPublicProducts(true)).map(product => product.id)).toEqual(['0', '1']);
    rows[1].status = 'archived';
    expect((await fetchPublicProducts(true)).map(product => product.id)).toEqual(['0']);
  });
});
