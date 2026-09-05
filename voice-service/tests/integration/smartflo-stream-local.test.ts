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

function acknowledgeLatestMark(ws: WebSocket, collector: Collector): void {
  const mark = [...collector.messages].reverse().find((message) => message.event === 'mark');
  if (!mark?.mark?.name) throw new Error('No mark available to acknowledge');
  ws.send(JSON.stringify({ event: 'mark', streamSid: 'stream-test', mark: { name: mark.mark.name } }));
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

  it('closes a socket that never sends the required Smartflo start event', async () => {
    vi.useFakeTimers();
    try {
      const { ws } = await connect();
      const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
      ws.send(JSON.stringify({ event: 'connected' }));
      await vi.advanceTimersByTimeAsync(15_001);
      vi.useRealTimers();

      await expect(closed).resolves.toBe(1008);
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it('ends the call after seven seconds of caller silence once playback finishes', async () => {
    const { ws, collector } = await connect();
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark'));

    vi.useFakeTimers();
    try {
      acknowledgeLatestMark(ws, collector);
      await vi.advanceTimersByTimeAsync(7_001);
      vi.useRealTimers();
      await expect(closed).resolves.toBe(1000);
      expect(mocks.updateStatus).toHaveBeenCalledWith('session-test', 'abandoned');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends only after the delivered-form confirmation finishes playing', async () => {
    mocks.stt.mockResolvedValue({ text: 'No GST number', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    mocks.processMessage.mockResolvedValue({
      replyText: 'I sent the editable form to your WhatsApp.',
      language: 'en',
      callShouldEnd: true,
      policyViolations: [],
    });
    const { ws, collector } = await connect();
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    acknowledgeLatestMark(ws, collector);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark' && m.mark?.name?.startsWith('reply-1-')));

    expect(ws.readyState).toBe(WebSocket.OPEN);
    acknowledgeLatestMark(ws, collector);
    await expect(closed).resolves.toBe(1000);
    expect(mocks.updateStatus).toHaveBeenCalledWith('session-test', 'ended');
  });

  it('never sends an unsupported-language transcript to the LLM', async () => {
    mocks.stt.mockResolvedValue({ text: 'ಅಕ್ಕ ಇರ್ತಾ ಇರೋದು', detectedLanguageCode: 'kn-IN', languageProbability: 0.99 });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length >= 2);

    expect(mocks.processMessage).not.toHaveBeenCalled();
    expect(mocks.ttsMulaw).toHaveBeenCalledWith("Sorry, I didn't catch that clearly. Please say it again.", 'en');
  });

  it.each(['yes', '2', 'Ahmedabad, Gujarat'])('passes a short listening-window answer (%s) through the phone pipeline', async (text) => {
    mocks.stt.mockResolvedValue({ text });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark'));
    acknowledgeLatestMark(ws, collector);
    ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
    for (let i = 0; i < 7; i++) {
      ws.send(JSON.stringify({ event: 'media', media: { payload: Buffer.alloc(800, 0xff).toString('base64') } }));
    }
    await collector.waitFor(() => mocks.processMessage.mock.calls.length === 1);
    expect(mocks.processMessage).toHaveBeenCalledWith('session-test', text);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('asks for a repeat in the established Hindi conversation language', async () => {
    session.currentLanguage = 'hi';
    mocks.stt.mockResolvedValue({ text: 'ಅಕ್ಕ ಇರ್ತಾ ಇರೋದು', detectedLanguageCode: 'kn-IN', languageProbability: 0.99 });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length >= 2);

    expect(mocks.processMessage).not.toHaveBeenCalled();
    expect(mocks.ttsMulaw).toHaveBeenCalledWith('माफ कीजिए, बात साफ़ समझ नहीं आई। कृपया दोबारा बताइए।', 'hi');
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

  it('persists first-audio and playback-completion evidence for each sent reply', async () => {
    mocks.stt.mockResolvedValue({ text: 'Tell me about Alpha', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    acknowledgeLatestMark(ws, collector);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark' && m.mark?.name?.startsWith('reply-1-')));
    await collector.waitFor(() => Boolean(session.voiceTurnMetrics?.some((metric) => metric.status === 'sent')));

    const sentMetric = session.voiceTurnMetrics?.find((metric) => metric.status === 'sent');
    expect(sentMetric?.responseSent).toBe(true);
    expect(sentMetric?.firstAudioMs).toEqual(expect.any(Number));
    acknowledgeLatestMark(ws, collector);
    await collector.waitFor(() => Boolean(sentMetric?.playbackCompletedAt));
    expect(sentMetric?.playbackMs).toEqual(expect.any(Number));
  });

  it('does not cancel the greeting when the caller speaks before TTS returns', async () => {
    let resolveGreeting!: (audio: Buffer) => void;
    mocks.ttsMulaw.mockReturnValueOnce(new Promise<Buffer>((resolve) => {
      resolveGreeting = resolve;
    }));
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor(() => mocks.ttsMulaw.mock.calls.length === 1);

    ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveGreeting(Buffer.alloc(1_600, 0x7f));

    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark' && m.mark?.name?.startsWith('greeting-')));
    expect(collector.messages.some((m) => m.event === 'media')).toBe(true);
    expect(collector.messages.some((m) => m.event === 'clear')).toBe(false);
  });

  it('sends clear and stops queued playback when the caller barges in', async () => {
    mocks.ttsMulaw.mockResolvedValueOnce(Buffer.alloc(16_000, 0x7f));
    const { ws, collector } = await connect();
    let sentSpeech = false;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event === 'media' && !sentSpeech) {
        sentSpeech = true;
        for (let i = 0; i < 2; i++) {
          ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
        }
      }
    });
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'clear'));

    expect(collector.messages.some((m) => m.event === 'clear' && m.streamSid === 'stream-test')).toBe(true);
  });

  it('does not clear playback for a single brief noise packet', async () => {
    mocks.ttsMulaw.mockResolvedValueOnce(Buffer.alloc(16_000, 0x7f));
    const { ws, collector } = await connect();
    let injectedNoise = false;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event === 'media' && !injectedNoise) {
        injectedNoise = true;
        ws.send(JSON.stringify({ event: 'media', media: { payload: mulawFrame(4_000).toString('base64') } }));
      }
    });
    sendStart(ws);
    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark'));

    expect(collector.messages.some((m) => m.event === 'clear')).toBe(false);
  });

  it('starts all reply sentences concurrently and sends them in order', async () => {
    mocks.stt.mockResolvedValue({ text: 'Tell me about Alpha', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    mocks.processMessage.mockResolvedValue({
      replyText: 'First sentence gives the caller the useful answer immediately. Second sentence asks one concise follow-up question.', language: 'en',
      callShouldEnd: false, policyViolations: [],
    });
    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length >= 2);

    expect(mocks.ttsMulaw).toHaveBeenCalledWith('First sentence gives the caller the useful answer immediately.', 'en');
    expect(mocks.ttsMulaw).toHaveBeenCalledWith('Second sentence asks one concise follow-up question.', 'en');
  });

  it('sends first-sentence audio before a slower second sentence finishes', async () => {
    mocks.stt.mockResolvedValue({ text: 'Tell me about Alpha', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    mocks.processMessage.mockResolvedValue({
      replyText: 'First sentence gives the caller the useful answer immediately. Second sentence asks one concise follow-up question.',
      language: 'en', callShouldEnd: false, policyViolations: [],
    });
    let resolveSecond!: (audio: Buffer) => void;
    mocks.ttsMulaw
      .mockResolvedValueOnce(Buffer.alloc(320, 0xff))
      .mockResolvedValueOnce(Buffer.alloc(1_600, 0x71))
      .mockReturnValueOnce(new Promise<Buffer>((resolve) => { resolveSecond = resolve; }));

    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    acknowledgeLatestMark(ws, collector);
    const mediaBeforeReply = collector.messages.filter((m) => m.event === 'media').length;
    sendUtterance(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'media').length > mediaBeforeReply);

    expect(collector.messages.filter((m) => m.event === 'mark').length).toBe(1);
    resolveSecond(Buffer.alloc(1_600, 0x72));
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 2);
  });

  it('queues caller speech during thinking without discarding the pending answer', async () => {
    mocks.stt
      .mockResolvedValueOnce({ text: 'Tell me about Alpha', detectedLanguageCode: 'en-IN', languageProbability: 0.99 })
      .mockResolvedValueOnce({ text: 'Hello', detectedLanguageCode: 'en-IN', languageProbability: 0.99 });
    let resolveFirstTurn!: (value: any) => void;
    mocks.processMessage
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirstTurn = resolve; }))
      .mockResolvedValueOnce({ replyText: 'Hello again.', language: 'en', callShouldEnd: false, policyViolations: [] });

    const { ws, collector } = await connect();
    sendStart(ws);
    await collector.waitFor((messages) => messages.filter((m) => m.event === 'mark').length === 1);
    acknowledgeLatestMark(ws, collector);
    sendUtterance(ws);
    await collector.waitFor(() => mocks.processMessage.mock.calls.length === 1);

    sendUtterance(ws);
    await new Promise((resolve) => setTimeout(resolve, 20));
    resolveFirstTurn({ replyText: 'Alpha is available.', language: 'en', callShouldEnd: false, policyViolations: [] });

    await collector.waitFor((messages) => messages.some((m) => m.event === 'mark' && m.mark?.name?.startsWith('reply-1-')));
    expect(mocks.processMessage.mock.calls[0][1]).toBe('Tell me about Alpha');
    expect(collector.messages.some((m) => m.event === 'clear')).toBe(false);
  });
});
