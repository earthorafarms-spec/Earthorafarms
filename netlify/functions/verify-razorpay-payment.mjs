// netlify/functions/verify-razorpay-payment.mjs
// Server-side function — verifies the Razorpay payment signature after checkout.
// Uses Node.js built-in `crypto` — no extra npm packages needed.
// KEY_SECRET is NEVER exposed to the frontend.

import { createHmac, timingSafeEqual } from 'crypto';

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
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

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
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
