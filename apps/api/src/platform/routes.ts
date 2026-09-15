import type { FastifyInstance } from 'fastify';

/** AI platform routes (Knowledgebase, Workflows, Functions, Channels, Conversations). Filled in by the platform modules. */
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get('/platform/health', async () => ({ ok: true }));
}
