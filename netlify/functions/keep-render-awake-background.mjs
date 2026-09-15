import { HEALTH_URL } from './keep-render-awake.mjs';

const ATTEMPT_TIMEOUT_MS = 80_000;
const RETRY_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The scheduled function starts this worker every five minutes. It is allowed
 * to survive a free Render cold start and confirms the service actually
 * answered instead of treating a timed-out wake request as a successful ping.
 */
export default async function keepRenderAwakeBackground() {
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(HEALTH_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'user-agent': 'earthora-netlify-heartbeat/2.0',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Render health check returned HTTP ${response.status}`);

      console.log(JSON.stringify({
        event: 'render_voice_heartbeat_ok',
        attempt,
        status: response.status,
        responseTimeMs: Date.now() - startedAt,
      }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Render heartbeat failed');
}

export const config = { background: true };
