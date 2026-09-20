import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, HttpError, notFound, unauthorized, upstream } from '../../lib/errors.js';
import { getChannelByKey, publishedConfig, type ChannelRow } from './config.js';
import { appendMessage, loadConversation, saveState } from '../engine/conversation.js';
import { runTurn, type PersonaConfig } from '../engine/engine.js';
import { withVoiceScope } from '../providers/voiceScope.js';
import { VoiceTurnQueue } from './voiceTurns.js';

const id = z.string().min(1).max(180).regex(/^[a-zA-Z0-9:_-]+$/);
const language = z.enum(['auto', 'en', 'hi', 'gu']);
const browserSession = z.object({ channelKey: z.string().min(1).max(180), conversationId: id.nullish(), language: language.optional() });
const phoneSession = z.object({ channel: z.literal('phone'), provider_call_id: z.string().min(1).max(200), language: language.optional() });
const internalTurn = z.object({ session_id: id, turn_id: id, text: z.string().trim().min(1).max(2000), channel_key: z.string().min(1).max(180), channel: z.enum(['web', 'phone']), language: language.optional() });
const controlResponse = z.object({ token: z.string().min(1), url: z.string().url(), room_name: z.string().min(1) });

export function livekitConfigured(): boolean { return Boolean(config.VOICE_CONTROL_URL && config.EARTHORA_VOICE_INTERNAL_KEY); }

function requireInternal(req: FastifyRequest): void {
  const expected = config.EARTHORA_VOICE_INTERNAL_KEY;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const actualBytes = Buffer.from(token); const expectedBytes = Buffer.from(expected);
  if (!expected || !/^Bearer\s+/i.test(req.headers.authorization || '') || actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) throw unauthorized();
}

async function enabledChannel(key: string): Promise<ChannelRow> {
  const ch = await getChannelByKey(key);
  if (!ch || ch.type !== 'voice' || !ch.enabled) throw notFound('Voice channel unavailable');
  return ch;
}

async function startRoom(ch: ChannelRow, external: string, channel: 'web' | 'phone', lang: string) {
  if (!livekitConfigured()) throw new HttpError(503, 'Live voice is not configured', 'voice_unavailable');
  await loadConversation({ tenantId: ch.tenant_id, channelType: channel === 'phone' ? 'calls' : 'voice', externalId: external, channelId: ch.id });
  const cfg = publishedConfig(ch);
  const response = await fetch(`${config.VOICE_CONTROL_URL.replace(/\/$/, '')}/api/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      access_key: config.EARTHORA_VOICE_INTERNAL_KEY,
      user_id: external, agent_name: cfg.name || 'Eva', language: lang, gender: 'female',
      system_prompt: 'You are Earthora Farms’ voice assistant. Speak only replies validated by the Earthora conversation engine.',
      dom_mode: false, vision_mode: false, camera_mode: false, video_mode: false,
      metadata: { session_id: external, channel_key: ch.public_key, channel, language: lang },
    }),
  });
  if (!response.ok) throw upstream(`Live voice session could not start (${response.status})`);
  const result = controlResponse.safeParse(await response.json());
  if (!result.success) throw upstream('Live voice returned an invalid session');
  return { ...result.data, conversationId: external };
}

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  const queue = new VoiceTurnQueue();

  app.post('/platform/voice/livekit/session', async (req) => {
    const body = browserSession.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid voice session');
    const ch = await enabledChannel(body.data.channelKey);
    return startRoom(ch, body.data.conversationId || `voice_${randomToken(18)}`, 'web', body.data.language || 'auto');
  });

  app.post('/platform/voice/internal/session', { preHandler: async (req) => requireInternal(req) }, async (req) => {
    const body = phoneSession.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid phone voice session');
    const ch = await enabledChannel(config.VOICE_PHONE_CHANNEL_KEY);
    const external = `phone_${createHash('sha256').update(body.data.provider_call_id).digest('hex').slice(0, 40)}`;
    return startRoom(ch, external, 'phone', body.data.language || 'auto');
  });

  app.post('/platform/voice/internal/turn', { preHandler: async (req) => requireInternal(req) }, async (req) => {
    const body = internalTurn.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid voice turn');
    const data = body.data;
    const ch = await enabledChannel(data.channel_key);
    if (data.channel === 'phone' && data.channel_key !== config.VOICE_PHONE_CHANNEL_KEY) throw notFound('Phone voice channel unavailable');
    const sessionKey = `${ch.tenant_id}:${ch.id}:${data.channel}:${data.session_id}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([data.text, data.language])).digest('hex');
    return queue.run(sessionKey, data.turn_id, fingerprint, async () => {
      const channelType = data.channel === 'phone' ? 'calls' : 'voice';
      const conv = await loadConversation({ tenantId: ch.tenant_id, channelType, externalId: data.session_id, channelId: ch.id });
      if (data.language && data.language !== 'auto') conv.state.language = data.language;
      const cfg = publishedConfig(ch);
      const persona: PersonaConfig = { ...(cfg.persona || {}), name: cfg.name || 'Eva', channel: channelType, maxWords: 40 };
      const started = Date.now();
      await appendMessage(conv.id, 'user', data.text);
      const result = await withVoiceScope(ch.tenant_id, () => runTurn({
        tenantId: ch.tenant_id, conversationId: conv.id, channelType, message: data.text,
        state: conv.state, contact: conv.contact, history: conv.history, persona,
      }));
      // The bridge receives text only after grounding, tool handling, output
      // validation and durable conversation writes have all completed.
      await appendMessage(conv.id, 'assistant', result.reply, { toolCalls: result.toolCalls, latencyMs: Date.now() - started });
      await saveState(conv.id, result.state);
      return { text: result.reply, language: result.state.language, end_session: false, conversationId: data.session_id };
    });
  });
}
