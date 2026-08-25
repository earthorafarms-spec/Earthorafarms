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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerVoiceStreamRoutes } from './routes/voice-stream.js';
import { registerSmartfloStreamRoutes } from './routes/smartflo-stream.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerPaymentWebhookRoutes } from './routes/payment-webhook.js';
import { registerWhatsAppRoutes } from './routes/whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds (but does not start listening) the Fastify app. Exported
 * separately from main() so integration tests can `app.inject(...)`
 * against a real app instance without binding a port.
 */
export async function buildApp() {
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

  // Payment webhook route is registered FIRST, in its own encapsulated
  // context with a raw-body parser — must not be affected by any global
  // JSON parsing configuration registered after it.
  await registerPaymentWebhookRoutes(app);

  await app.register(websocket);

  await registerHealthRoutes(app);
  await registerVoiceRoutes(app);
  await registerVoiceStreamRoutes(app);
  await registerSmartfloStreamRoutes(app);
  await registerCheckoutRoutes(app);

  if (config.whatsappConfigured) {
    await registerWhatsAppRoutes(app);
  }

  // Dev-only text-mode harness (see voice-service/README.md) — not a
  // customer-facing surface, never linked from the main site.
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  return app;
}

async function main() {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

// Only auto-start when this file is run directly (node dist/server.js /
// tsx src/server.ts) — not when imported by tests via buildApp().
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('voice-service failed to start:', err);
    process.exit(1);
  });
}
