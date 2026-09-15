import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { sql } from '../../db/client.js';
import { safeEqual } from '../../lib/crypto.js';
import { loadConversation, appendMessage, saveState } from '../engine/conversation.js';
import { runTurn, type PersonaConfig } from '../engine/engine.js';
import { getChannel, publishedConfig } from './config.js';
import { tenantId } from '../kb/ingest.js';

/** Normalise inbound WhatsApp (Tata Omni or Meta) into a common shape. */
function normalizeInbound(body: any): { messageId: string; from: string; text: string; name?: string } | null {
  // Meta Cloud API shape
  const entry = body?.entry?.[0]?.changes?.[0]?.value;
  if (entry?.messages?.[0]) {
    const m = entry.messages[0];
    const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    return { messageId: m.id, from: m.from, text, name: entry.contacts?.[0]?.profile?.name };
  }
  // Tata Omni / generic shapes
  const msg = body?.messages?.[0] || body?.message || body?.data || body;
  const from = msg?.from || msg?.wa_id || body?.contacts?.[0]?.wa_id || msg?.sender || '';
  const text = msg?.text?.body || msg?.text || msg?.body || msg?.content?.text || '';
  const id = msg?.id || msg?.message_id || msg?.provider_message_id || `${from}-${Date.now()}`;
  if (from && text) return { messageId: String(id), from: String(from), text: String(text), name: msg?.profile?.name };
  return null;
}

async function sendWhatsApp(to: string, text: string): Promise<void> {
  if (config.WHATSAPP_PROVIDER === 'tata_omni' && config.TATA_OMNI_ACCESS_TOKEN) {
    await fetch(`${config.TATA_OMNI_API_BASE_URL}/whatsapp-cloud/messages`, {
      method: 'POST',
      headers: { Authorization: config.TATA_OMNI_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.startsWith('+') ? to : `+${to}`, type: 'text', source: 'external', text: { body: text.slice(0, 4000) } }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  } else if (config.WHATSAPP_PROVIDER === 'meta' && config.WHATSAPP_TOKEN) {
    await fetch(`https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace('+', ''), type: 'text', text: { body: text.slice(0, 4000) } }),
    }).catch(() => {});
  }
}

/** WhatsApp webhook: verify → durable inbox (dedupe) → engine → reply. */
export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get('/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as any;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) return reply.send(q['hub.challenge']);
    return reply.code(403).send('forbidden');
  });

  app.post('/webhooks/whatsapp/:token?', async (req, reply) => {
    // Tata Omni auth: shared secret via path/header/query. Meta: HMAC handled by app secret if provided.
    const token = (req.params as any).token || (req.headers['x-webhook-secret'] as string) || (req.query as any).token;
    if (config.TATA_OMNI_WEBHOOK_SECRET && !safeEqual(String(token ?? ''), config.TATA_OMNI_WEBHOOK_SECRET)) {
      return reply.code(200).send({ ok: true }); // acknowledge but ignore unauthenticated
    }
    const inbound = normalizeInbound(req.body);
    reply.code(200).send({ ok: true }); // always ack fast
    if (!inbound) return;
    const tid = await tenantId();
    try {
      const [evt] = await sql<any[]>`INSERT INTO inbound_events (tenant_id, channel_type, provider_message_id, external_conversation, payload, status)
        VALUES (${tid}, 'whatsapp', ${inbound.messageId}, ${inbound.from}, ${sql.json(req.body as any)}, 'processing')
        ON CONFLICT (channel_type, provider_message_id) DO NOTHING RETURNING id`;
      if (!evt) return; // duplicate delivery
      const ch = await getChannel(tid, 'whatsapp', 'earthora');
      const cfg = ch ? publishedConfig(ch) : {};
      const conv = await loadConversation({ tenantId: tid, channelType: 'whatsapp', externalId: inbound.from, channelId: ch?.id, contact: { phone: `+${inbound.from.replace('+', '')}`, name: inbound.name } });
      const persona: PersonaConfig = { ...(cfg.persona || {}), name: cfg.name || 'Eva', channel: 'whatsapp' };
      await appendMessage(conv.id, 'user', inbound.text);
      const result = await runTurn({ tenantId: tid, conversationId: conv.id, channelType: 'whatsapp', message: inbound.text, state: conv.state, contact: conv.contact, history: conv.history, persona });
      await appendMessage(conv.id, 'assistant', result.reply, { toolCalls: result.toolCalls });
      await saveState(conv.id, result.state);
      await sendWhatsApp(inbound.from, result.reply);
      await sql`UPDATE inbound_events SET status = 'processed', reply = ${sql.json({ text: result.reply } as any)}, updated_at = now() WHERE id = ${evt.id}`;
    } catch (err) {
      req.log.error({ err }, 'whatsapp turn failed');
      await sql`UPDATE inbound_events SET status = 'failed', last_error = ${(err as Error).message} WHERE channel_type = 'whatsapp' AND provider_message_id = ${inbound.messageId}`;
    }
  });

  // Manual send used by low-stock/tracking jobs and by staff testing.
  app.post('/platform/whatsapp/send', { preHandler: app.requireStaff('admin', 'developer') }, async (req) => {
    const b = req.body as { to: string; text: string };
    await sendWhatsApp(b.to, b.text);
    return { ok: true };
  });
}
