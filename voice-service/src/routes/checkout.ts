import type { FastifyInstance } from 'fastify';
import { hashToken } from '../lib/crypto.js';
import {
  findCheckoutSessionByTokenHash, updateCheckoutSessionFields, freezeCheckoutPricing,
  attachPaymentLink, type CheckoutSessionRow,
} from '../repositories/checkoutSessions.repository.js';
import {
  listCheckoutItems, upsertCheckoutItem, removeCheckoutItem, freezeCheckoutItemPrices,
} from '../repositories/checkoutItems.repository.js';
import { listActiveProducts } from '../repositories/products.repository.js';
import { priceCart } from '../domain/pricing.js';
import { createPaymentLink } from '../payments/razorpay-links.js';
import { patchCheckoutBodySchema } from '../schemas/checkout.js';
import { config } from '../config.js';

async function resolveSession(rawToken: string): Promise<
  { ok: true; session: CheckoutSessionRow } | { ok: false; reason: 'not_found' | 'expired' }
> {
  const tokenHash = hashToken(rawToken);
  const session = await findCheckoutSessionByTokenHash(tokenHash);
  if (!session) return { ok: false, reason: 'not_found' };
  if (new Date(session.tokenExpiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, session };
}

async function itemsWithNames(checkoutSessionId: string) {
  const [items, products] = await Promise.all([listCheckoutItems(checkoutSessionId), listActiveProducts()]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((i) => ({
    productId: i.productId,
    name: byId.get(i.productId)?.name ?? 'Product',
    quantity: i.quantity,
    unitPrice: i.frozenUnitPrice ?? i.provisionalUnitPrice,
  }));
}

export async function registerCheckoutRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>('/checkout/:token', async (req, reply) => {
    const resolved = await resolveSession(req.params.token);
    if (!resolved.ok) return reply.status(404).send({ error: resolved.reason });

    const { session } = resolved;
    const items = await itemsWithNames(session.id);

    // Never return internal IDs beyond the opaque session shape the form needs.
    return reply.send({
      status: session.status,
      customer: {
        name: session.name, email: session.email, phone: session.phone, address: session.address,
        city: session.city, state: session.state, postalCode: session.postalCode, country: session.country,
        gst: session.gst, couponCode: session.couponCode, marketingConsent: session.marketingConsent,
      },
      items,
      pricing: session.frozenPricing,
      tokenExpiresAt: session.tokenExpiresAt,
    });
  });

  app.patch<{ Params: { token: string } }>('/checkout/:token', async (req, reply) => {
    const resolved = await resolveSession(req.params.token);
    if (!resolved.ok) return reply.status(404).send({ error: resolved.reason });
    const { session } = resolved;

    if (['payment_link_created', 'order_created', 'finalizing', 'payment_confirmed'].includes(session.status)) {
      return reply.status(409).send({ error: 'session_locked', message: 'This order can no longer be edited.' });
    }

    const parsed = patchCheckoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const body = parsed.data;

    await updateCheckoutSessionFields(session.id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.address !== undefined && { address: body.address }),
      ...(body.city !== undefined && { city: body.city }),
      ...(body.state !== undefined && { state: body.state }),
      ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
      ...(body.country !== undefined && { country: body.country }),
      ...(body.gst !== undefined && { gst: body.gst }),
      ...(body.couponCode !== undefined && { couponCode: body.couponCode }),
      ...(body.marketingConsent !== undefined && { marketingConsent: body.marketingConsent }),
      // Any edit invalidates a previous price freeze — the caller must call
      // verify-and-price again before a payment link can be created.
      status: 'opened',
    });

    if (body.items) {
      const existing = await listCheckoutItems(session.id);
      const nextIds = new Set(body.items.map((i) => i.productId));
      for (const existingItem of existing) {
        if (!nextIds.has(existingItem.productId)) {
          await removeCheckoutItem(session.id, existingItem.productId);
        }
      }
      for (const item of body.items) {
        const existingItem = existing.find((e) => e.productId === item.productId);
        await upsertCheckoutItem(
          session.id,
          item.productId,
          item.quantity,
          existingItem?.provisionalUnitPrice ?? 0 // re-priced properly on verify-and-price
        );
      }
    }

    return reply.send({ ok: true });
  });

  app.post<{ Params: { token: string } }>('/checkout/:token/verify-and-price', async (req, reply) => {
    const resolved = await resolveSession(req.params.token);
    if (!resolved.ok) return reply.status(404).send({ error: resolved.reason });
    const { session } = resolved;

    if (['payment_link_created', 'order_created', 'finalizing', 'payment_confirmed'].includes(session.status)) {
      return reply.status(409).send({ error: 'session_locked', message: 'This order can no longer be repriced.' });
    }

    const items = await listCheckoutItems(session.id);
    if (items.length === 0) {
      return reply.status(400).send({ error: 'empty_cart' });
    }

    const previousTotal = session.frozenPricing?.total ?? null;

    const priced = await priceCart(
      items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      { country: session.country, state: session.state, couponCode: session.couponCode }
    );

    await freezeCheckoutPricing(session.id, priced);
    await freezeCheckoutItemPrices(
      session.id,
      priced.lines.map((l) => ({ productId: l.productId, unitPrice: l.unitPrice }))
    );

    const requiresReconfirmation = previousTotal !== null && Math.abs(previousTotal - priced.total) > 0.01;

    return reply.send({ pricing: priced, requiresReconfirmation });
  });

  app.post<{ Params: { token: string } }>('/checkout/:token/payment-link', async (req, reply) => {
    const resolved = await resolveSession(req.params.token);
    if (!resolved.ok) return reply.status(404).send({ error: resolved.reason });
    const { session } = resolved;

    if (session.status !== 'repriced' || !session.frozenPricing) {
      return reply.status(409).send({
        error: 'pricing_not_frozen',
        message: 'Call verify-and-price immediately before requesting a payment link.',
      });
    }

    const referenceId = `voice-${session.id}`;
    const amountPaise = Math.round(session.frozenPricing.total * 100);

    try {
      const link = await createPaymentLink({
        amountPaise,
        currency: session.frozenPricing.currency,
        referenceId,
        customer: { name: session.name, email: session.email, contact: session.phone },
        callbackUrl: `${config.PUBLIC_APP_URL}/voice-checkout/${req.params.token}`,
      });

      await attachPaymentLink(session.id, { paymentLinkId: link.id, referenceId });

      return reply.send({ paymentLinkUrl: link.shortUrl });
    } catch (err) {
      req.log.error(err, 'failed to create Razorpay payment link');
      return reply.status(502).send({ error: 'payment_link_creation_failed' });
    }
  });

  app.get<{ Params: { token: string } }>('/checkout/:token/status', async (req, reply) => {
    const resolved = await resolveSession(req.params.token);
    if (!resolved.ok) return reply.status(404).send({ error: resolved.reason });
    const { session } = resolved;

    return reply.send({
      status: session.status,
      orderNumber: session.status === 'order_created' ? session.orderId : null,
    });
  });
}
