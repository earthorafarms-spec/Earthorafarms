import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ products: vi.fn(), sql: vi.fn() }));
vi.mock('../../config.js', () => ({ config: {} }));
vi.mock('../../db/client.js', () => ({ sql: mocks.sql }));
vi.mock('../commerce/pricing.js', () => ({ listProducts: mocks.products, listActiveFestivalDeals: async () => [], priceCart: vi.fn() }));
vi.mock('../../lib/email.js', () => ({ brandedEmail: vi.fn(), escapeHtml: vi.fn(), sendEmail: vi.fn() }));
vi.mock('../../lib/razorpay.js', () => ({ createOrder: vi.fn(), fetchOrderExpanded: vi.fn(), fetchPayment: vi.fn(), razorpayConfigured: vi.fn(), verifyCheckoutSignature: vi.fn() }));
vi.mock('../../lib/crypto.js', () => ({ verifySigned: vi.fn() }));
vi.mock('../commerce/orders.js', () => ({ finalizeOrder: vi.fn(), getOrderBundle: vi.fn() }));
vi.mock('../notifications/invoice.js', () => ({ renderInvoiceForOrder: vi.fn() }));
vi.mock('../jobs/queue.js', () => ({ enqueueJob: vi.fn() }));

import { storeRoutes } from './routes.js';

const servers: ReturnType<typeof Fastify>[] = [];
beforeEach(() => { vi.resetAllMocks(); mocks.sql.mockResolvedValue([]); });
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

describe('public active product boundary', () => {
  it('shows newly published items and changed stock without exposing drafts or archived records', async () => {
    const rows = [
      { id: 'first', slug: 'first', name: 'First Product', status: 'active', price: 99, stockQty: 10 },
      { id: 'second', slug: 'second-slug', name: 'Second Product', status: 'archived', price: 249, stockQty: 5 },
      { id: 'draft', slug: 'draft-slug', name: 'Unpublished Product', status: 'draft', price: 399, stockQty: 10 },
    ];
    mocks.products.mockImplementation(async () => rows);
    const app = Fastify(); servers.push(app);
    app.decorate('requireStaff', () => async () => { throw new Error('Staff route is outside this public catalogue test'); });
    await app.register(storeRoutes);
    const before = await app.inject({ url: '/store/catalog' });
    expect(before.headers['cache-control']).toBe('no-store');
    expect(before.json().products.map((row: any) => row.id)).toEqual(['first']);
    for (const ref of ['second', 'second-slug', 'draft', 'draft-slug']) {
      expect((await app.inject({ url: '/store/products/' + ref })).statusCode).toBe(404);
    }
    rows[1].status = 'active';
    expect((await app.inject({ url: '/store/catalog' })).json().products.map((row: any) => row.id)).toEqual(['first', 'second']);
    const product = (await app.inject({ url: '/store/products/second-slug' })).json().product;
    expect(product).toMatchObject({ id: 'second', price: 249, stockQty: 5 });
    rows[1].price = 279; rows[1].stockQty = 0;
    expect((await app.inject({ url: '/store/products/second' })).json().product).toMatchObject({ price: 279, stockQty: 0 });
    rows[1].status = 'archived';
    expect((await app.inject({ url: '/store/products/second' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/store/catalog' })).json().products.map((row: any) => row.id)).toEqual(['first']);
  });
});
