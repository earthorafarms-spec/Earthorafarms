// netlify/functions/verify-razorpay-payment.mjs
// Server-side function — verifies the Razorpay payment signature, then fetches
// the Magic Checkout customer + shipping address from Razorpay and returns them
// so the client can persist the order.
// Uses Node.js built-in `crypto` — no extra npm packages needed.
// KEY_SECRET is NEVER exposed to the frontend.

import { createHmac, timingSafeEqual } from 'crypto';

const KEY_ID               = process.env.RAZORPAY_KEY_ID      ?? '';
const KEY_SECRET           = process.env.RAZORPAY_KEY_SECRET  ?? '';
const NETLIFY_INTERNAL_KEY = process.env.NETLIFY_INTERNAL_KEY ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Key',
};

async function fetchPaymentDetails(paymentId) {
  if (!KEY_ID || !KEY_SECRET || !paymentId) return null;
  try {
    const authHeader = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.warn('fetchPaymentDetails error:', err?.message || err);
    return null;
  }
}

async function fetchOrderDetails(orderId) {
  if (!KEY_ID || !KEY_SECRET || !orderId) return null;
  try {
    const authHeader = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    // `expand[]=customer_details` returns 1CC shipping/billing address if present
    const res = await fetch(
      `https://api.razorpay.com/v1/orders/${orderId}?expand[]=customer_details`,
      { headers: { Authorization: authHeader } }
    );
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.warn('fetchOrderDetails error:', err?.message || err);
    return null;
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const reqKey = event.headers['x-internal-key'] || '';
  if (NETLIFY_INTERNAL_KEY && reqKey !== NETLIFY_INTERNAL_KEY) {
    return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!KEY_SECRET) {
    console.error('RAZORPAY_KEY_SECRET is not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };
  }

  let razorpay_order_id, razorpay_payment_id, razorpay_signature;
  try {
    ({ razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature.' }),
    };
  }

  try {
    // Razorpay signature = HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const body       = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generated  = createHmac('sha256', KEY_SECRET).update(body).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const generatedBuf = Buffer.from(generated,          'hex');
    const receivedBuf  = Buffer.from(razorpay_signature, 'hex');

    const isValid =
      generatedBuf.length === receivedBuf.length &&
      timingSafeEqual(generatedBuf, receivedBuf);

    if (!isValid) {
      console.warn('Razorpay signature mismatch:', { razorpay_order_id, razorpay_payment_id });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Payment signature verification failed.' }),
      };
    }

    // Fetch order + payment in parallel so the client gets the 1CC address + contact
    const [order, payment] = await Promise.all([
      fetchOrderDetails(razorpay_order_id),
      fetchPaymentDetails(razorpay_payment_id),
    ]);

    const customer = order?.customer_details || {};
    const shipping = customer.shipping_address || {};
    const billing  = customer.billing_address  || {};

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        amount:  order?.amount ?? null,
        currency: order?.currency ?? 'INR',
        customer: {
          name:    customer.name    || payment?.notes?.name    || '',
          email:   customer.email   || payment?.email   || '',
          contact: customer.contact || payment?.contact || '',
        },
        shipping_address: {
          line1:   shipping.line1   || '',
          line2:   shipping.line2   || '',
          city:    shipping.city    || '',
          state:   shipping.state   || '',
          country: shipping.country || '',
          zipcode: shipping.zipcode || '',
        },
        billing_address: {
          line1:   billing.line1   || '',
          line2:   billing.line2   || '',
          city:    billing.city    || '',
          state:   billing.state   || '',
          country: billing.country || '',
          zipcode: billing.zipcode || '',
        },
      }),
    };
  } catch (err) {
    console.error('Signature verification error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error during verification.' }),
    };
  }
}
