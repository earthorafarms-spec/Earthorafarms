import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { pcm16ToMulawByte } from '../../src/telephony/mulaw.js';

const mocks = vi.hoisted(() => ({
  stt: vi.fn(),
  ttsMulaw: vi.fn(),
  processMessage: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  getByProviderCallId: vi.fn(),
  updateState: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('../../src/providers.js', () => ({
  buildStt: () => ({ transcribe: mocks.stt }),
  buildTtsForLanguage: () => ({
    synthesize: vi.fn(),
    synthesizeMulaw8k: mocks.ttsMulaw,
  }),
}));

vi.mock('../../src/adapters/browser.js', () => ({
  processBrowserMessage: mocks.processMessage,
}));

vi.mock('../../src/repositories/callSessions.repository.js', () => ({
  createCallSession: mocks.createSession,
  getCallSession: mocks.getSession,
  getCallSessionByProviderCallId: mocks.getByProviderCallId,
  updateCallSessionState: mocks.updateState,
  updateCallSessionStatus: mocks.updateStatus,
}));

import { registerSmartfloStreamRoutes } from '../../src/routes/smartflo-stream.js';

interface Collector {
  messages: Record<string, any>[];
  waitFor(predicate: (messages: Record<string, any>[]) => boolean): Promise<void>;
}

function collect(ws: WebSocket): Collector {
  const messages: Record<string, any>[] = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  return {
    messages,
    async waitFor(predicate) {
      const deadline = Date.now() + 2_000;
      while (!predicate(messages)) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for messages: ${JSON.stringify(messages)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

function mulawFrame(amplitude: number): Buffer {
  const frame = Buffer.alloc(800);
  for (let i = 0; i < frame.length; i++) frame[i] = pcm16ToMulawByte(i % 2 === 0 ? amplitude : -amplitude);
  return frame;
}

function sendStart(ws: WebSocket): void {
  ws.send(JSON.stringify({ event: 'connected' }));
  ws.send(JSON.stringify({
    event: 'start',
    streamSid: 'stream-test',
    start: {
      streamSid: 'stream-test',
      callSid: 'call-test',
      direction: 'inbound',
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
    },
  }));
}

function sendUtterance(ws: WebSocket): void {
  for (let i = 0; i < 3; i++) {
    ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
  }
  for (let i = 0; i < 7; i++) {
    ws.send(JSON.stringify({ event: 'media', media: { payload: Buffer.alloc(800, 0xff).toString('base64') } }));
  }
}

describe('Smartflo WebSocket local integration', () => {
  let app: ReturnType<typeof Fastify>;
  let client: WebSocket | null;
  let session: ReturnType<typeof createInitialState>;

  beforeEach(async () => {
    vi.clearAllMocks();
    session = createInitialState();
    mocks.ttsMulaw.mockResolvedValue(Buffer.alloc(320, 0xff));
    mocks.createSession.mockResolvedValue({
      id: 'session-test', provider: 'tata_smartflo', providerCallId: 'call-test', status: 'started',
      conversationState: session, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      startedAt: new Date().toISOString(), endedAt: null,
    });
    mocks.getSession.mockImplementation(() => Promise.resolve({
      id: 'session-test', provider: 'tata_smartflo', providerCallId: 'call-test', status: 'started',
      conversationState: session, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      startedAt: new Date().toISOString(), endedAt: null,
    }));
    mocks.getByProviderCallId.mockResolvedValue(null);
    mocks.updateState.mockResolvedValue(undefined);
    mocks.updateStatus.mockResolvedValue(undefined);
    mocks.processMessage.mockResolvedValue({
      replyText: 'Here is the grounded answer.', language: 'en', callShouldEnd: false, policyViolations: [],
    });

    app = Fastify({ logger: false });
    await app.register(websocket);
    await registerSmartfloStreamRoutes(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    client = null;
  });

  afterEach(async () => {
    if (client && client.readyState < WebSocket.CLOSING) client.close();
    await app.close();
  });

  async function connect(): Promise<{ ws: WebSocket; collector: Collector }> {
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/voice/smartflo`);
    client = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return { ws, collector: collect(ws) };
  }

  it('returns the exact dynamic resolver contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/voice/stream/endpoint' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, wss_url: expect.stringContaining('/ws/voice/smartflo') });

    const formPost = await app.inject({
      method: 'POST',
      url: '/voice/stream/endpoint',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(formPost.statusCode).toBe(200);
    expect(formPost.json()).toEqual({ success: true, wss_url: expect.stringContaining('/ws/voice/smartflo') });
  });

  it('persists callSid, emits aligned media, and closes the session lifecycle', async () => {
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark'));

    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.anything(), 'tata_smartflo', { providerCallId: 'call-test', locale: 'en-IN' }
    );
    const media = collector.messages.find((m) => m.event === 'media');
    expect(Buffer.from(media!.media.payload, 'base64').length % 160).toBe(0);
    expect(media!.media.chunk).toBe(1);

    ws.send(JSON.stringify({ event: 'stop', stop: { reason: 'caller disconnected' } }));
    await collector.waitFor(() => mocks.updateStatus.mock.calls.some((call) => call[1] === 'ended'));
  });

  it('never sends an unsupported-language transcript to the LLM', async () => {
    mocks.stt.mockResolvedValue({ text: 'ಅಕ್ಕ ಇರ್ತಾ ಇರೋದು', detectedLanguageCode: 'kn-IN', languageProbability: 0.99 });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length >= 2);

    expect(mocks.processMessage).not.toHaveBeenCalled();
    expect(mocks.ttsMulaw).toHaveBeenCalledWith("Sorry, I didn't catch that clearly. Please repeat.", 'en');
  });

  it('normalizes a trusted transcript before invoking the LLM', async () => {
    mocks.stt.mockResolvedValue({ text: 'What is available at Athora Farms?', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    sendUtterance(ws);
    await collector.waitFor(() => mocks.processMessage.mock.calls.length === 1);

    expect(mocks.processMessage).toHaveBeenCalledWith('session-test', 'What is available at Earthora Farms?');
  });

  it('sends clear and stops queued playback when the caller barges in', async () => {
    mocks.ttsMulaw.mockResolvedValueOnce(Buffer.alloc(16_000, 0x7f));
    const { ws, collector } = await connect();
    let sentSpeech = false;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event === 'media' && !sentSpeech) {
        sentSpeech = true;
        ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
      }
    });
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'clear'));

    expect(collector.messages.some((m) => m.event === 'clear' && m.streamSid === 'stream-test')).toBe(true);
  });
});
