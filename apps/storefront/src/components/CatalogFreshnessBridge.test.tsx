import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryObserver, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ products: vi.fn() }));
vi.mock('@/lib/api', () => ({ fetchPublicProducts: mocks.products }));
import { CatalogFreshnessBridge } from './CatalogFreshnessBridge';
import { publicProductsQuery } from '@/lib/catalogQuery';
import { invalidateCatalog } from '@/lib/catalog';

let client: QueryClient, root: Root, unsubscribe: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.products.mockReset().mockResolvedValue([{ id: 'old' }]);
  focusManager.setFocused(true); onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 600_000, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false } } });
  client.mount();
  const observer = new QueryObserver(client, publicProductsQuery);
  unsubscribe = observer.subscribe(() => {});
  const mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  act(() => root.render(<QueryClientProvider client={client}><CatalogFreshnessBridge /></QueryClientProvider>));
});
afterEach(() => {
  act(() => root.unmount()); unsubscribe(); client.unmount(); client.clear();
  document.body.innerHTML = ''; focusManager.setFocused(undefined); onlineManager.setOnline(true); vi.useRealTimers();
});
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
describe('storefront publication refresh', () => {
  it('refreshes active product queries immediately after an admin save, despite fresh cached data', async () => {
    await settle(); expect(client.getQueryData(['public-products'])).toEqual([{ id: 'old' }]);
    mocks.products.mockResolvedValue([{ id: 'new' }]);
    act(() => invalidateCatalog()); await settle();
    expect(client.getQueryData(['public-products'])).toEqual([{ id: 'new' }]);
    expect(mocks.products).toHaveBeenLastCalledWith(true);
  });

  it('refreshes a visible visitor without navigation and pauses polling in the background', async () => {
    await settle(); expect(mocks.products).toHaveBeenCalledTimes(1);
    mocks.products.mockResolvedValue([{ id: 'published-elsewhere' }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(client.getQueryData(['public-products'])).toEqual([{ id: 'published-elsewhere' }]);
    focusManager.setFocused(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.products).toHaveBeenCalledTimes(2);
  });

  it('refreshes on focus and reconnect even inside the fresh-data window', async () => {
    await settle();
    focusManager.setFocused(false); focusManager.setFocused(true); await settle();
    expect(mocks.products).toHaveBeenCalledTimes(2);
    onlineManager.setOnline(false); onlineManager.setOnline(true); await settle();
    expect(mocks.products).toHaveBeenCalledTimes(3);
  });
});
