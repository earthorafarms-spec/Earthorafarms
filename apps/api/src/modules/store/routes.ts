import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { sql } from '../../db/client.js';
import { badRequest, notFound, upstream } from '../../lib/errors.js';
import { brandedEmail, escapeHtml, sendEmail } from '../../lib/email.js';
import { createOrder, fetchOrderExpanded, fetchPayment, razorpayConfigured, verifyCheckoutSignature, type RazorpayLineItem } from '../../lib/razorpay.js';
import { verifySigned } from '../../lib/crypto.js';
import { listActiveFestivalDeals, listProducts, priceCart } from '../commerce/pricing.js';
import { finalizeOrder, getOrderBundle } from '../commerce/orders.js';
import { renderInvoiceForOrder } from '../notifications/invoice.js';
import { enqueueJob } from '../jobs/queue.js';
import { checkoutCustomerSchema } from '../../platform/channels/voiceCheckout.js';

const cartSchema = z.object({
  cartItems: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).min(1).max(30),
  couponCode: z.string().max(40).optional().nullable(),
  currency: z.literal('INR').optional(),
});

function noScript(s: string): boolean {
  return !/<\s*script|javascript:|on\w+\s*=|<\s*iframe/i.test(s);
}

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  /** Everything the storefront catalogue needs in one call (products + inventory, reviews, active deals). */
  app.get('/store/catalog', async (_req, reply) => {
    const [products, deals, reviews] = await Promise.all([
      listProducts(),
      listActiveFestivalDeals(),
      sql<any[]>`SELECT review_product_id, review_user_id, review_rating, review_comment, review_created_at FROM review_details ORDER BY review_created_at DESC LIMIT 500`,
    ]);
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return {
      products: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, price: p.price, mrp: p.mrp, status: p.status, tag: p.tag, badge: p.badge, description: p.description, highlights: p.highlights, images: p.images, rating: p.rating, created_at: p.created_at, inventory: [{ total_stock: p.stockQty }] })),
      deals: deals.map((d) => ({ id: String(d.id), festival_name: d.name, festival_status: 'active', discount_type: d.discountType, discount_value: d.discountValue, festival_deal_products: d.productIds.map((product_id) => ({ product_id })), festival_start_date: new Date(0).toISOString(), festival_end_date: new Date(8640000000000000).toISOString() })),
      reviews,
    };
  });

  app.get('/store/products/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const products = await listProducts();
    const p = products.find((x) => x.slug === slug || x.id === slug);
    if (!p) throw notFound('Product not found');
    return { product: p };
  });

  app.post('/store/reviews', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ productId: z.string().uuid(), name: z.string().min(1).max(80), rating: z.number().min(1).max(5), comment: z.string().max(1000) }).safeParse(req.body);
    if (!body.success) throw badRequest('Invalid review');
    if (!noScript(body.data.comment) || !noScript(body.data.name)) throw badRequest('Invalid characters');
    await sql`INSERT INTO review_details (review_product_id, review_user_id, review_rating, review_comment) VALUES (${body.data.productId}, ${body.data.name}, ${body.data.rating}, ${body.data.comment})`;
    return { ok: true };
  });

  app.post('/store/contact', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ name: z.string().min(1).max(120), email: z.string().email(), phone: z.string().max(30).optional().default(''), topic: z.string().max(120).optional().default('General'), message: z.string().min(1).max(4000), marketingConsent: z.boolean().optional().default(false) }).safeParse(req.body);
    if (!body.success) throw badRequest('Please fill the form correctly');
    const d = body.data;
    if (![d.name, d.message, d.topic].every(noScript)) throw badRequest('Invalid characters in message');
    await sql`INSERT INTO "Contact_details" (contact_name, contact_email, contact_phone, contact_topic, contact_message, contact_marketing_consent) VALUES (${d.name}, ${d.email}, ${d.phone}, ${d.topic}, ${d.message}, ${d.marketingConsent})`;
    await enqueueJob('contact_email', { ...d });
    return { ok: true };
  });

  app.post('/store/newsletter', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!body.success) throw badRequest('Enter a valid email');
    await sql`INSERT INTO "Contact_details" (contact_name, contact_email, contact_topic, contact_message, contact_marketing_consent) VALUES ('Newsletter', ${body.data.email}, 'newsletter', 'Newsletter signup', true)`;
    return { ok: true };
  });

  app.post('/store/restock-request', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const body = z.object({ productId: z.string().uuid(), phone: z.string().min(8).max(20) }).safeParse(req.body);
    if (!body.success) throw badRequest('Product and phone are required');
    await sql`INSERT INTO customer_restock_requests (product_id, customer_phone) VALUES (${body.data.productId}, ${body.data.phone}) ON CONFLICT (product_id, customer_phone) DO NOTHING`;
    return { ok: true };
  });

  app.post('/store/analytics', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = z.object({ page: z.string().max(200), device: z.string().max(60).optional(), os: z.string().max(60).optional(), browser: z.string().max(60).optional(), country: z.string().max(60).optional(), city: z.string().max(60).optional() }).safeParse(req.body);
    if (!body.success) return { ok: false };
    const d = body.data;
    await sql`INSERT INTO "Admin_analytics" (page_name, visitor_ip, visitor_device, visitor_os, visitor_browser, visitor_country, visitor_city) VALUES (${d.page}, ${req.ip}, ${d.device ?? ''}, ${d.os ?? ''}, ${d.browser ?? ''}, ${d.country ?? ''}, ${d.city ?? ''})`;
    return { ok: true };
  });

  /** Price a cart (used by the cart page to show live totals + coupon result). */
  app.post('/store/checkout/price', async (req) => {
    const body = cartSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid cart');
    return priceCart(body.data.cartItems, { couponCode: body.data.couponCode });
  });

  /** Creates the Razorpay order from server-side prices (Magic Checkout collects the address). */
  app.post('/store/checkout/order', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    if (!razorpayConfigured()) throw upstream('Payments are not configured');
    const body = cartSchema.extend({ customer: checkoutCustomerSchema.optional() }).safeParse(req.body);
    if (!body.success) throw badRequest('Invalid cart');
    const cart = await priceCart(body.data.cartItems, { couponCode: body.data.couponCode, country: body.data.customer?.country, state: body.data.customer?.state });
    if (cart.unavailable.length) throw badRequest('Some products are no longer available');
    if (cart.outOfStock.length) throw badRequest('Some products are out of stock', cart.outOfStock);
    const amountPaise = Math.round(cart.total * 100);
    if (amountPaise < 100) throw badRequest('Order total is below the minimum amount');
    const lineItems: RazorpayLineItem[] = cart.lines.map((l) => ({
      sku: l.slug, variant_id: l.productId, price: Math.round(l.unitPrice * 100), offer_price: Math.round(l.unitPrice * 100), tax_amount: 0, quantity: l.quantity,
      name: l.name, description: l.name, weight: 0, dimensions: {}, image_url: '', product_url: `${config.PUBLIC_STORE_URL}/our-product?open=${l.productId}`, notes: {},
    }));
    const order = await createOrder({ amountPaise, currency: 'INR', receipt: `rcpt_${Date.now()}`, lineItems, notes: { source: 'website', coupon: cart.couponCode ?? '' } });
    await sql`INSERT INTO payment_webhook_events (provider, provider_event_id, event_type, signature_valid, payload, processing_status) VALUES ('razorpay', ${`order-created:${order.id}`}, 'order.created.local', true, ${sql.json({ cart: cart as any, razorpay_order_id: order.id, customer: body.data.customer ?? null })}, 'processed')`;
    return { order_id: order.id, amount: order.amount, currency: order.currency, key_id: config.RAZORPAY_KEY_ID };
  });

  /** Verifies the checkout signature, pulls customer + shipping from Razorpay, finalizes the order server-side. */
  app.post('/store/checkout/verify', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const body = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
    if (!body.success) throw badRequest('Missing payment fields');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body.data;
    if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) throw badRequest('Payment signature mismatch');
    const [payment, order] = await Promise.all([fetchPayment(razorpay_payment_id), fetchOrderExpanded(razorpay_order_id)]);
    if (payment.order_id !== razorpay_order_id || !['captured', 'authorized'].includes(payment.status)) throw badRequest('Payment not captured');
    const [evt] = await sql<any[]>`SELECT payload FROM payment_webhook_events WHERE provider_event_id = ${`order-created:${razorpay_order_id}`}`;
    const cartLines = (evt?.payload?.cart?.lines ?? []) as { productId: string; quantity: number }[];
    const coupon = evt?.payload?.cart?.couponCode ?? null;
    const cd = order.customer_details ?? {};
    const ship = cd.shipping_address ?? {};
    const saved = checkoutCustomerSchema.safeParse(evt?.payload?.customer);
    const delivery = saved.success ? saved.data : null;
    const customer = {
      name: cd.name || ship.name || delivery?.name || (payment.email ?? '').split('@')[0] || 'Guest',
      email: cd.email || payment.email || delivery?.email || '',
      phone: cd.contact || ship.contact || payment.contact || delivery?.phone || '',
      address: [ship.line1, ship.line2].filter(Boolean).join(', ') || delivery?.address || '',
      city: ship.city || delivery?.city || '', state: ship.state || delivery?.state || '', zip: ship.zipcode || delivery?.zip || '', country: ship.country || delivery?.country || 'India',
    };
    const cart = await priceCart(cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity })), { couponCode: coupon, country: customer.country, state: customer.state });
    if (Math.round(cart.total * 100) !== payment.amount) {
      req.log.warn({ expected: cart.total, paid: payment.amount / 100 }, 'amount mismatch — recording paid amount');
      cart.total = payment.amount / 100;
    }
    const result = await finalizeOrder({
      source: 'website', cart, customer,
      payment: { method: 'RAZORPAY', transactionId: razorpay_payment_id, status: 'completed', amount: payment.amount / 100, context: { razorpay_order_id, method: payment.method ?? null } },
    });
    return { success: true, orderId: result.orderId, orderNumber: result.orderNumber, amount: payment.amount, currency: payment.currency, customer, shipping_address: ship };
  });

  app.get('/store/orders/:orderId', async (req) => {
    const { orderId } = req.params as { orderId: string };
    const { email, phone } = req.query as { email?: string; phone?: string };
    const bundle = await getOrderBundle(orderId);
    if (!bundle) throw notFound('Order not found');
    const o = bundle.order;
    const match = (email && o.customer_email && email.toLowerCase() === String(o.customer_email).toLowerCase()) || (phone && o.customer_phone && phone.replace(/\D/g, '').slice(-10) === String(o.customer_phone).replace(/\D/g, '').slice(-10));
    if (!match) throw notFound('Order not found');
    return { order: { id: o.id, order_number: o.order_number, status: o.status, total_amount: o.total_amount, created_at: o.created_at, tracking_url: o.tracking_url ?? null, items: bundle.items.map((i) => ({ name: i.product_name, quantity: i.quantity, unit_price: i.unit_price, total_price: i.total_price })) } };
  });

  /** Signed invoice download: token = signPayload(orderId). */
  app.get('/store/invoice/:token', async (req, reply) => {
    const orderId = verifySigned((req.params as { token: string }).token);
    if (!orderId) throw notFound('Invoice link is invalid');
    const pdf = await renderInvoiceForOrder(orderId, 'en');
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="invoice-${orderId}.pdf"`);
    return reply.send(pdf);
  });

  app.get('/store/health', async () => ({ ok: true, products: (await listProducts()).length }));

  // Contact-form email is sent by the worker, but keep a direct helper for tests
  app.post('/store/_preview-email', { preHandler: app.requireStaff('developer') }, async (req) => {
    const body = z.object({ to: z.string().email() }).parse(req.body);
    await sendEmail({ to: body.to, kind: 'preview', subject: 'Earthora email preview', html: brandedEmail('Preview', `<p>${escapeHtml('Hello from the new Earthora platform.')}</p>`) });
    return { ok: true };
  });
}
