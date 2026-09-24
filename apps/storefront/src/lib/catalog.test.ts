import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./apiClient', () => ({ api: mocks.api }));
import { fetchCatalog, invalidateCatalog, subscribeCatalogChanges } from './catalog';

const unsubscribers: (() => void)[] = [];
beforeEach(() => { invalidateCatalog(); mocks.api.mockReset(); localStorage.clear(); });
afterEach(() => { unsubscribers.splice(0).forEach(unsubscribe => unsubscribe()); vi.useRealTimers(); });
describe('live catalogue cache', () => {
  it('deduplicates nearby reads but bypasses browser/proxy caches', async () => {
    mocks.api.mockResolvedValue({ products: [{ id: 'old' }], deals: [], reviews: [] });
    const first = fetchCatalog();
    expect(fetchCatalog()).toBe(first);
    await first;
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(mocks.api.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    mocks.api.mockResolvedValue({ products: [{ id: 'new' }], deals: [], reviews: [] });
    expect((await fetchCatalog(true)).products[0].id).toBe('new');
  });

  it('invalidates immediately after an admin save and signals another tab without product data', async () => {
    mocks.api.mockResolvedValue({ products: [], deals: [], reviews: [] });
    await fetchCatalog();
    const listener = vi.fn(); unsubscribers.push(subscribeCatalogChanges(listener));
    invalidateCatalog();
    expect(listener).toHaveBeenCalledOnce();
    expect(localStorage.getItem('earthora-catalog-changed')).toMatch(/^\d+:/);
    await fetchCatalog();
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it('invalidates on cross-tab changes and cleans up the listener only after all subscribers leave', async () => {
    mocks.api.mockResolvedValue({ products: [], deals: [], reviews: [] });
    await fetchCatalog();
    const first = vi.fn(), second = vi.fn();
    const unsubscribeFirst = subscribeCatalogChanges(first);
    unsubscribers.push(subscribeCatalogChanges(second));
    unsubscribeFirst();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(second).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: 'earthora-catalog-changed' }));
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    await fetchCatalog(); expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it('does not let an older failed request discard a new fresh cache entry', async () => {
    let rejectOld!: (error: Error) => void;
    mocks.api.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const old = fetchCatalog();
    const failed = expect(old).rejects.toThrow('Old failure');
    invalidateCatalog();
    mocks.api.mockResolvedValue({ products: [{ id: 'new' }], deals: [], reviews: [] });
    const current = fetchCatalog(); await current;
    rejectOld(new Error('Old failure')); await failed;
    expect(fetchCatalog()).toBe(current);
  });

  it('expires the short deduplication cache for later reads', async () => {
    vi.useFakeTimers(); mocks.api.mockResolvedValue({ products: [], deals: [], reviews: [] });
    await fetchCatalog(); vi.advanceTimersByTime(30_001); await fetchCatalog();
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });
});
