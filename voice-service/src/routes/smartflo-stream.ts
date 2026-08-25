import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { buildStt, buildTtsForLanguage } from '../providers.js';
import { processBrowserMessage } from '../adapters/browser.js';
import { createCallSession, updateCallSessionState } from '../repositories/callSessions.repository.js';
import { createInitialState } from '../conversation/state.js';
import { AudioAccumulator, pcm16ToWav } from '../telephony/audio-accumulator.js';
import { mulaw8kToPcm16k, wavToMulaw8k } from '../telephony/mulaw.js';
import { splitSentences } from '../adapters/wav-utils.js';
import { config } from '../config.js';

interface PlatformEvent {
  event?: 'connected' | 'start' | 'media' | 'stop' | 'dtmf' | 'mark';
  streamSid?: string;
  start?: { streamSid?: string; callSid?: string; mediaFormat?: { encoding?: string; sampleRate?: number } };
  media?: { payload?: string };
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function requestOrigin(req: FastifyRequest): string {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  return `wss://${host}`;
}

export async function registerSmartfloStreamRoutes(app: FastifyInstance): Promise<void> {
  // Dynamic endpoint contract intentionally uses the platform's documented
  // misspelling: "sucess". It must return only these two keys within 2 seconds.
  const resolver = async (req: FastifyRequest, reply: { send: (body: unknown) => unknown }) => {
    const wssUrl = config.VOICE_STREAM_PUBLIC_WSS_URL ?? `${requestOrigin(req)}/ws/voice/smartflo`;
    return reply.send({ sucess: true, wss_url: wssUrl });
  };
  app.get('/voice/stream/endpoint', resolver);
  app.post('/voice/stream/endpoint', resolver);

  app.get('/ws/voice/smartflo', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    let sessionId: string | null = null;
    let streamSid: string | null = null;
    let busy = false;
    let startPromise: Promise<void> | null = null;
    const queuedUtterances: Buffer[] = [];

    async function sendSpeech(text: string, language: 'en' | 'hi' | 'gu', markName: string): Promise<void> {
      if (!streamSid) return;
      const tts = buildTtsForLanguage(language);
      const sentences = splitSentences(text);
      let chunk = 1;
      for (const sentence of sentences) {
        const wav = await tts.synthesize(sentence, language);
        const mulaw = wavToMulaw8k(wav);
        // Use 20 ms (160 byte) frames, the minimum/multiple required by the platform.
        for (let offset = 0; offset < mulaw.length; offset += 160) {
          let frame = mulaw.subarray(offset, Math.min(offset + 160, mulaw.length));
          if (frame.length < 160) frame = Buffer.concat([frame, Buffer.alloc(160 - frame.length, 0xff)]);
          sendJson(socket, { event: 'media', streamSid, media: { payload: frame.toString('base64'), chunk: chunk++ } });
        }
      }
      sendJson(socket, { event: 'mark', streamSid, mark: { name: markName } });
    }

    async function runUtterance(pcm: Buffer): Promise<void> {
      if (!sessionId) return;
      busy = true;
      try {
        const transcription = await buildStt().transcribe(pcm16ToWav(pcm), { format: 'wav' });
        if (!transcription.text.trim()) return;
        const result = await processBrowserMessage(sessionId, transcription.text);
        await sendSpeech(result.replyText, result.language, `reply-${Date.now()}`);
      } catch (err) {
        req.log.error(err, 'Smartflo voice stream turn failed');
      } finally {
        busy = false;
        const next = queuedUtterances.shift();
        if (next) void runUtterance(next);
      }
    }

    const accumulator = new AudioAccumulator((utterance) => {
      if (busy) queuedUtterances.push(utterance);
      else void runUtterance(utterance);
    });

    socket.on('message', (raw: RawData) => {
      void (async () => {
        let message: PlatformEvent;
        try { message = JSON.parse(raw.toString()) as PlatformEvent; }
        catch { return; }

        if (message.event === 'start') {
          if (startPromise) return;
          const format = message.start?.mediaFormat;
          if (format?.encoding && format.encoding !== 'audio/x-mulaw') {
            req.log.warn({ encoding: format.encoding }, 'unsupported voice stream encoding');
            socket.close(1003, 'audio/x-mulaw required');
            return;
          }
          streamSid = message.start?.streamSid ?? message.streamSid ?? null;
          if (!streamSid) { socket.close(1008, 'streamSid required'); return; }

          busy = true;
          startPromise = (async () => {
            const session = await createCallSession(createInitialState(), 'tata_smartflo');
            sessionId = session.id;
            const greeting = "Hello! Welcome to Earthora Farms. I'm your voice ordering assistant. How can I help you today?";
            session.conversationState.messages.push({ role: 'assistant', content: greeting });
            await updateCallSessionState(session.id, session.conversationState);
            await sendSpeech(greeting, 'en', `greeting-${Date.now()}`);
          })().finally(() => {
            busy = false;
            const next = queuedUtterances.shift();
            if (next) void runUtterance(next);
          });
          await startPromise;
          return;
        }

        if (message.event === 'media' && message.media?.payload) {
          if (startPromise) await startPromise;
          if (!sessionId) return;
          accumulator.push(mulaw8kToPcm16k(Buffer.from(message.media.payload, 'base64')));
        } else if (message.event === 'stop') {
          accumulator.flushIfPending();
        }
      })().catch((err) => req.log.error(err, 'Smartflo stream message failed'));
    });

    socket.on('close', () => accumulator.flushIfPending());
    socket.on('error', (err) => req.log.error(err, 'Smartflo stream socket error'));
  });
}
