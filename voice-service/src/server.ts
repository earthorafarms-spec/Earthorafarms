// MUST be the first import — populates process.env from a local .env file
// before config.ts (imported transitively below) validates it. Render sets
// real env vars directly on the process, so this is a no-op there (dotenv
// silently does nothing when no .env file is present) — it exists purely
// for local development via `npm run dev` / `node dist/server.js`.
import 'dotenv/config';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { config } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerVoiceStreamRoutes } from './routes/voice-stream.js';
import { registerSmartfloStreamRoutes } from './routes/smartflo-stream.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerPaymentWebhookRoutes } from './routes/payment-webhook.js';
import { registerWhatsAppRoutes } from '../../whatsapp-chatbot/routes.js';
import { startWhatsAppWorker } from '../../whatsapp-chatbot/worker.js';

const publicDirectory = path.resolve(process.cwd(), 'public');

/**
 * Builds (but does not start listening) the Fastify app. Exported
 * separately from main() so integration tests can `app.inject(...)`
 * against a real app instance without binding a port.
 */
export interface BuildAppOptions {
  mode?: 'all' | 'whatsapp';
}

export async function buildApp(options: BuildAppOptions = {}) {
  const mode = options.mode ?? 'all';
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  // CORS restricted to the real site origin — deliberately NOT '*' like the
  // existing Netlify functions, since this API also handles PII (see
  // earthora-voice-agent-build-pack/03-DATA-AND-API.md section 2).
  await app.register(cors, {
    origin: [config.PUBLIC_APP_URL],
  });

  // Every route below handles PII or triggers external calls (email,
  // OpenAI, Razorpay) — a blanket rate limit is cheap insurance against
  // abuse per FR-10/P0 privacy-security requirements.
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
  });

  await registerHealthRoutes(app);

  if (mode === 'all') {
    // Payment webhook route is registered before any other body-parsing route
    // so Razorpay signatures are always checked against the exact bytes.
    await registerPaymentWebhookRoutes(app);
    await app.register(websocket);
    await registerVoiceRoutes(app);
    await registerVoiceStreamRoutes(app);
    await registerSmartfloStreamRoutes(app);
    await registerCheckoutRoutes(app);
  }

  if (config.whatsappConfigured) {
    await registerWhatsAppRoutes(app);
    startWhatsAppWorker(app);
  } else if (mode === 'whatsapp') {
    throw new Error('WhatsApp-only service cannot start: provider configuration is incomplete');
  }

  if (mode === 'all') {
    // Dev-only text-mode harness (see voice-service/README.md) — not a
    // customer-facing surface, never linked from the main site.
    await app.register(fastifyStatic, {
      root: publicDirectory,
      prefix: '/',
    });
  }

  return app;
}
