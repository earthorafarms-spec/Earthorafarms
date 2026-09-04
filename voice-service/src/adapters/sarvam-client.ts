import { SarvamAIClient } from 'sarvamai';
import { config } from '../config.js';
import { parseSarvamKeys, SarvamKeyPool } from './sarvam-key-pool.js';

let pool: SarvamKeyPool | undefined;
const clients = new Map<string, SarvamAIClient>();

function getPool(): SarvamKeyPool {
  return pool ??= new SarvamKeyPool(
    parseSarvamKeys(config.SARVAM_API_KEYS, config.SARVAM_API_KEY),
    config.SARVAM_KEY_COOLDOWN_MS,
  );
}

export function requireSarvamKeys(): void {
  getPool();
}

export function withSarvamClient<T>(
  request: (client: SarvamAIClient, options: { timeoutInSeconds: number; maxRetries: number }) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return getPool().run((key, remainingMs) => {
    let client = clients.get(key);
    if (!client) {
      client = new SarvamAIClient({ apiSubscriptionKey: key });
      clients.set(key, client);
    }
    // SDK retries must not multiply the voice-turn timeout or retry an empty wallet.
    return request(client, { timeoutInSeconds: remainingMs / 1_000, maxRetries: 0 });
  }, timeoutMs);
}
