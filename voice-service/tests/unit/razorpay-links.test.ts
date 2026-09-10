import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaymentLink } from '../../src/payments/razorpay-links.js';

afterEach(() => vi.unstubAllGlobals());

describe('voice Razorpay redirect link', () => {
  it('does not ask Razorpay to send the payment link by SMS or email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'plink_test', short_url: 'https://rzp.io/i/test',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await createPaymentLink({
      amountPaise: 79900,
      currency: 'INR',
      referenceId: 'voice-test',
      customer: { name: 'Test User', email: 'test@example.com', contact: '+919876543210' },
      callbackUrl: 'https://earthorafarms.com/voice-checkout/token',
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.notify).toEqual({ sms: false, email: false });
    expect(request.reminder_enable).toBe(false);
    expect(request.callback_url).toContain('/voice-checkout/token');
  });
});
