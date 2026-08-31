import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import { buildStt, buildTtsForLanguage } from '../providers.js';
import { processBrowserMessage } from '../adapters/browser.js';
import {
  createCallSession,
  getCallSession,
  getCallSessionByProviderCallId,
  updateCallSessionState,
  updateCallSessionStatus,
  type CallSessionStatus,
} from '../repositories/callSessions.repository.js';
import { createInitialState } from '../conversation/state.js';
import { normalizeVoiceTranscript } from '../conversation/transcript.js';
import { resetGuardState } from '../conversation/output-policy.js';
import type { SupportedLanguage } from '../conversation/language.js';
import { repeatPrompt } from '../conversation/voice-copy.js';
import { AudioAccumulator, pcm16ToWav } from '../telephony/audio-accumulator.js';
import { mulaw8kToPcm16k, wavToMulaw8k } from '../telephony/mulaw.js';
import { config } from '../config.js';
import { splitSentences } from '../adapters/wav-utils.js';
import type { VoiceTurnMetric } from '../conversation/state.js';

interface PlatformEvent {
  event?: 'connected' | 'start' | 'media' | 'stop' | 'dtmf' | 'mark';
  sequenceNumber?: string;
  streamSid?: string;
  start?: {
    streamSid?: string;
    callSid?: string;
    from?: string;
    to?: string;
    direction?: string;
    mediaFormat?: { encoding?: string; sampleRate?: number };
  };
  media?: { payload?: string; chunk?: string; timestamp?: string };
  stop?: { callSid?: string; reason?: string };
  mark?: { name?: string };
  dtmf?: { digit?: string };
}

interface QueuedUtterance {
  pcm: Buffer;
  inputEpoch: number;
}

interface SpeechSendResult {
  sent: boolean;
  partial: boolean;
  firstAudioAt: number | null;
  sentenceCount: number;
}

const MAX_QUEUED_UTTERANCES = 2;
const MAX_INBOUND_MEDIA_BYTES = 64 * 1024;
const OUTBOUND_CHUNK_BYTES = 1_600; // 200 ms; multiple of the required 160 bytes
const SOCKET_HIGH_WATER_BYTES = 512 * 1024;
const SOCKET_BACKPRESSURE_TIMEOUT_MS = 2_000;
const START_EVENT_TIMEOUT_MS = 15_000;
const MAX_STORED_VOICE_METRICS = 100;
const BETWEEN_SENTENCE_SILENCE = Buffer.alloc(640, 0xff); // 80 ms at 8 kHz mu-law

