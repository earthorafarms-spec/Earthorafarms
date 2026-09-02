// netlify/functions/create-razorpay-order.mjs
// Server-side function — fetches product prices from Supabase, validates the
// coupon, computes the authoritative total, then creates a Razorpay order.
// The client-supplied amount is NEVER trusted.

const KEY_ID               = process.env.RAZORPAY_KEY_ID           ?? '';
const KEY_SECRET           = process.env.RAZORPAY_KEY_SECRET        ?? '';
const NETLIFY_INTERNAL_KEY = process.env.NETLIFY_INTERNAL_KEY       ?? '';
const SUPABASE_URL         = process.env.VITE_SUPABASE_URL          ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY  ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Key',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase REST error: ${res.status}`);
  return res.json();
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

  if (!KEY_ID || !KEY_SECRET) {
    console.error('Razorpay credentials are not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Supabase credentials are not configured.');
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Database not configured.' }) };
  }

  let cartItems, couponCode, currency, receipt;
  try {
    ({ cartItems, couponCode, currency = 'INR', receipt } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Cart is empty.' }) };
  }

  try {
    // 1. Fetch product prices from DB — never trust client-supplied prices
    const productIds = [...new Set(cartItems.map(i => String(i.productId || '')).filter(Boolean))];
    if (productIds.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No valid product IDs.' }) };
    }

    const idList = productIds.map(id => `"${id.replace(/"/g, '')}"`).join(',');
    const products = await sbGet(
      `products?or=(id.in.(${idList}),slug.in.(${idList}))&status=neq.archived&select=id,slug,price`
    );

    if (!products || products.length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'No active products found in cart.' }) };
    }

    // 2. Fetch active festive deals
    const now = new Date().toISOString();
    const deals = await sbGet(
      `festival_details?festival_status=eq.active&festival_start_date=lte.${now}&festival_end_date=gte.${now}&select=discount_type,discount_value,festival_deal_products(product_id)`
    ).catch(() => []);

    // 3. Compute server-side subtotal
    const productMap = new Map();
    for (const p of products) {
      productMap.set(p.id,   p);
      productMap.set(p.slug, p);
    }

    let subtotalPaise = 0;
    for (const item of cartItems) {
      const pid = String(item.productId || '');
      const prod = productMap.get(pid);
      if (!prod) continue;

      let unitPrice = Number(prod.price);

      // Apply festive deal if this product is included
      for (const deal of (deals || [])) {
        const inDeal = (deal.festival_deal_products || []).some(
          dp => dp.product_id === prod.id || dp.product_id === prod.slug
        );
        if (inDeal) {
          const val = Number(deal.discount_value);
          unitPrice = deal.discount_type === 'percentage'
            ? Math.round(unitPrice - (unitPrice * val) / 100)
            : Math.max(0, Math.round(unitPrice - val));
          break;
        }
      }

      const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
      subtotalPaise += Math.round(unitPrice * 100) * qty;
    }

    if (subtotalPaise < 100) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Order total is below the minimum amount.' }) };
    }

    // 4. Validate and apply coupon server-side
    let discountPaise = 0;
    if (couponCode && typeof couponCode === 'string') {
      const cleanCode = encodeURIComponent(couponCode.trim().toUpperCase());
      const coupons = await sbGet(
        `coupon_details?coupon_code=eq.${cleanCode}&coupon_status=eq.active&select=coupon_discount_type,coupon_discount_value,coupon_expiry_date,coupon_max_uses,coupon_used_count,coupon_min_order`
      ).catch(() => []);

      const coupon = coupons?.[0];
      if (coupon) {
        const subtotalRupees = subtotalPaise / 100;
        const expired = coupon.coupon_expiry_date
          ? (() => { const d = new Date(coupon.coupon_expiry_date); d.setHours(23, 59, 59, 999); return d < new Date(); })()
          : false;
        const maxed = coupon.coupon_max_uses !== null &&
          (coupon.coupon_used_count || 0) >= coupon.coupon_max_uses;
        const tooSmall = Number(coupon.coupon_min_order || 0) > subtotalRupees;

        if (!expired && !maxed && !tooSmall) {
          if (coupon.coupon_discount_type === 'percentage') {
            discountPaise = Math.round((subtotalPaise * Number(coupon.coupon_discount_value)) / 100);
          } else {
            discountPaise = Math.min(subtotalPaise, Math.round(Number(coupon.coupon_discount_value) * 100));
          }
        }
      }
    }

    const totalPaise = Math.max(100, subtotalPaise - discountPaise);

    // 5. Create Razorpay order for the server-computed total
    const authHeader = 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    const razorRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({
        amount:  totalPaise,
        currency,
        receipt: receipt || `rcpt_${Date.now()}`,
      }),
    });

    if (!razorRes.ok) {
      const errText = await razorRes.text().catch(() => '');
      console.error('Razorpay create-order error:', razorRes.status, errText);
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to create Razorpay order. Please try again.' }) };
    }

    const order = await razorRes.json();

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.id,
        amount:   order.amount,   // server-computed paise — use this for Razorpay modal
        currency: order.currency,
        key_id:   KEY_ID,
      }),
    };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error.' }) };
  }
}
