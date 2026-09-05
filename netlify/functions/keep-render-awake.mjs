const HEALTH_URL = 'https://earthorafarms-mhwv.onrender.com/health';
const TIMEOUT_MS = 25_000;

/**
 * Netlify Scheduled Function used as an external heartbeat for the voice
 * service. A failed invocation is deliberately surfaced in Netlify's function
 * logs rather than being reported as a successful ping.
 */
export default async function keepRenderAwake() {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(HEALTH_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'user-agent': 'earthora-netlify-heartbeat/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Render health check returned HTTP ${response.status}`);
    }

    console.log(JSON.stringify({
      event: 'render_voice_heartbeat_ok',
      status: response.status,
      responseTimeMs: Date.now() - startedAt,
    }));
  } finally {
    clearTimeout(timeout);
  }
}