function sendJson(socket: WebSocket, payload: unknown): boolean {
  if (socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function requestOrigin(req: FastifyRequest): string {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host;
  return `wss://${host}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function redactTranscript(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s()-]{5,}\d/g, '[number]')
    .slice(0, 160);
}

async function yieldForSocket(socket: WebSocket): Promise<void> {
  const startedAt = Date.now();
  while (socket.readyState === socket.OPEN && socket.bufferedAmount > SOCKET_HIGH_WATER_BYTES) {
    if (Date.now() - startedAt >= SOCKET_BACKPRESSURE_TIMEOUT_MS) {
      throw new Error(`Smartflo socket backpressure exceeded ${SOCKET_BACKPRESSURE_TIMEOUT_MS}ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function registerSmartfloStreamRoutes(app: FastifyInstance): Promise<void> {
  // Some Smartflo resolver checks send an empty form-encoded POST even though
  // the response itself is JSON. Accept that harmless content type so the
  // request reaches the resolver instead of Fastify rejecting it with 415.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });
  }

  const resolver = async (req: FastifyRequest, reply: { send: (body: unknown) => unknown }) => {
    const wssUrl = config.VOICE_STREAM_PUBLIC_WSS_URL ?? `${requestOrigin(req)}/ws/voice/smartflo`;
    return reply.send({ success: true, wss_url: wssUrl });
  };
  app.get('/voice/stream/endpoint', resolver);
  app.post('/voice/stream/endpoint', resolver);

  app.get('/ws/voice/smartflo', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const connectedAt = Date.now();
    let sessionId: string | null = null;
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let busy = false;
    let closing = false;
    let sessionFinished = false;
    let startPromise: Promise<void> | null = null;
    let inputEpoch = 0;
    let playbackEpoch = 0;
    let playbackActive = false;
    let greetingPending = true;
    let activeMarkName: string | null = null;
    let activeMarkSentAt = 0;
    let outboundChunk = 1;
    let turnSequence = 0;
    let droppedTranscripts = 0;
    let currentLanguage: SupportedLanguage = 'en';
    const queuedUtterances: QueuedUtterance[] = [];
    const startEventTimer = setTimeout(() => {
      if (startPromise || closing) return;
      req.log.warn({
        ...logContext(),
        event: 'smartflo_start_timeout',
        connectedMs: Date.now() - connectedAt,
      }, 'Smartflo socket closed because no start event arrived');
      void finishSession('failed', 'start_timeout').finally(() => {
        if (socket.readyState === socket.OPEN) socket.close(1008, 'start event required');
      });
    }, START_EVENT_TIMEOUT_MS);

    const logContext = () => ({ sessionId, callSid, streamSid });

    async function finishSession(status: CallSessionStatus, reason: string): Promise<void> {
      if (sessionFinished) return;
      sessionFinished = true;
      clearTimeout(startEventTimer);
      closing = true;
      queuedUtterances.length = 0;
      playbackEpoch++;
      playbackActive = false;
      activeMarkName = null;
      if (sessionId) {
        resetGuardState(sessionId);
        try {
          await updateCallSessionStatus(sessionId, status);
        } catch (err) {
          req.log.error({ err, ...logContext() }, 'Smartflo session status update failed');
        }
      }
      req.log.info({
        ...logContext(),
        event: 'smartflo_call_finished',
        status,
        reason,
        durationMs: Date.now() - connectedAt,
        turnCount: turnSequence,
        droppedTranscripts,
      }, 'Smartflo call finished');
    }

    function interruptPlayback(reason: string): void {
      playbackEpoch++;
      const hadPlayback = playbackActive || activeMarkName !== null;
      if (hadPlayback && streamSid) {
        sendJson(socket, { event: 'clear', streamSid });
        req.log.info({ ...logContext(), event: 'smartflo_barge_in', reason }, 'Smartflo playback interrupted');
      }
      playbackActive = false;
      activeMarkName = null;
    }

    async function sendSpeech(
      text: string,
      language: 'en' | 'hi' | 'gu',
      markName: string
    ): Promise<SpeechSendResult> {
      const unsent = (sentenceCount = 0): SpeechSendResult => ({
        sent: false, partial: false, firstAudioAt: null, sentenceCount,
      });
      if (!streamSid || closing || socket.readyState !== socket.OPEN) return unsent();
      const speechEpoch = ++playbackEpoch;
      const tts = buildTtsForLanguage(language);
      const sentences = splitSentences(text);
      type PreparedChunk = { audio: Buffer; error?: never } | { audio?: never; error: unknown };
      // Start every sentence at once, but await/send them in order. This
      // preserves natural speech order while making the first sentence
      // audible as soon as its own TTS request completes instead of waiting
      // for the slowest sentence in the whole reply.
      const preparedChunks: Promise<PreparedChunk>[] = sentences.map((sentence, index) => {
        const synthesis = tts.synthesizeMulaw8k
          ? tts.synthesizeMulaw8k(sentence, language)
          : tts.synthesize(sentence, language).then(wavToMulaw8k);
        return withTimeout(synthesis, config.VOICE_TTS_TIMEOUT_MS, `TTS sentence ${index + 1}`)
          .then((audio): PreparedChunk => ({ audio }))
          .catch((error): PreparedChunk => ({ error }));
      });

      let firstAudioAt: number | null = null;
      let sentSentenceCount = 0;
      let partial = false;

      const sendMulaw = async (mulaw: Buffer): Promise<boolean> => {
        for (let offset = 0; offset < mulaw.length; offset += OUTBOUND_CHUNK_BYTES) {
          if (closing || speechEpoch !== playbackEpoch || socket.readyState !== socket.OPEN) return false;
          let frame = mulaw.subarray(offset, Math.min(offset + OUTBOUND_CHUNK_BYTES, mulaw.length));
          const remainder = frame.length % 160;
          if (remainder !== 0) frame = Buffer.concat([frame, Buffer.alloc(160 - remainder, 0xff)]);
          if (!sendJson(socket, {
            event: 'media',
            streamSid,
            media: { payload: frame.toString('base64'), chunk: outboundChunk++ },
          })) return false;
          if (firstAudioAt === null) firstAudioAt = Date.now();
          await yieldForSocket(socket);
        }
        return true;
      };

      for (let index = 0; index < preparedChunks.length; index++) {
        const prepared = await preparedChunks[index];
        if ('error' in prepared) {
          if (index === 0) throw prepared.error;
          partial = true;
          req.log.error({
            err: prepared.error,
            ...logContext(),
            event: 'smartflo_tts_sentence_failed',
            sentenceNumber: index + 1,
            sentenceCount: sentences.length,
          }, 'Smartflo stopped a reply after a later TTS sentence failed');
          break;
        }
        if (closing || speechEpoch !== playbackEpoch || socket.readyState !== socket.OPEN) {
          return { sent: false, partial, firstAudioAt, sentenceCount: sentences.length };
        }
        playbackActive = true;
        if (index > 0 && !(await sendMulaw(BETWEEN_SENTENCE_SILENCE))) {
          return { sent: false, partial, firstAudioAt, sentenceCount: sentences.length };
        }
        if (!(await sendMulaw(prepared.audio))) {
          return { sent: false, partial, firstAudioAt, sentenceCount: sentences.length };
        }
        sentSentenceCount++;
      }

      if (closing || speechEpoch !== playbackEpoch || firstAudioAt === null) {
        return { sent: false, partial, firstAudioAt, sentenceCount: sentences.length };
      }
      activeMarkName = markName;
      activeMarkSentAt = Date.now();
      sendJson(socket, { event: 'mark', streamSid, mark: { name: markName } });
      return {
        sent: sentSentenceCount > 0,
        partial: partial || sentSentenceCount < sentences.length,
        firstAudioAt,
        sentenceCount: sentences.length,
      };
    }

    async function sendRepeatPrompt(epoch: number): Promise<SpeechSendResult> {
      if (closing || epoch !== inputEpoch) {
        return { sent: false, partial: false, firstAudioAt: null, sentenceCount: 0 };
      }
      return sendSpeech(
        repeatPrompt(currentLanguage),
        currentLanguage,
        `repeat-${Date.now()}`
      );
    }

    async function storeVoiceMetric(metric: VoiceTurnMetric): Promise<void> {
      if (!sessionId) return;
      try {
        const latest = await getCallSession(sessionId);
        if (!latest) return;
        const metrics = [...(latest.conversationState.voiceTurnMetrics ?? []), metric]
          .slice(-MAX_STORED_VOICE_METRICS);
        latest.conversationState.voiceTurnMetrics = metrics;
        await updateCallSessionState(sessionId, latest.conversationState);
      } catch (err) {
        req.log.error({ err, ...logContext(), event: 'smartflo_metric_store_failed' }, 'Smartflo turn metric persistence failed');
      }
    }

    async function markVoiceMetricPlaybackCompleted(markName: string, playbackMs: number | null): Promise<void> {
      const turnMatch = /^reply-(\d+)-/.exec(markName);
      if (!sessionId || !turnMatch) return;
      const routeTurnId = Number(turnMatch[1]);
      try {
        const latest = await getCallSession(sessionId);
        if (!latest) return;
        const metric = [...(latest.conversationState.voiceTurnMetrics ?? [])]
          .reverse()
          .find((item) => item.routeTurnId === routeTurnId);
        if (!metric) return;
        metric.playbackCompletedAt = new Date().toISOString();
        if (playbackMs !== null) metric.playbackMs = playbackMs;
        await updateCallSessionState(sessionId, latest.conversationState);
      } catch (err) {
        req.log.error({ err, ...logContext(), event: 'smartflo_metric_store_failed' }, 'Smartflo playback metric persistence failed');
      }
    }

    function runNextQueued(): void {
      const next = queuedUtterances.shift();
      if (next && !closing) void runUtterance(next);
    }

    async function runUtterance(utterance: QueuedUtterance): Promise<void> {
      if (!sessionId || closing) return;
      busy = true;
      const turnId = ++turnSequence;
      const audioMs = Math.round((utterance.pcm.length / 2 / 16_000) * 1_000);
      const totalStartedAt = Date.now();
      let sttMs: number | undefined;
      let llmMs: number | undefined;
      let ttsMs: number | undefined;
      try {
        const session = await getCallSession(sessionId);
        if (!session) throw new Error('Smartflo call session disappeared');
        currentLanguage = session.conversationState.currentLanguage;

        const sttStartedAt = Date.now();
        const transcription = await withTimeout(
          buildStt().transcribe(pcm16ToWav(utterance.pcm), {
            format: 'wav',
            languageHint: session.conversationState.currentLanguage,
          }),
          config.VOICE_STT_TIMEOUT_MS,
          'STT'
        );
        sttMs = Date.now() - sttStartedAt;
        const decision = normalizeVoiceTranscript(transcription);

        req.log.info({
          ...logContext(),
          event: 'smartflo_turn_stt',
          turnId,
          audioMs,
          sttMs,
          detectedLanguageCode: transcription.detectedLanguageCode ?? null,
          languageProbability: transcription.languageProbability ?? null,
          sttRetried: transcription.wasRetried ?? false,
          transcriptAccepted: decision.accepted,
          transcript: decision.accepted ? redactTranscript(decision.text) : undefined,
          dropReason: decision.accepted ? undefined : decision.reason,
        }, 'Smartflo STT completed');

        if (!decision.accepted) {
          droppedTranscripts++;
          const repeat = await sendRepeatPrompt(utterance.inputEpoch);
          await storeVoiceMetric({
            routeTurnId: turnId,
            recordedAt: new Date().toISOString(),
            status: 'transcript_rejected',
            audioMs,
            sttMs,
            firstAudioMs: repeat.firstAudioAt === null ? undefined : repeat.firstAudioAt - totalStartedAt,
            totalMs: Date.now() - totalStartedAt,
            responseSent: repeat.sent,
            reason: decision.reason,
          });
          return;
        }

        const llmStartedAt = Date.now();
        const result = await withTimeout(
          processBrowserMessage(sessionId, decision.text),
          config.VOICE_LLM_TIMEOUT_MS,
          'LLM turn'
        );
        llmMs = Date.now() - llmStartedAt;
        currentLanguage = result.language;

        if (closing || utterance.inputEpoch !== inputEpoch) {
          const totalMs = Date.now() - totalStartedAt;
          req.log.info({
            ...logContext(),
            event: 'smartflo_turn_superseded',
            turnId,
            cancellationPhase: 'before_tts',
            totalMs,
          }, 'Smartflo turn superseded by caller speech');
          await storeVoiceMetric({
            routeTurnId: turnId,
            recordedAt: new Date().toISOString(),
            status: 'superseded',
            audioMs,
            sttMs,
            llmMs,
            totalMs,
            responseSent: false,
            reason: 'caller_speech_before_tts',
          });
          return;
        }

        const ttsStartedAt = Date.now();
        const speech = await sendSpeech(result.replyText, result.language, `reply-${turnId}-${Date.now()}`);
        ttsMs = Date.now() - ttsStartedAt;
        const totalMs = Date.now() - totalStartedAt;
        const firstAudioMs = speech.firstAudioAt === null ? undefined : speech.firstAudioAt - totalStartedAt;

        req.log.info({
          ...logContext(),
          event: 'smartflo_turn_complete',
          turnId,
          audioMs,
          sttMs,
          llmMs,
          ttsMs,
          totalMs,
          firstAudioMs,
          responseSent: speech.sent,
          partialResponse: speech.partial,
          sentenceCount: speech.sentenceCount,
          policyViolations: result.policyViolations,
          callShouldEnd: result.callShouldEnd,
        }, 'Smartflo turn completed');
        await storeVoiceMetric({
          routeTurnId: turnId,
          recordedAt: new Date().toISOString(),
          status: speech.sent ? 'sent' : 'superseded',
          audioMs,
          sttMs,
          llmMs,
          ttsMs,
          firstAudioMs,
          totalMs,
          responseSent: speech.sent,
          reason: speech.partial
            ? 'partial_tts'
            : speech.sent ? undefined : 'caller_barge_in_during_tts_or_send',
        });
      } catch (err) {
        req.log.error({ err, ...logContext(), event: 'smartflo_turn_failed', turnId, audioMs }, 'Smartflo voice turn failed');
        let repeat: SpeechSendResult | null = null;
        try {
          repeat = await sendRepeatPrompt(utterance.inputEpoch);
        } catch (fallbackErr) {
          req.log.error({ err: fallbackErr, ...logContext(), turnId }, 'Smartflo fallback speech failed');
        }
        await storeVoiceMetric({
          routeTurnId: turnId,
          recordedAt: new Date().toISOString(),
          status: 'failed',
          audioMs,
          sttMs,
          llmMs,
          ttsMs,
          firstAudioMs: repeat?.firstAudioAt === null || repeat?.firstAudioAt === undefined
            ? undefined
            : repeat.firstAudioAt - totalStartedAt,
          totalMs: Date.now() - totalStartedAt,
          responseSent: repeat?.sent ?? false,
          reason: err instanceof Error ? err.message.slice(0, 160) : 'unknown_error',
        });
      } finally {
        busy = false;
        runNextQueued();
      }
    }

    function enqueueUtterance(pcm: Buffer): void {
      const utterance = { pcm, inputEpoch };
      if (!busy) {
        void runUtterance(utterance);
        return;
      }
      if (queuedUtterances.length >= MAX_QUEUED_UTTERANCES) {
        queuedUtterances.shift();
        req.log.warn({ ...logContext(), event: 'smartflo_queue_bounded' }, 'Smartflo utterance queue dropped oldest item');
      }
      queuedUtterances.push(utterance);
    }

    const accumulator = new AudioAccumulator(enqueueUtterance, {
      speechRmsThreshold: config.VOICE_SPEECH_RMS_THRESHOLD,
      onSpeechStart: () => {
        // An eager caller often says "hello" before the first TTS request has
        // returned. There is no audio to interrupt yet; bumping playbackEpoch
        // here used to cancel the greeting before its first frame was sent.
        // Preserve that initial greeting, then enable normal barge-in as soon
        // as it has been queued for playback.
        if (greetingPending && !playbackActive && activeMarkName === null) {
          req.log.info({ ...logContext(), event: 'smartflo_early_caller_speech' }, 'Caller spoke while greeting was preparing');
          return;
        }
        // If the bot is already audible, this is a real barge-in and should
        // stop playback immediately. If it is only thinking/synthesizing,
        // keep the pending answer and queue the new utterance. Previously a
        // caller saying "hello" during a silent 5-8 second wait discarded the
        // finished answer before a single audio byte was sent.
        if (playbackActive || activeMarkName !== null) {
          inputEpoch++;
          interruptPlayback('caller_speech');
        } else if (busy) {
          req.log.info({
            ...logContext(),
            event: 'smartflo_caller_speech_while_thinking',
            pendingTurn: turnSequence,
          }, 'Caller speech queued while a response was preparing');
        }
      },
    });

    socket.on('message', (raw: RawData) => {
      void (async () => {
        let message: PlatformEvent;
        try {
          message = JSON.parse(raw.toString()) as PlatformEvent;
        } catch {
          req.log.warn({ ...logContext(), event: 'smartflo_invalid_json' }, 'Ignoring malformed Smartflo message');
          return;
        }

        if (message.event === 'connected') {
          req.log.info({ event: 'smartflo_connected' }, 'Smartflo WebSocket connected');
          return;
        }

        if (message.event === 'start') {
          if (startPromise) return;
          clearTimeout(startEventTimer);
          const format = message.start?.mediaFormat;
          if (format?.encoding && format.encoding !== 'audio/x-mulaw') {
            req.log.warn({ encoding: format.encoding }, 'Unsupported Smartflo stream encoding');
            socket.close(1003, 'audio/x-mulaw required');
            return;
          }
          if (format?.sampleRate && format.sampleRate !== 8000) {
            req.log.warn({ sampleRate: format.sampleRate }, 'Unsupported Smartflo stream sample rate');
            socket.close(1003, '8000 Hz required');
            return;
          }

          streamSid = message.start?.streamSid ?? message.streamSid ?? null;
          callSid = message.start?.callSid ?? null;
          if (!streamSid) {
            socket.close(1008, 'streamSid required');
            return;
          }

          busy = true;
          startPromise = (async () => {
            const existing = callSid ? await getCallSessionByProviderCallId(callSid) : null;
            const session = existing ?? await createCallSession(
              createInitialState(),
              'tata_smartflo',
              { providerCallId: callSid ?? undefined, locale: 'en-IN' }
            );
            sessionId = session.id;
            currentLanguage = session.conversationState.currentLanguage;
            if (existing) await updateCallSessionStatus(session.id, 'started');

            req.log.info({
              ...logContext(),
              event: 'smartflo_call_started',
              direction: message.start?.direction ?? null,
              reconnected: Boolean(existing),
            }, 'Smartflo call started');

            if (sessionFinished) {
              await updateCallSessionStatus(session.id, 'ended');
              return;
            }

            const greeting = 'Hello! Welcome to Earthora Farms. How can I help?';
            if (!existing || session.conversationState.messages.length === 0) {
              session.conversationState.messages.push({ role: 'assistant', content: greeting });
              await updateCallSessionState(session.id, session.conversationState);
            }
            try {
              await sendSpeech(greeting, 'en', `greeting-${Date.now()}`);
            } finally {
              greetingPending = false;
            }
          })().catch(async (err) => {
            req.log.error({ err, ...logContext(), event: 'smartflo_start_failed' }, 'Smartflo call start failed');
            await finishSession('failed', 'start_failed');
            if (socket.readyState === socket.OPEN) socket.close(1011, 'call initialization failed');
          }).finally(() => {
            busy = false;
            runNextQueued();
          });
          return;
        }

        if (message.event === 'media' && message.media?.payload) {
          if (!startPromise || closing) return;
          const mulaw = Buffer.from(message.media.payload, 'base64');
          if (mulaw.length === 0 || mulaw.length > MAX_INBOUND_MEDIA_BYTES) {
            req.log.warn({ ...logContext(), mediaBytes: mulaw.length }, 'Invalid Smartflo media payload size');
            if (mulaw.length > MAX_INBOUND_MEDIA_BYTES) socket.close(1009, 'media payload too large');
            return;
          }
          accumulator.push(mulaw8kToPcm16k(mulaw));
          return;
        }

        if (message.event === 'mark') {
          if (message.mark?.name && message.mark.name === activeMarkName) {
            const completedMarkName = activeMarkName;
            const playbackMs = activeMarkSentAt ? Date.now() - activeMarkSentAt : null;
            req.log.info({
              ...logContext(),
              event: 'smartflo_playback_complete',
              markName: completedMarkName,
              playbackMs,
            }, 'Smartflo playback completed');
            playbackActive = false;
            activeMarkName = null;
            await markVoiceMetricPlaybackCompleted(completedMarkName, playbackMs);
          }
          return;
        }

        if (message.event === 'dtmf') {
          req.log.info({ ...logContext(), event: 'smartflo_dtmf', digit: message.dtmf?.digit ?? null }, 'Smartflo DTMF received');
          return;
        }

        if (message.event === 'stop') {
          await finishSession('ended', message.stop?.reason ?? 'platform_stop');
        }
      })().catch((err) => req.log.error({ err, ...logContext() }, 'Smartflo stream message failed'));
    });

    socket.on('close', (code, reason) => {
      void finishSession('ended', `socket_close:${code}:${reason.toString()}`);
    });
    socket.on('error', (err) => {
      req.log.error({ err, ...logContext(), event: 'smartflo_socket_error' }, 'Smartflo stream socket error');
      void finishSession('failed', 'socket_error');
    });
  });
}
