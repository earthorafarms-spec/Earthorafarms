import { Fastify, cors, rateLimit, type FastifyInstance } from '../voice-service/src/host-types.js';
import { config } from '../voice-service/src/config.js';
import { registerWhatsAppRoutes, registerWhatsAppTrackingRoute } from './routes.js';
import { startWhatsAppWorker } from './worker.js';

export interface BuildWhatsAppAppOptions {
  startWorker?: boolean;
  forceWhatsAppRoutes?: boolean;
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — process is up. No dependency checks, matches the "process
  // only" recommendation so Render's health check cannot be taken down by a
  // transient Supabase/network blip.
  app.get('/health', async () => ({
    ok: true,
    revision: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
  }));

  // Readiness — required configuration is present. Never exposes secret values.
  app.get('/ready', async () => ({
    ok: true,
    whatsappConfigured: config.whatsappConfigured,
    provider: config.WHATSAPP_PROVIDER,
  }));
}

export async function buildWhatsAppApp(options: BuildWhatsAppAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  // CORS restricted to the real site origin
  const allowedSiteOrigins = [...new Set([
    config.PUBLIC_APP_URL.replace(/\/$/, ''),
    'https://earthorafarms.com',
    'https://www.earthorafarms.com',
    'https://earthorafarms.netlify.app',
  ])];

  await app.register(cors, {
    origin: allowedSiteOrigins,
  });

  // Rate limiting across general endpoints (webhook endpoints bypass rateLimit via route config)
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
  });

  await registerHealthRoutes(app);

  const whatsappOutboundConfigured = config.WHATSAPP_PROVIDER === 'tata_omni'
    ? Boolean(config.TATA_OMNI_ACCESS_TOKEN)
    : Boolean(config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_TOKEN);

  const shouldRegisterRoutes = options.forceWhatsAppRoutes === true || config.whatsappConfigured;

  if (shouldRegisterRoutes) {
    await registerWhatsAppRoutes(app);
    if (options.startWorker !== false && config.whatsappConfigured) {
      startWhatsAppWorker(app);
    }
  } else if (whatsappOutboundConfigured && config.WHATSAPP_INTERNAL_KEY) {
    await registerWhatsAppTrackingRoute(app);
  } else {
    throw new Error('WhatsApp-only service cannot start: provider configuration is incomplete');
  }

  return app;
}
