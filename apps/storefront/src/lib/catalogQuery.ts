import { fetchPublicProducts } from './api';

/** Mounted visitors see published products within 30s; returning tabs refresh immediately. */
export const publicProductsQuery = {
  queryKey: ['public-products'] as const,
  queryFn: () => fetchPublicProducts(true),
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always' as const,
  refetchOnReconnect: 'always' as const,
};
