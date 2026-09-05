// MUST be the first import so local development loads voice-service/.env.
import 'dotenv/config';

import { buildApp } from './server.js';
import { config } from './config.js';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  console.error('voice-service failed to start:', (error as Error).message);
  process.exit(1);
});
