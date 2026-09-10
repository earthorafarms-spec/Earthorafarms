import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkoutRepository = vi.hoisted(() => ({
  findCheckoutSessionByTokenHash: vi.fn(), updateCheckoutSessionFields: vi.fn(),
  freezeCheckoutPricing: vi.fn(), attachPaymentLink: vi.fn(),
}));
const itemRepository = vi.hoisted(() => ({
  listCheckoutItems: vi.fn(), upsertCheckoutItem: vi.fn(), removeCheckoutItem: vi.fn(),
  freezeCheckoutItemPrices: vi.fn(),
}));
const productsRepository = vi.hoisted(() => ({ listActiveProducts: vi.fn() }));

vi.mock('../../src/repositories/checkoutSessions.repository.js', () => checkoutRepository);
vi.mock('../../src/repositories/checkoutItems.repository.js', () => itemRepository);
vi.mock('../../src/repositories/products.repository.js', () => productsRepository);
vi.mock('../../src/payments/razorpay-links.js', () => ({ createPaymentLink: vi.fn() }));

import { registerCheckoutRoutes } from '../../src/routes/checkout.js';

function session(status: string) {
  return {
    id: 'checkout-1', callSessionId: 'call-1', status,
    name: 'Test', email: 'test@example.com', phone: '+919876543210', address: '1 Road',
    city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001', country: 'India', gst: null,
    couponCode: null, marketingConsent: false, currency: 'INR', frozenPricing: { total: 799, currency: 'INR' },
    tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(), verifiedAt: null, pricingFrozenAt: null,
    razorpayPaymentLinkId: 'plink_1', razorpayReferenceId: 'voice-1', razorpayPaymentId: 'pay_1',
    paymentStatus: 'captured', orderId: status === 'order_created' ? 'order-123' : null,
  };
}

describe('expired voice checkout completion status', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    itemRepository.listCheckoutItems.mockResolvedValue([]);
    productsRepository.listActiveProducts.mockResolvedValue([]);
  });

  it('still exposes an already-created order after the edit token expires', async () => {
    checkoutRepository.findCheckoutSessionByTokenHash.mockResolvedValue(session('order_created'));
    const app = Fastify();
    await registerCheckoutRoutes(app);

    const status = await app.inject({ method: 'GET', url: '/checkout/opaque-token/status' });
    const checkout = await app.inject({ method: 'GET', url: '/checkout/opaque-token' });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: 'order_created', orderNumber: 'ORD-ORDER-12' });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json()).toMatchObject({ status: 'order_created', orderNumber: 'ORD-ORDER-12' });
    await app.close();
  });

  it('continues rejecting an expired unpaid review form', async () => {
    checkoutRepository.findCheckoutSessionByTokenHash.mockResolvedValue(session('opened'));
    const app = Fastify();
    await registerCheckoutRoutes(app);

    const response = await app.inject({ method: 'GET', url: '/checkout/opaque-token' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'expired' });
    await app.close();
  });
});
