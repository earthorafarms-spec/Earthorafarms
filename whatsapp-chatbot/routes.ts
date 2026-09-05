import type { FastifyInstance, FastifyRequest } from '../voice-service/src/host-types.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../voice-service/src/config.js';
import { extractWhatsAppInboundMessages } from './inbound.js';
import { enqueueWhatsAppMessage } from './events.repository.js';
import { wakeWhatsAppWorker } from './worker.js';

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWebhook(rawBody: Buffer, req: FastifyRequest): boolean {
  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    const supplied = req.headers['x-webhook-secret'] ?? req.headers['x-tata-webhook-secret'];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    return Boolean(value && config.TATA_OMNI_WEBHOOK_SECRET && constantTimeEqual(value, config.TATA_OMNI_WEBHOOK_SECRET));
  }

  const signature = req.headers['x-hub-signature-256'];
  const value = Array.isArray(signature) ? signature[0] : signature;
  if (!value?.startsWith('sha256=') || !config.WHATSAPP_APP_SECRET) return false;
  const expected = `sha256=${createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  return constantTimeEqual(expected, value);
}

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string> }>('/whatsapp/webhook', async (req, reply) => {
    const q = req.query;
    if (config.WHATSAPP_PROVIDER === 'meta' &&
        q['hub.mode'] === 'subscribe' &&
        q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(q['hub.challenge']);
    }
    return reply.status(403).send('Forbidden');
  });

  // Preserve exact bytes for Meta HMAC validation without changing JSON
  // parsing on the service's unrelated routes.
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body: Buffer, done) => done(null, body),
    );

    // Provider callbacks share a small number of source IPs, so the global
    // per-IP limiter would reject legitimate bursts across many customers.
    // Authentication plus the durable inbox's message-id uniqueness protect
    // this endpoint; conversation work happens asynchronously in the worker.
    scoped.post('/whatsapp/webhook', { config: { rateLimit: false } }, async (req, reply) => {
      const rawBody = req.body as Buffer;
      if (!rawBody?.length || !verifyWebhook(rawBody, req)) {
        app.log.warn('WhatsApp webhook rejected');
        return reply.status(403).send('Forbidden');
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: 'invalid_json' });
      }

      const messages = extractWhatsAppInboundMessages(body);
      try {
        let queued = 0;
        for (const message of messages) {
          if (await enqueueWhatsAppMessage(message)) queued++;
        }
        if (queued > 0) wakeWhatsAppWorker();
        return reply.status(200).send({ ok: true, queued });
      } catch (err) {
        // Ask the provider to retry instead of losing a message before it is
        // safely in the inbox.
        app.log.error(err, 'WhatsApp webhook enqueue failed');
        return reply.status(503).send({ error: 'inbox_unavailable' });
      }
    });
  });
}
