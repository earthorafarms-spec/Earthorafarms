import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn(), invalidate: vi.fn() }));
vi.mock('./apiClient', () => ({ api: mocks.api }));
vi.mock('./catalog', () => ({ invalidateCatalog: mocks.invalidate }));
import { saveAdminProduct } from './adminProducts';

const id = '86e093ab-e50e-4ef8-b1b6-5c20873771f0';
const fields = { name: 'New product', mrp: 999, price: 899, tag: '', badge: '', description: 'Description', highlights: [], rating: 4.5, category: 'moringa', hsn_code: '12119029' };
const input = () => ({ publishNew: true, slug: 'new-product', fields, stock: 25, files: [new File(['image'], 'product.png', { type: 'image/png' })], images: ['blob:local-preview'], onCreated: vi.fn() });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.mockImplementation(async (path, init) => path.endsWith('/images') ? { url: '/media/product-images/new-product/image.png' } : { data: [{ id }] });
});
const writes = () => mocks.api.mock.calls.filter(([path]) => path === '/api/admin/query').map(([, init]) => init.json);

describe('admin product publication', () => {
  it('creates a hidden UUID row, uploads durable images and stock, then publishes last', async () => {
    const value = input();
    expect(await saveAdminProduct(value)).toBe(id);
    expect(value.onCreated).toHaveBeenCalledWith(id);
    expect(writes()[0]).toMatchObject({ table: 'products', op: 'insert', values: { status: 'archived', images: [] } });
    const upload = mocks.api.mock.calls[1];
    expect(upload[0]).toBe(`/api/admin/products/${id}/images`);
    expect(upload[1].body.get('persist')).toBe('false');
    expect([...upload[1].body.keys()].at(-1)).toBe('file');
    expect(writes()[1]).toEqual({ table: 'inventory', op: 'upsert', onConflict: 'product_id', values: { product_id: id, total_stock: 25 } });
    expect(writes()[2]).toMatchObject({ op: 'update', values: { status: 'active', images: [{ url: '/media/product-images/new-product/image.png', is_primary: true }] } });
    expect(JSON.stringify(writes())).not.toContain('blob:');
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('edits by existing UUID, preserving publication status and reserved inventory', async () => {
    const value = { ...input(), id, publishNew: false, slug: 'renamed-product' };
    await saveAdminProduct(value);
    expect(mocks.api.mock.calls[0][0]).toBe(`/api/admin/products/${id}/images`);
    expect(value.onCreated).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].values).not.toHaveProperty('status');
    expect(writes()[1].values).not.toHaveProperty('slug');
    expect(writes()[0].values).not.toHaveProperty('reserved_stock');
  });

  it('keeps a failed new upload unpublished and retries the same UUID without duplicate insertion', async () => {
    const value = input();
    mocks.api.mockImplementation(async path => { if (path.endsWith('/images')) throw new Error('Upload unavailable'); return { data: [{ id }] }; });
    await expect(saveAdminProduct(value)).rejects.toThrow('Upload unavailable');
    expect(writes()).toHaveLength(1);
    expect(writes()[0].values.status).toBe('archived');
    expect(value.onCreated).toHaveBeenCalledWith(id);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    mocks.api.mockClear();
    mocks.api.mockImplementation(async path => path.endsWith('/images') ? { url: 'https://assets.example.invalid/real.png' } : { data: [{ id }] });
    await saveAdminProduct({ ...value, id });
    expect(writes().some(write => write.op === 'insert')).toBe(false);
    expect(writes().at(-1).values.status).toBe('active');
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('does not change live details or stock when a later staged image fails', async () => {
    const value = input();
    value.files.push(new File(['second'], 'second.png', { type: 'image/png' }));
    mocks.api.mockResolvedValueOnce({ url: '/media/first.png' }).mockRejectedValueOnce(new Error('Second upload failed'));
    await expect(saveAdminProduct({ ...value, id, publishNew: false })).rejects.toThrow('Second upload failed');
    expect(writes()).toHaveLength(0);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('does not publish if inventory save fails', async () => {
    mocks.api.mockImplementation(async (path, init) => {
      if (init.json?.table === 'inventory') throw new Error('Inventory failed');
      return path.endsWith('/images') ? { url: '/media/real.png' } : { data: [{ id }] };
    });
    await expect(saveAdminProduct(input())).rejects.toThrow('Inventory failed');
    expect(writes().some(write => write.op === 'update')).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each(['blob:preview', 'data:image/png;base64,abc', 'javascript:alert(1)', '//untrusted.example/image'])('rejects nonpermanent saved image %s', async url => {
    await expect(saveAdminProduct({ ...input(), id, files: [], images: [url] })).rejects.toThrow('local previews');
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('does not accept a blob URL returned by a broken uploader', async () => {
    mocks.api.mockResolvedValue({ url: 'blob:bad-upload' });
    await expect(saveAdminProduct({ ...input(), id })).rejects.toThrow('permanent URL');
    expect(writes()).toHaveLength(0);
  });

  it('persists explicitly cleared images and errors when the edited product was deleted', async () => {
    mocks.api.mockResolvedValueOnce({ data: [{ id }] }).mockResolvedValueOnce({ data: [] });
    await expect(saveAdminProduct({ ...input(), id, publishNew: false, files: [], images: [] })).rejects.toThrow('no longer exists');
    expect(writes()[1].values.images).toEqual([]);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each([-1, 1.2, NaN])('rejects invalid stock before writes: %s', async stock => {
    await expect(saveAdminProduct({ ...input(), stock })).rejects.toThrow('whole-number');
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
