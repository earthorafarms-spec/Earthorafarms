import type { FastifyInstance, FastifyRequest } from '../voice-service/src/host-types.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../voice-service/src/config.js';
import { extractWhatsAppInboundMessages } from './inbound.js';
import { enqueueWhatsAppMessage } from './events.repository.js';
import { wakeWhatsAppWorker } from './worker.js';

let lastWebhookDiagnostic: Record<string, unknown> | null = null;

function describePayloadShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (depth >= 6) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item: value.length > 0 ? describePayloadShape(value[0], depth + 1) : null,
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 50)
        .map(([key, child]) => [key, describePayloadShape(child, depth + 1)]),
    );
  }
  return typeof value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyWebhook(rawBody: Buffer, req: FastifyRequest): boolean {
  if (config.WHATSAPP_PROVIDER === 'tata_omni') {
    const suppliedHeader = req.headers['x-webhook-secret'] ?? req.headers['x-tata-webhook-secret'];
    const headerValue = Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader;
    const queryValue = (req.query as Record<string, unknown> | undefined)?.token;
    const pathValue = (req.params as Record<string, unknown> | undefined)?.token;
    // Omni's live configuration UI exposes callback URLs but not custom
    // headers. Some Omni callback relays also strip query strings, so an
    // unguessable path segment is the preferred provider-compatible fallback.
    // Request logging is disabled on this route below so the token never
    // appears in application logs.
    const value = headerValue
      ?? (typeof pathValue === 'string' ? pathValue : undefined)
      ?? (typeof queryValue === 'string' ? queryValue : undefined);
    return Boolean(value && config.TATA_OMNI_WEBHOOK_SECRET && constantTimeEqual(value, config.TATA_OMNI_WEBHOOK_SECRET));
  }

  const signature = req.headers['x-hub-signature-256'];
  const value = Array.isArray(signature) ? signature[0] : signature;
  if (!value?.startsWith('sha256=') || !config.WHATSAPP_APP_SECRET) return false;
  const expected = `sha256=${createHmac('sha256', config.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  return constantTimeEqual(expected, value);
}

function rejectedWebhookDiagnostics(rawBody: unknown, req: FastifyRequest): Record<string, unknown> {
  const suppliedHeader = req.headers['x-webhook-secret'] ?? req.headers['x-tata-webhook-secret'];
  const headerValue = Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader;
  const queryValue = (req.query as Record<string, unknown> | undefined)?.token;
  const pathValue = (req.params as Record<string, unknown> | undefined)?.token;
  const expected = config.TATA_OMNI_WEBHOOK_SECRET;
  const matches = (value: unknown) => typeof value === 'string'
    && Boolean(expected)
    && constantTimeEqual(value, expected!);

  return {
    provider: config.WHATSAPP_PROVIDER,
    contentType: req.headers['content-type'],
    bodyType: Buffer.isBuffer(rawBody) ? 'buffer' : typeof rawBody,
    bodyLength: Buffer.isBuffer(rawBody) || typeof rawBody === 'string' ? rawBody.length : null,
    hasHeaderToken: typeof headerValue === 'string',
    hasQueryToken: typeof queryValue === 'string',
    hasPathToken: typeof pathValue === 'string',
    headerTokenMatches: matches(headerValue),
    queryTokenMatches: matches(queryValue),
    pathTokenMatches: matches(pathValue),
    secretConfigured: Boolean(expected),
  };
}

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  // Temporary-safe operational state: structural booleans only, with no URL,
  // token, message text, or customer identifier. This makes provider callback
  // mismatches diagnosable even when the hosting dashboard is unavailable.
  app.get('/whatsapp/diagnostics', async () => ({ lastWebhookDiagnostic }));

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
    scoped.post('/whatsapp/webhook/:token?', {
      config: { rateLimit: false },
      logLevel: 'silent',
    }, async (req, reply) => {
      const rawBody = req.body as Buffer;
      if (!rawBody?.length || !verifyWebhook(rawBody, req)) {
        // Log only structural booleans and sizes; never log callback URLs,
        // tokens, message contents, or customer identifiers.
        lastWebhookDiagnostic = {
          at: new Date().toISOString(),
          stage: 'rejected',
          ...rejectedWebhookDiagnostics(rawBody, req),
        };
        app.log.warn(lastWebhookDiagnostic, 'WhatsApp webhook rejected');
        return reply.status(403).send('Forbidden');
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: 'invalid_json' });
      }

      const messages = extractWhatsAppInboundMessages(body);
      lastWebhookDiagnostic = {
        at: new Date().toISOString(),
        stage: messages.length > 0 ? 'parsed' : 'parsed_unrecognized',
        extractedMessages: messages.length,
        ...(messages.length === 0 ? { payloadShape: describePayloadShape(body) } : {}),
      };
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
