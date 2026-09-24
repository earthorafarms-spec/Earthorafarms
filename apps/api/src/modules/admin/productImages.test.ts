import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sql: vi.fn(), asset: vi.fn() }));
vi.mock('../../db/client.js', () => ({ sql: Object.assign(mocks.sql, { json: (value: unknown) => value }) }));
vi.mock('../../lib/assets.js', () => ({ storeAsset: mocks.asset }));
vi.mock('../commerce/orders.js', () => ({ getOrderBundle: vi.fn(), setOrderStatus: vi.fn() }));
vi.mock('../jobs/queue.js', () => ({ enqueueJob: vi.fn(), retryJob: vi.fn() }));
vi.mock('./gateway.js', () => ({ runGatewayQuery: vi.fn() }));
import { adminRoutes } from './routes.js';

const product = { id: '86e093ab-e50e-4ef8-b1b6-5c20873771f0', slug: 'new-product', images: [{ url: '/media/old.png', is_primary: true }] };
let handler: (request: any) => Promise<any>;
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => parts.join('').startsWith('SELECT id, slug') ? [product] : []);
  mocks.asset.mockResolvedValue({ url: '/media/new.png' });
  const staff = vi.fn(() => 'staff-guard');
  await adminRoutes({
    requireStaff: staff,
    post: (path: string, options: any, run: any) => {
      if (path === '/admin/products/:id/images') { handler = run; expect(options.preHandler).toBe('staff-guard'); expect(staff).toHaveBeenLastCalledWith('admin'); }
    }, get: vi.fn(),
  } as any);
});
function request(persist?: string) {
  const file = { mimetype: 'image/png', filename: 'new.png', fields: {} as Record<string, unknown>, toBuffer: async () => {
    // Multipart metadata may arrive after the file content.
    file.fields.is_primary = { value: 'true' };
    if (persist !== undefined) file.fields.persist = { value: persist };
    return Buffer.from('image');
  } };
  return { params: { id: product.id }, file: async () => file, staff: { id: 'staff-id' } };
}
describe('product image publication boundary', () => {
  it('stages a durable asset against an existing UUID without modifying public images', async () => {
    expect(await handler(request('false'))).toMatchObject({ success: true, url: '/media/new.png' });
    expect(mocks.asset).toHaveBeenCalledWith(expect.objectContaining({ folder: 'new-product', refId: product.id }));
    expect(mocks.sql.mock.calls.some(([parts]) => parts.join('').startsWith('UPDATE'))).toBe(false);
  });
  it('preserves default append behavior and honors primary metadata sent after the file', async () => {
    const result = await handler(request());
    expect(result.images).toEqual([{ url: '/media/old.png', is_primary: false }, { url: '/media/new.png', is_primary: true, alt: '' }]);
    expect(mocks.sql.mock.calls.some(([parts]) => parts.join('').startsWith('UPDATE products'))).toBe(true);
  });
  it('rejects upload when the product does not exist without storing an asset', async () => {
    mocks.sql.mockResolvedValue([]);
    await expect(handler(request('false'))).rejects.toThrow('Product not found');
    expect(mocks.asset).not.toHaveBeenCalled();
  });
});
