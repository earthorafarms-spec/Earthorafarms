import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';

const repositoryMocks = vi.hoisted(() => ({
  getProductById: vi.fn(),
  listActiveFestivalDeals: vi.fn(),
}));

vi.mock('../../src/repositories/products.repository.js', () => repositoryMocks);

import { addCartItemTool, addCartItemsTool, updateCartItemTool } from '../../src/tools/cart.js';

describe('cart tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.listActiveFestivalDeals.mockResolvedValue([]);
    repositoryMocks.getProductById.mockResolvedValue({
      id: 'product-1', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
      status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '', badge: '',
      description: '', highlights: [],
    });
  });

  it('does not falsely report stock bounding when increasing an existing line', async () => {
    const state = createInitialState();
    state.cart.push({ productId: 'product-1', productName: 'Alpha', quantity: 1, unitPrice: 90 });
    const result = await addCartItemTool.handler(
      { productId: 'product-1', quantity: 1 },
      { callSessionId: 'session-1', state }
    ) as { ok: boolean; boundedByStock: boolean };

    expect(result).toMatchObject({ ok: true, boundedByStock: false });
    expect(state.cart[0].quantity).toBe(2);
  });

  it('reports stock bounding only when the requested total exceeds stock', async () => {
    const state = createInitialState();
    state.cart.push({ productId: 'product-1', productName: 'Alpha', quantity: 8, unitPrice: 90 });
    const result = await addCartItemTool.handler(
      { productId: 'product-1', quantity: 5 },
      { callSessionId: 'session-1', state }
    ) as { ok: boolean; boundedByStock: boolean };

    expect(result).toMatchObject({ ok: true, boundedByStock: true });
    expect(state.cart[0].quantity).toBe(10);
  });

  it('does not create a zero-quantity line for an out-of-stock product', async () => {
    repositoryMocks.getProductById.mockResolvedValue({
      id: 'product-1', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
      status: 'active', stockQty: 0, stockLabel: 'Out of Stock', tag: '', badge: '',
      description: '', highlights: [],
    });
    const state = createInitialState();
    const result = await updateCartItemTool.handler(
      { productId: 'product-1', quantity: 2 },
      { callSessionId: 'session-1', state }
    );

    expect(result).toMatchObject({ ok: false, reason: 'out_of_stock' });
    expect(state.cart).toEqual([]);
  });

  it('adds multiple products with independent quantities in one operation', async () => {
    repositoryMocks.getProductById.mockImplementation(async (id: string) => ({
      id, slug: id, name: id === 'product-1' ? 'Alpha' : 'Beta', mrp: 100, price: 90,
      status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '', badge: '',
      description: '', highlights: [],
    }));
    const state = createInitialState();
    const result = await addCartItemsTool.handler(
      { items: [
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 2 },
      ] },
      { callSessionId: 'session-1', state }
    );

    expect(result).toMatchObject({ ok: true });
    expect(state.cart).toEqual([
      { productId: 'product-1', productName: 'Alpha', quantity: 2, unitPrice: 90 },
      { productId: 'product-2', productName: 'Beta', quantity: 2, unitPrice: 90 },
    ]);
  });
});
