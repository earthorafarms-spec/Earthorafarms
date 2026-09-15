import type { FastifyInstance } from 'fastify';
import { providerStatus } from './providers/index.js';
import { platformAdminRoutes } from './admin.js';
import { chatChannelRoutes } from './channels/chat.js';
import { whatsappRoutes } from './channels/whatsapp.js';
import { voiceRoutes } from './channels/voice.js';

/** All AI-platform HTTP + WS routes (mounted under /api). */
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get('/platform/health', async () => ({ ok: true, providers: providerStatus() }));
  await app.register(platformAdminRoutes);
  await app.register(chatChannelRoutes);
  await app.register(whatsappRoutes);
  await app.register(voiceRoutes);
}
