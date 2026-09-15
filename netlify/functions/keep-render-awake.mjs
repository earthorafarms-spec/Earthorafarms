const HEALTH_URL = 'https://earthorafarms-mhwv.onrender.com/health?source=netlify-scheduled-function';
const BACKGROUND_FUNCTION_URL =
  'https://earthorafarms.com/.netlify/functions/keep-render-awake-background';

/**
 * Netlify Scheduled Function used as an external heartbeat for the voice
 * service. A failed invocation is deliberately surfaced in Netlify's function
 * logs rather than being reported as a successful ping.
 */
export default async function keepRenderAwake() {
  // A free Render instance can take roughly a minute to wake. Scheduled
  // Functions stop after 30 seconds, so they only enqueue the longer-running
  // background worker. That worker retries until the service is actually up.
  const response = await fetch(BACKGROUND_FUNCTION_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'user-agent': 'earthora-netlify-heartbeat-scheduler/1.0',
    },
  });
  if (!response.ok && response.status !== 202) {
    throw new Error(`Render heartbeat background worker returned HTTP ${response.status}`);
  }
  console.log(JSON.stringify({
    event: 'render_voice_heartbeat_enqueued',
    status: response.status,
  }));
}

export { HEALTH_URL };
