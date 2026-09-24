import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeCatalogChanges } from '@/lib/catalog';

export function CatalogFreshnessBridge() {
  const queryClient = useQueryClient();
  useEffect(() => subscribeCatalogChanges(() => {
    void queryClient.invalidateQueries({ queryKey: ['public-products'] });
  }), [queryClient]);
  return null;
}
