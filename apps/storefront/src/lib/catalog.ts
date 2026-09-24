import { api } from './apiClient';
import type { DbProduct, DbReview, FestiveDeal } from '@/types';

export interface Catalog { products: DbProduct[]; deals: FestiveDeal[]; reviews: DbReview[] }

const CHANGE_KEY = 'earthora-catalog-changed';
const CACHE_TTL = 30_000;
let cache: { at: number; promise: Promise<Catalog> } | null = null;
const listeners = new Set<() => void>();

/** Dedupe nearby reads, but never reuse an HTTP cache containing old prices/stock. */
export function fetchCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) return cache.promise;
  const promise = api<Catalog>('/api/store/catalog', {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    if (cache?.promise === promise) cache = null;
    throw error;
  });
  cache = { at: Date.now(), promise };
  return promise;
}

function changed(): void {
  cache = null;
  listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  if (event.key === CHANGE_KEY) changed();
}

/** Same-tab update plus a data-free signal to other storefront/admin tabs. */
export function invalidateCatalog(): void {
  changed();
  try { localStorage.setItem(CHANGE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Storage may be disabled. */ }
}

export function subscribeCatalogChanges(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}
