import { useEffect } from 'react';
import { useLocation } from 'wouter';

const PRODUCTS_DESTINATION = { id: 'products', path: '/', anchor: 'products', label: 'Products' } as const;
const STAFF_PREFIXES = ['/sun-earthora', '/kacc', '/developer'];

/** Chat answers contain prose, not trusted browser actions. Move only for a direct request to see products. */
export function productNavigationForChat(message: unknown) {
  if (typeof message !== 'string' || message.length > 2_000) return null;
  const words = message.replace(/\s+/g, ' ').trim();
  if (!/\b(?:moringa|morilife|tablets?|products?|catalog(?:ue)?|shop)\b/i.test(words)) return null;
  if (/\b(?:do not|don't|never)\s+(?:take|go|navigate|scroll|open|show)\b/i.test(words)) return null;

  const directMove = /\b(?:take me to|bring me to|go to|navigate to|scroll to|open)\b/i.test(words);
  const showProduct = /\bshow (?:me|us)\b(?!\s+(?:how|why|what|where)\b)/i.test(words);
  return directMove || showProduct ? PRODUCTS_DESTINATION : null;
}

/** The embedded chat widget emits this only after a successful text turn. */
export function ChatNavigationBridge() {
  const [location] = useLocation();
  const onStaffPage = STAFF_PREFIXES.some(prefix => location.startsWith(prefix));

  useEffect(() => {
    if (onStaffPage) return;
    let pending: AbortController | undefined;
    const onCompleted = (event: Event) => {
      const destination = productNavigationForChat((event as CustomEvent<{ message?: unknown }>).detail?.message);
      if (!destination || !window.EarthoraStorefrontNavigation) return;
      pending?.abort();
      pending = new AbortController();
      void window.EarthoraStorefrontNavigation.navigate(destination, pending.signal);
    };
    window.addEventListener('earthora:chat:completed', onCompleted);
    return () => {
      window.removeEventListener('earthora:chat:completed', onCompleted);
      pending?.abort();
    };
  }, [onStaffPage]);
  return null;
}
