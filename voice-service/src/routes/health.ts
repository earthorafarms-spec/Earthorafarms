import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — process is up. No dependency checks, matches the "process
  // only" recommendation so Render's health check can't be taken down by a
  // transient Supabase/OpenAI blip.
  app.get('/health', async () => ({ ok: true }));

  // Readiness — required config is present. Never exposes secret values.
  app.get('/ready', async () => ({
    ok: true,
    googleSttTtsConfigured: config.googleSttTtsConfigured,
  }));
}
