// netlify/functions/create-razorpay-order.mjs
// Server-side function — creates a Razorpay order via the REST API.
// KEY_SECRET never leaves this file and never reaches the browser.

const KEY_ID     = process.env.RAZORPAY_KEY_ID     ?? '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET  ?? '';

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

  if (!KEY_ID || !KEY_SECRET) {
    console.error('Razorpay credentials are not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };
  }

  let amount, currency, receipt;
  try {
    ({ amount, currency = 'INR', receipt } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  // Validate amount — must be at least 100 paise (₹1)
  if (typeof amount !== 'number' || amount < 100) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Amount must be at least 100 paise (₹1).' }) };
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');

    const razorRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        amount:   Math.round(amount), // must be integer paise
        currency,
        receipt:  receipt || `rcpt_${Date.now()}`,
      }),
    });

    if (!razorRes.ok) {
      const errText = await razorRes.text().catch(() => '');
      console.error('Razorpay create-order error:', razorRes.status, errText);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Failed to create Razorpay order. Please try again.' }),
      };
    }

    const order = await razorRes.json();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.id,
        amount:   order.amount,
        currency: order.currency,
        key_id:   KEY_ID, // safe to return — this is the public key
      }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error.' }),
    };
  }
}
