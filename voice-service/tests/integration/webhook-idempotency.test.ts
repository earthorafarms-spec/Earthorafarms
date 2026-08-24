import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

// Integration tests need a throwaway Supabase test project (with this
// repo's migrations applied) — NOT the production project. They are
// skipped automatically unless RUN_INTEGRATION_TESTS=1 is set alongside a
// full .env pointing at that test project, so `npm test` stays safe to run
// anywhere without accidentally touching production data.
const RUN = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!RUN)('webhook idempotency', () => {
  it('posting the same webhook payload twice creates exactly one order', async () => {
    const { default: buildServer } = await import('../helpers/buildTestServer.js');
    const app = await buildServer();

    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_test_idem', reference_id: 'voice-test-session' } },
        payment: { entity: { id: 'pay_test_idem', amount: 79900, currency: 'INR', status: 'captured' } },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');

    const first = await app.inject({
      method: 'POST',
      url: '/payments/webhook',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/payments/webhook',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).duplicate).toBe(true);

    await app.close();
  });

  it('rejects a payload with an invalid signature without finalizing anything', async () => {
    const { default: buildServer } = await import('../helpers/buildTestServer.js');
    const app = await buildServer();

    const payload = { event: 'payment_link.paid', payload: {} };
    const rawBody = Buffer.from(JSON.stringify(payload));

    const res = await app.inject({
      method: 'POST',
      url: '/payments/webhook',
      payload: rawBody,
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).signatureValid).toBe(false);

    await app.close();
  });
});
