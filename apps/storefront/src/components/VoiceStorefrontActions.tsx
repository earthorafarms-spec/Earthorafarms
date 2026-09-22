import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useCart } from '@/contexts/cart-context';
import { fetchCatalog, getDiscountedPrice } from '@/lib/api';
import type { CartItem } from '@/types';

type Action = {action: string; payload: Record<string, unknown>};
type Result = {ok: boolean; reason?: string};
declare global { interface Window { EarthoraStorefrontActions?: {execute: (action: Action, signal: AbortSignal) => Promise<Result>} } }

export function validCheckoutPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/ai-checkout\/vc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(path) && path.length <= 8220;
}

export function VoiceStorefrontActions() {
  const [, setLocation] = useLocation();
  const { applyVoiceItems } = useCart();
  useEffect(() => {
    const bridge = { async execute({action, payload}: Action, signal: AbortSignal): Promise<Result> {
      if (signal.aborted) return {ok: false, reason: 'action_cancelled'};
      if (!payload || typeof payload !== 'object' || /^\/(sun-earthora|kacc|developer)(\/|$)/.test(location.pathname)) return {ok: false, reason: 'unsupported_page'};
      if (action === 'scroll_page') {
        if (!['up', 'down', 'top', 'bottom'].includes(String(payload.direction))) return {ok: false, reason: 'invalid_direction'};
        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const direction = payload.direction;
        const target = direction === 'top' ? 0 : direction === 'bottom' ? maximum : Math.min(maximum, Math.max(0, window.scrollY + (direction === 'up' ? -1 : 1) * window.innerHeight * .75));
        // Acknowledgement describes the committed scroll position, not merely scheduling an animation.
        window.scrollTo({top: target, behavior: 'instant'});
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return signal.aborted ? {ok: false, reason: 'action_cancelled'} : Math.abs(window.scrollY - target) <= 3 ? {ok: true} : {ok: false, reason: 'scroll_blocked'};
      }
      if (action === 'sync_cart') {
        if (!Array.isArray(payload.items) || !Array.isArray(payload.scope_product_ids) || payload.items.length > 30 || payload.scope_product_ids.length > 30) return {ok: false, reason: 'invalid_cart'};
        const scope = payload.scope_product_ids;
        if (scope.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(id)) || new Set(scope).size !== scope.length) return {ok: false, reason: 'invalid_cart'};
        const entries = payload.items as {product_id: string; quantity: number}[];
        if (entries.some(item => !item || !scope.includes(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 50) || new Set(entries.map(item => item.product_id)).size !== entries.length) return {ok: false, reason: 'invalid_cart'};
        try {
          const {products, deals} = await fetchCatalog(true);
          if (signal.aborted) return {ok: false, reason: 'action_cancelled'};
          const next: CartItem[] = [];
          for (const entry of entries) {
            if (!entry.quantity) continue;
            const product = products.find(product => product.id === entry.product_id && product.status === 'active');
            const inventory = product && (Array.isArray(product.inventory) ? product.inventory[0] : product.inventory);
            if (!product || Number(inventory?.total_stock ?? 0) < entry.quantity) return {ok: false, reason: 'product_unavailable'};
            const images = Array.isArray(product.images) ? product.images : [];
            next.push({id: product.id, name: product.name, quantity: entry.quantity, price: getDiscountedPrice(product.id, Number(product.price), deals), image: images.find(image => image.is_primary)?.url || images[0]?.url || '/favicon.svg'});
          }
          applyVoiceItems(next, scope as string[]);
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          return signal.aborted ? {ok: false, reason: 'action_cancelled'} : {ok: true};
        } catch { return {ok: false, reason: 'catalogue_unavailable'}; }
      }
      if (action === 'open_checkout') {
        if (!validCheckoutPath(payload.path)) return {ok: false, reason: 'invalid_checkout'};
        const path = payload.path;
        return new Promise(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          let finished = false;
          const observer = new MutationObserver(check);
          function finish(result: Result) { if (finished) return; finished = true; clearTimeout(timer); observer.disconnect(); signal.removeEventListener('abort', abort); resolve(result); }
          function abort() { finish({ok: false, reason: 'action_cancelled'}); }
          function check() {
            if (location.pathname !== path) return;
            const ready = document.querySelector('[data-voice-checkout-ready]');
            if (ready) finish({ok: ready.getAttribute('data-voice-checkout-ready') === 'true', ...(ready.getAttribute('data-voice-checkout-ready') === 'true' ? {} : {reason: 'checkout_unavailable'})});
          }
          timer = setTimeout(() => finish({ok: false, reason: 'checkout_timeout'}), 10000);
          observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-voice-checkout-ready']});
          signal.addEventListener('abort', abort, {once: true});
          setLocation(path); check();
        });
      }
      return {ok: false, reason: 'unsupported_action'};
    }};
    window.EarthoraStorefrontActions = bridge;
    return () => { if (window.EarthoraStorefrontActions === bridge) delete window.EarthoraStorefrontActions; };
  }, [applyVoiceItems, setLocation]);
  return null;
}
