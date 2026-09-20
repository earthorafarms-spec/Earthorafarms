import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.js', () => ({ config: { VOICE_CONTROL_URL: 'http://voice-control:8080', EARTHORA_VOICE_INTERNAL_KEY: 'test-private-voice-key', VOICE_PHONE_CHANNEL_KEY: 'pk_voice' } }));
vi.mock('./config.js', () => ({ getChannelByKey: vi.fn(), publishedConfig: (ch: any) => ch.published_config }));
vi.mock('../engine/conversation.js', () => ({ loadConversation: vi.fn(), appendMessage: vi.fn(), saveState: vi.fn() }));
vi.mock('../engine/engine.js', () => ({ runTurn: vi.fn() }));

import { livekitRoutes } from './livekit.js';
import { getChannelByKey } from './config.js';
import { appendMessage, loadConversation, saveState } from '../engine/conversation.js';
import { runTurn } from '../engine/engine.js';
import { inVoiceScope } from '../providers/voiceScope.js';

const channel = { id: 'ch_1', tenant_id: 'tenant_1', type: 'voice', enabled: true, public_key: 'pk_voice', published_config: { name: 'Eva' } };
const state = () => ({ slots: {}, cart: [], checkout: {}, language: 'en', summary: '' });
const result = () => ({ reply: 'Hello from Earthora.', state: state(), workflow: 'general', confidence: 1, toolCalls: [], sources: [], trace: {} });
const body = (extra = {}) => ({ session_id: 'voice_stable', turn_id: 'turn_1', text: 'Hello', language: 'en', channel: 'web', channel_key: 'pk_voice', ...extra });
const headers = { authorization: 'Bearer test-private-voice-key' };
const servers: ReturnType<typeof Fastify>[] = [];
async function server() { const app = Fastify(); await app.register(livekitRoutes); servers.push(app); return app; }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getChannelByKey).mockResolvedValue(channel as any);
  vi.mocked(loadConversation).mockImplementation(async () => ({ id: 'internal_uuid', state: state(), history: [], contact: {} }));
  vi.mocked(runTurn).mockImplementation(async () => { expect(inVoiceScope()).toBe(true); return result(); });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'room-token', url: 'wss://voice.example.test', room_name: 'earthora_room' }), { status: 200 })));
});
afterEach(async () => { await Promise.all(servers.splice(0).map((app) => app.close())); vi.unstubAllGlobals(); });

describe('Earthora LiveKit boundary', () => {
  it('starts only an enabled voice channel and preserves a stable public session id', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/livekit/session', payload: { channelKey: 'pk_voice', conversationId: 'voice_stable', language: 'auto' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token: 'room-token', conversationId: 'voice_stable' });
    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'voice_stable', tenantId: 'tenant_1', channelType: 'voice' }));
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.metadata).toEqual({ session_id: 'voice_stable', channel_key: 'pk_voice', channel: 'web', language: 'auto' });
    expect(request.access_key).toBe('test-private-voice-key');
    expect(res.body).not.toContain('test-private-voice-key');
  });

  it('rejects disabled and non-voice channels before contacting LiveKit', async () => {
    const app = await server();
    for (const ch of [{ ...channel, enabled: false }, { ...channel, type: 'chat' }]) {
      vi.mocked(getChannelByKey).mockResolvedValue(ch as any);
      expect((await app.inject({ method: 'POST', url: '/platform/voice/livekit/session', payload: { channelKey: 'pk_voice' } })).statusCode).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticates private session and turn routes before running work', async () => {
    const app = await server();
    for (const url of ['/platform/voice/internal/session', '/platform/voice/internal/turn']) {
      expect((await app.inject({ method: 'POST', url, payload: body() })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer wrong-key' }, payload: body() })).statusCode).toBe(401);
    }
    expect(getChannelByKey).not.toHaveBeenCalled();
    expect(runTurn).not.toHaveBeenCalled();
  });

  it('creates a phone room using the configured channel and a stable private call identity', async () => {
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/platform/voice/internal/session', headers, payload: { channel: 'phone', provider_call_id: 'provider-call-123', language: 'hi' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().conversationId).toMatch(/^phone_[a-f0-9]{40}$/);
    expect(loadConversation).toHaveBeenCalledWith(expect.objectContaining({ channelType: 'calls', externalId: res.json().conversationId }));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).metadata.channel).toBe('phone');
  });

  it('deduplicates concurrent bridge retries and persists only the validated response', async () => {
    const app = await server();
    let release!: () => void;
    vi.mocked(runTurn).mockImplementation(async () => { await new Promise<void>((resolve) => { release = resolve; }); return result(); });
    const request = { method: 'POST' as const, url: '/platform/voice/internal/turn', headers, payload: body() };
    const first = app.inject(request); const duplicate = app.inject(request);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    expect(appendMessage).toHaveBeenCalledTimes(1);
    release();
    const replies = await Promise.all([first, duplicate]);
    expect(replies.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(replies[0].json()).toEqual({ text: 'Hello from Earthora.', language: 'en', end_session: false, conversationId: 'voice_stable' });
    expect(appendMessage).toHaveBeenCalledTimes(2);
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(inVoiceScope()).toBe(false);
    expect((await app.inject({ ...request, payload: body({ text: 'Different utterance' }) })).statusCode).toBe(409);
  });

  it('never returns speech text when durable state saving fails', async () => {
    const app = await server();
    vi.mocked(saveState).mockRejectedValue(new Error('storage failure'));
    const request = { method: 'POST' as const, url: '/platform/voice/internal/turn', headers, payload: body() };
    expect((await app.inject(request)).statusCode).toBe(500);
    expect((await app.inject(request)).statusCode).toBe(500);
    expect(runTurn).toHaveBeenCalledTimes(1);
  });
});
