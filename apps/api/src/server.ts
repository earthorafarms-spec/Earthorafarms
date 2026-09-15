import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { resolve } from 'node:path';
import { config, isProd } from './config.js';
import { sql } from './db/client.js';
import { HttpError } from './lib/errors.js';
import { authPlugin, cookieSecret } from './modules/auth/plugin.js';
import { authRoutes } from './modules/auth/routes.js';
import { storeRoutes } from './modules/store/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { platformRoutes } from './platform/routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }) },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: isProd,
  });

  const origins = [config.PUBLIC_STORE_URL, config.PUBLIC_CONSOLE_URL, ...config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || origins.includes(origin) || !isProd), credentials: true });
  await app.register(cookie, { secret: cookieSecret });
  await app.register(sensible);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/media/') });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(fastifyStatic, { root: resolve(config.ASSETS_DIR), prefix: '/media/', decorateReply: false, cacheControl: true, maxAge: '7d', index: false });
  await app.register(authPlugin);

  // Raw body for webhooks (Razorpay/Meta signatures are computed over the exact bytes).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body;
    if (!body || (typeof body === 'string' && body.length === 0)) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch (e) { const err = e as Error & { statusCode?: number }; err.statusCode = 400; done(err, undefined); }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, code: err.code, details: err.details });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({ error: status >= 500 ? 'Something went wrong' : (err as Error).message, code: (err as { code?: string }).code ?? 'error' });
  });

  app.get('/healthz', async () => ({ ok: true, role: config.ROLE, time: new Date().toISOString() }));
  app.get('/readyz', async () => { await sql`SELECT 1`; return { ok: true }; });

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(storeRoutes);
    await api.register(adminRoutes);
    await api.register(platformRoutes);
  }, { prefix: '/api' });

  return app;
}
