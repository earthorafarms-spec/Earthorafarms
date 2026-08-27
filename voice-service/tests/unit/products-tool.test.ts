import { describe, expect, it, vi } from 'vitest';

const repositoryMocks = vi.hoisted(() => ({
  listActiveProducts: vi.fn(),
  getProductById: vi.fn(),
  listActiveFestivalDeals: vi.fn(),
}));

vi.mock('../../src/repositories/products.repository.js', () => repositoryMocks);

import { listProductsTool, spokenProductNameMatches } from '../../src/tools/products.js';

const products = [
  {
    id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
    status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
    description: 'Alpha description', highlights: [],
  },
  {
    id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 100, price: 80,
    status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '50mg', badge: '',
    description: 'Beta description', highlights: [],
  },
];

describe('spoken product lookup', () => {
  it('matches extra conversational words and common phonetic spelling', () => {
    expect(spokenProductNameMatches('Alpha', 'Alpha product ke bare mein')).toBe(true);
    expect(spokenProductNameMatches('Alpha', 'Alfa')).toBe(true);
  });

  it('returns the live catalog instead of an empty result when speech spelling has no exact match', async () => {
    repositoryMocks.listActiveProducts.mockResolvedValue(products);
    repositoryMocks.listActiveFestivalDeals.mockResolvedValue([]);

    const result = await listProductsTool.handler({ query: 'ulfa supplement' }, {
      callSessionId: 'session-1',
      state: { messages: [], cart: [], checkoutFields: {}, turnCount: 0, currentTurnFacts: [], currentLanguage: 'en' },
    }) as { products: unknown[]; usedFullCatalogFallback: boolean };

    expect(result.usedFullCatalogFallback).toBe(true);
    expect(result.products).toHaveLength(2);
  });
});
