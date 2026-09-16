import { buildWhatsAppApp } from './app.js';
import { config } from '../voice-service/src/config.js';

async function main(): Promise<void> {
  const app = await buildWhatsAppApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  // Avoid printing provider payloads or configuration values.
  console.error('WhatsApp chatbot failed to start:', (error as Error).message);
  process.exit(1);
});
