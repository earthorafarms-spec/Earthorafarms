import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { getStt, getTts } from '../providers/index.js';
import { getChannelByKey, publishedConfig } from './config.js';
import { loadConversation, appendMessage, saveState } from '../engine/conversation.js';
import { runTurn, type PersonaConfig } from '../engine/engine.js';
import { tenantId } from '../kb/ingest.js';

/**
 * Browser voicebot: the widget records a mic utterance and POSTs it here.
 * STT (Whisper) → engine → TTS (OpenAI) → returns transcript, reply text and reply audio.
 * The animated orb on the client is driven by these events. Google Chirp swaps in behind getStt/getTts.
 */
export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/platform/voice/:channelKey/config', async (req) => {
    const ch = await getChannelByKey((req.params as any).channelKey);
    if (!ch || ch.type !== 'voice') throw notFound('Voice channel not found');
    const cfg = publishedConfig(ch);
    return { name: cfg.name || 'Eva', greeting: cfg.greeting || 'Hi, how can I help?', voice: cfg.voice || 'shimmer', languages: ['en', 'hi', 'gu'] };
  });

  app.post('/platform/voice/:channelKey/session', async (req) => {
    const ch = await getChannelByKey((req.params as any).channelKey);
    if (!ch || ch.type !== 'voice') throw notFound('Voice channel not found');
    return { conversationId: `voice_${randomToken(12)}` };
  });

  app.post('/platform/voice/turn', async (req) => {
    const q = req.query as { channelKey?: string; conversationId?: string };
    if (!q.channelKey) throw badRequest('channelKey required');
    const ch = await getChannelByKey(q.channelKey);
    if (!ch || ch.type !== 'voice' || !ch.enabled) throw notFound('Voice channel unavailable');
    const cfg = publishedConfig(ch);
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!file) throw badRequest('No audio');
    const audio = await file.toBuffer();

    const stt = await getStt().transcribe(audio, { mime: file.mimetype || 'audio/webm' });
    const transcript = stt.text.trim();
    if (!transcript) return { transcript: '', reply: '', audioBase64: null };

    const tid = await tenantId();
    const external = q.conversationId || `voice_${randomToken(12)}`;
    const conv = await loadConversation({ tenantId: tid, channelType: 'voice', externalId: external, channelId: ch.id });
    const persona: PersonaConfig = { ...(cfg.persona || {}), name: cfg.name, channel: 'voice', maxWords: 45 };
    await appendMessage(conv.id, 'user', transcript);
    const result = await runTurn({ tenantId: tid, conversationId: conv.id, channelType: 'voice', message: transcript, state: conv.state, contact: conv.contact, history: conv.history, persona });
    await appendMessage(conv.id, 'assistant', result.reply, { toolCalls: result.toolCalls });
    await saveState(conv.id, result.state);

    const tts = await getTts().synthesize(result.reply, { language: result.state.language, voice: cfg.voice, format: 'mp3' });
    return { transcript, detectedLanguage: result.state.language, reply: result.reply, workflow: result.workflow, conversationId: conv.id, audioBase64: tts.audio.toString('base64'), audioMime: tts.mime };
  });
}
