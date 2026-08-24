import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { getOrCreateSession, updateSessionState } from '../repositories/whatsappSessions.repository.js';
import { processTurn } from '../conversation/controller.js';
import { sendWhatsAppMessage } from '../adapters/meta-cloud.js';

// Verifies the X-Hub-Signature-256 header Meta sends with every webhook POST.
// Returns true when the signature matches or when no app secret is configured
// (dev mode — allows local testing without a real Meta app).
function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!config.WHATSAPP_APP_SECRET) return true; // dev mode
  if (!signature?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  const actual = signature.slice('sha256='.length);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  // ── Webhook verification (one-time Meta setup handshake) ──────────────────
  app.get<{ Querystring: Record<string, string> }>('/whatsapp/webhook', async (req, reply) => {
    const q = req.query;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
      return reply.status(200).send(q['hub.challenge']);
    }
    return reply.status(403).send('Forbidden');
  });

  // ── Incoming messages ──────────────────────────────────────────────────────
  // Meta requires a 200 response within ~20 s or it retries. We reply 200
  // immediately and handle the message asynchronously after the reply is sent.
  app.post('/whatsapp/webhook', {
    config: { rawBody: true }, // needed for HMAC verification
  }, async (req, reply) => {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
    const sig = req.headers['x-hub-signature-256'] as string | undefined;

    if (!verifySignature(rawBody, sig)) {
      app.log.warn('WhatsApp webhook: invalid signature');
      return reply.status(403).send('Forbidden');
    }

    // Acknowledge immediately — Meta expects 200 before we do any heavy work.
    reply.status(200).send('OK');

    // Process in the background (unhandled promise is fine here — errors are
    // logged and do not affect the 200 already sent).
    void handleIncoming(req.body, app).catch((err) => {
      app.log.error(err, 'WhatsApp webhook processing error');
    });
  });
}

async function handleIncoming(body: unknown, app: FastifyInstance): Promise<void> {
  // Meta webhook payload shape:
  // { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [...] } }] }] }
  const entry = (body as any)?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  // Skip status updates and delivery receipts — we only care about messages.
  if (!value?.messages?.length) return;

  const message = value.messages[0];
  if (message.type !== 'text') {
    // Non-text messages (image, audio, etc.) — send a polite fallback.
    const from: string = message.from;
    const phone = from.startsWith('+') ? from : `+${from}`;
    await sendWhatsAppMessage(phone, "I can only handle text messages right now. Please type your question or order details.");
    return;
  }

  const from: string = message.from; // E.164 without +, e.g. "919876543210"
  const phone = from.startsWith('+') ? from : `+${from}`;
  const text: string = message.text.body;

  app.log.info({ phone, text: text.slice(0, 80) }, 'WhatsApp message received');

  const { voiceSessionId, state } = await getOrCreateSession(phone);

  // Phone is already known from WhatsApp — pre-fill it so the agent skips asking.
  if (!state.checkoutFields.phone) {
    state.checkoutFields.phone = phone;
  }

  const { state: newState, replyText } = await processTurn(voiceSessionId, state, text, 'text');

  await updateSessionState(voiceSessionId, newState);
  await sendWhatsAppMessage(phone, replyText);

  app.log.info({ phone, replyLen: replyText.length }, 'WhatsApp reply sent');
}
