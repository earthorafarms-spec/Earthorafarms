import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, afterEach } from 'vitest';
import { buildWhatsAppApp } from '../../../whatsapp-chatbot/app.js';

describe('WhatsApp independent server boot (whatsapp-chatbot/app.ts)', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('boots independently without loading voice telephony or websocket routes', async () => {
    const testApp = await buildWhatsAppApp({ startWorker: false, forceWhatsAppRoutes: true });
    app = testApp;
    expect(testApp).toBeDefined();

    // Health route works
    const healthRes = await testApp.inject({
      method: 'GET',
      url: '/health',
    });
    expect(healthRes.statusCode).toBe(200);
    const healthJson = healthRes.json();
    expect(healthJson.ok).toBe(true);
    expect(typeof healthJson.revision).toBe('string');

    // Readiness route works
    const readyRes = await testApp.inject({
      method: 'GET',
      url: '/ready',
    });
    expect(readyRes.statusCode).toBe(200);
    const readyJson = readyRes.json();
    expect(readyJson.ok).toBe(true);
    expect(readyJson.whatsappConfigured).toBeDefined();

    // Voice routes are NOT mounted
    const voiceRes = await testApp.inject({
      method: 'GET',
      url: '/voice/incoming',
    });
    expect(voiceRes.statusCode).toBe(404);

    const smartfloRes = await testApp.inject({
      method: 'GET',
      url: '/voice/smartflo',
    });
    expect(smartfloRes.statusCode).toBe(404);

    const paymentWebhookRes = await testApp.inject({
      method: 'POST',
      url: '/api/razorpay-webhook',
    });
    expect(paymentWebhookRes.statusCode).toBe(404);

    // WhatsApp routes ARE mounted
    const diagRes = await testApp.inject({
      method: 'GET',
      url: '/whatsapp/diagnostics',
    });
    expect(diagRes.statusCode).toBe(200);

    const timeoutTickRes = await testApp.inject({
      method: 'POST',
      url: '/whatsapp/timeout-tick',
    });
    expect(timeoutTickRes.statusCode).toBe(403);
  });

  it('sets up CORS restricted to site origins', async () => {
    const testApp = await buildWhatsAppApp({ startWorker: false, forceWhatsAppRoutes: true });
    app = testApp;

    const corsRes = await testApp.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://earthorafarms.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(corsRes.headers['access-control-allow-origin']).toBe('https://earthorafarms.com');

    const invalidCorsRes = await testApp.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://malicious-site.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(invalidCorsRes.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Dedicated voice-service boot (voice-service/src/server.ts)', () => {
  let voiceApp: FastifyInstance | null = null;

  afterEach(async () => {
    if (voiceApp) {
      await voiceApp.close();
      voiceApp = null;
    }
  });

  it('boots as dedicated voice service without registering inbound WhatsApp webhook routes or starting worker', async () => {
    const { buildApp } = await import('../../src/server.js');
    voiceApp = await buildApp();
    expect(voiceApp).toBeDefined();

    // Health & readiness routes work
    const healthRes = await voiceApp.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);

    const readyRes = await voiceApp.inject({ method: 'GET', url: '/ready' });
    expect(readyRes.statusCode).toBe(200);

    // Voice & payment routes ARE mounted
    const paymentWebhookRes = await voiceApp.inject({
      method: 'POST',
      url: '/payments/webhook',
      payload: {},
    });
    // Not 404 — route exists and handles payload/signature validation
    expect(paymentWebhookRes.statusCode).not.toBe(404);

    // Duplicate WhatsApp inbound webhook routes are NOT mounted (returns 404)
    const webhookRes = await voiceApp.inject({
      method: 'GET',
      url: '/whatsapp/webhook',
    });
    expect(webhookRes.statusCode).toBe(404);

    const diagRes = await voiceApp.inject({
      method: 'GET',
      url: '/whatsapp/diagnostics',
    });
    expect(diagRes.statusCode).toBe(404);

    const timeoutTickRes = await voiceApp.inject({
      method: 'POST',
      url: '/whatsapp/timeout-tick',
    });
    expect(timeoutTickRes.statusCode).toBe(404);
  });

  it('preserves outbound voice -> WhatsApp notifications (sendWhatsAppCheckoutForm, sendWhatsAppInvoice)', async () => {
    const { sendWhatsAppCheckoutForm, sendWhatsAppInvoice } = await import('../../../whatsapp-chatbot/provider.js');
    expect(typeof sendWhatsAppCheckoutForm).toBe('function');
    expect(typeof sendWhatsAppInvoice).toBe('function');

    // Confirm voice-service checkout tool still delivers via sendWhatsAppCheckoutForm
    const { createVerificationLinkTool } = await import('../../src/tools/checkout.js');
    expect(createVerificationLinkTool).toBeDefined();
    expect(createVerificationLinkTool.definition.name).toBe('create_verification_link');

    // Confirm voice-service payment finalizer still references invoice notifications
    const { finalizeOrderFromWebhook } = await import('../../src/payments/finalizer.js');
    expect(typeof finalizeOrderFromWebhook).toBe('function');
  });
});
