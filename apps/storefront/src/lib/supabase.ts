/**
 * Compatibility client: keeps the `supabase.from(...)` call shape the admin pages were written against,
 * but every query is executed by the owned API's allow-listed gateway (staff session required), and the
 * three public inserts (reviews, contact, analytics) are routed to their dedicated store endpoints.
 * Realtime channels are no-ops (pages already poll); Edge Functions map to API routes.
 */
import { api, ApiError } from './apiClient';

type Filter = { op: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike' | 'is'; col: string; value: unknown };
type Result<T = any> = { data: T; error: { message: string; code?: string; details?: unknown } | null; count: number | null };

class QueryBuilder<T = any> implements PromiseLike<Result<T>> {
  private q: {
    table: string; op: 'select' | 'insert' | 'update' | 'upsert' | 'delete'; columns?: string; filters: Filter[];
    order: { col: string; asc: boolean }[]; limit?: number; offset?: number; values?: unknown; onConflict?: string; count?: boolean; head?: boolean;
  };
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private signal?: AbortSignal;

  constructor(table: string) { this.q = { table, op: 'select', filters: [], order: [] }; }
  select(columns = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.q.op === 'select') { this.q.columns = columns; } else { this.q.columns = columns; }
    if (opts?.count) this.q.count = true; if (opts?.head) this.q.head = true; return this;
  }
  insert(values: unknown) { this.q.op = 'insert'; this.q.values = values; return this; }
  update(values: unknown) { this.q.op = 'update'; this.q.values = values; return this; }
  upsert(values: unknown, opts?: { onConflict?: string }) { this.q.op = 'upsert'; this.q.values = values; this.q.onConflict = opts?.onConflict; return this; }
  delete() { this.q.op = 'delete'; return this; }
  eq(col: string, value: unknown) { this.q.filters.push({ op: 'eq', col, value }); return this; }
  neq(col: string, value: unknown) { this.q.filters.push({ op: 'neq', col, value }); return this; }
  in(col: string, value: unknown[]) { this.q.filters.push({ op: 'in', col, value }); return this; }
  gte(col: string, value: unknown) { this.q.filters.push({ op: 'gte', col, value }); return this; }
  lte(col: string, value: unknown) { this.q.filters.push({ op: 'lte', col, value }); return this; }
  gt(col: string, value: unknown) { this.q.filters.push({ op: 'gt', col, value }); return this; }
  lt(col: string, value: unknown) { this.q.filters.push({ op: 'lt', col, value }); return this; }
  ilike(col: string, value: string) { this.q.filters.push({ op: 'ilike', col, value }); return this; }
  is(col: string, value: unknown) { this.q.filters.push({ op: 'is', col, value }); return this; }
  or(): never { throw new Error('supabase.or() is not supported by the gateway — use a dedicated endpoint'); }
  order(col: string, opts?: { ascending?: boolean }) { this.q.order.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.q.limit = n; return this; }
  range(from: number, to: number) { this.q.offset = from; this.q.limit = to - from + 1; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this; }
  abortSignal(signal: AbortSignal) { this.signal = signal; return this; }

  private async execute(): Promise<Result<T>> {
    try {
      const publicRoute = publicInsertRoute(this.q.table, this.q.op, this.q.values);
      if (publicRoute) {
        await api(publicRoute.path, { method: 'POST', json: publicRoute.body, signal: this.signal });
        return { data: [] as any, error: null, count: null };
      }
      const res = await api<{ data: any; count: number | null }>('/api/admin/query', { method: 'POST', json: this.q, signal: this.signal });
      let data: any = res.data;
      if (this.mode === 'single') {
        if (!Array.isArray(data) || data.length !== 1) return { data: null as any, error: { message: 'Expected exactly one row', code: 'PGRST116' }, count: res.count };
        data = data[0];
      } else if (this.mode === 'maybeSingle') {
        data = Array.isArray(data) ? (data[0] ?? null) : data;
      }
      return { data, error: null, count: res.count };
    } catch (err) {
      const e = err as ApiError;
      return { data: null as any, error: { message: e.message || 'Request failed', code: e.code, details: e.details }, count: null };
    }
  }
  then<R1 = Result<T>, R2 = never>(onfulfilled?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null, onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function publicInsertRoute(table: string, op: string, values: unknown): { path: string; body: unknown } | null {
  if (op !== 'insert' || !values || Array.isArray(values)) return null;
  const v = values as Record<string, any>;
  if (table === 'review_details') return { path: '/api/store/reviews', body: { productId: v.review_product_id, name: v.review_user_id, rating: Number(v.review_rating), comment: v.review_comment } };
  if (table === 'Contact_details') {
    if (String(v.contact_topic || '').toLowerCase().includes('newsletter')) return { path: '/api/store/newsletter', body: { email: v.contact_email } };
    return { path: '/api/store/contact', body: { name: v.contact_name, email: v.contact_email, phone: v.contact_phone || '', topic: v.contact_topic || 'General', message: v.contact_message, marketingConsent: Boolean(v.contact_marketing_consent) } };
  }
  if (table === 'Admin_analytics') return { path: '/api/store/analytics', body: { page: v.page_name, device: v.visitor_device, os: v.visitor_os, browser: v.visitor_browser, country: v.visitor_country, city: v.visitor_city } };
  return null;
}

/** Edge Function names → owned API routes. */
const FUNCTION_ROUTES: Record<string, (body: any) => { path: string; method?: string; json?: unknown }> = {
  'send-order-tracking': (b) => ({ path: `/api/admin/orders/${encodeURIComponent(b.orderId)}/tracking`, json: { trackingUrl: b.trackingUrl } }),
  'update-admin-password': (b) => ({ path: '/api/auth/password', json: { currentPassword: b.currentPassword, newPassword: b.newPassword } }),
  'manage-product-knowledge': (b) => ({ path: '/api/admin/knowledge', json: b }),
  'send-invoice': (b) => ({ path: `/api/admin/orders/${encodeURIComponent(b.orderId)}/resend-invoice` }),
};

/** Realtime replacement: `.on()` callbacks are polled every 15s while the tab is visible. */
class PollingChannel {
  private callbacks: (() => void)[] = [];
  private timer: number | null = null;
  on(_event: string, _filter: unknown, cb: () => void) { this.callbacks.push(cb); return this; }
  subscribe() {
    if (this.timer === null) this.timer = window.setInterval(() => { if (!document.hidden) this.callbacks.forEach((cb) => cb()); }, 15_000);
    return this;
  }
  unsubscribe() { if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; } return Promise.resolve('ok'); }
}

const RPC_ROUTES: Record<string, (args: any) => { path: string; json: unknown }> = {
  restock_product: (a) => ({ path: '/api/admin/inventory/restock', json: { productId: a.p_product_id, quantity: Number(a.p_quantity), note: a.p_notes } }),
};

export const supabase = {
  from<T = any>(table: string) { return new QueryBuilder<T>(table); },
  async rpc(name: string, args?: Record<string, unknown>) {
    const route = RPC_ROUTES[name];
    if (!route) return { data: null, error: { message: `RPC ${name} has no API route` } };
    try { const r = route(args ?? {}); const data = await api(r.path, { method: 'POST', json: r.json }); return { data, error: null }; }
    catch (err) { return { data: null, error: err as ApiError }; }
  },
  functions: {
    async invoke(name: string, opts?: { body?: any; headers?: Record<string, string> }): Promise<{ data: any; error: { message: string } | null }> {
      const route = FUNCTION_ROUTES[name];
      if (!route) return { data: null, error: { message: `Function ${name} has no API route` } };
      try {
        const r = route(opts?.body ?? {});
        const data = await api<any>(r.path, { method: r.method ?? 'POST', json: r.json ?? {} });
        return { data, error: null };
      } catch (err) {
        return { data: null, error: err as ApiError };
      }
    },
  },
  channel(_name: string) { return new PollingChannel(); },
  removeChannel(c: unknown) { return (c as PollingChannel).unsubscribe(); },
};
