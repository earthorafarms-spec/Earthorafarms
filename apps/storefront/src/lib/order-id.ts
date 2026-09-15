export type OrderSource = 'website' | 'offline';

const ORDER_PREFIX: Record<OrderSource, string> = {
  website: 'WEB',
  offline: 'OFF',
};

/**
 * Creates a compact, customer-safe order reference. The source prefix makes
 * the channel obvious while the timestamp/random suffix keeps references
 * unique without exposing a long database identifier.
 */
export function createOrderId(source: OrderSource): string {
  const timestamp = Date.now().toString(36).toUpperCase().slice(-5);
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
    : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${ORDER_PREFIX[source]}-${timestamp}${random}`;
}
