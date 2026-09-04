import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import { AudioAccumulator, pcm16ToWav } from '../telephony/audio-accumulator.js';
import { buildStt, buildTtsForLanguage } from '../providers.js';
import { processTurn } from '../conversation/controller.js';
import { getCallSession, updateCallSessionState } from '../repositories/callSessions.repository.js';
import { splitSentences } from '../adapters/wav-utils.js';
import { normalizeVoiceTranscript } from '../conversation/transcript.js';
import { config } from '../config.js';

// Real-time voice over a continuous WebSocket stream — no push-to-talk.
// Client streams raw PCM16 mono 16kHz audio the whole time the call is
// "active"; AudioAccumulator (server-side) decides utterance boundaries
// from silence alone, same underlying idea as the reference project at
// D:\Work\Sun\Agent (src/telephony/audio-accumulator.ts) but reimplemented
// clean for this system — see that file's own header comment for exactly
// what's kept vs. simplified.

const CALLER_SILENCE_HANGUP_MS = 7_000;

function bufferFromRawData(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

interface ServerMessage {
  type: 'pong' | 'user_transcript' | 'agent_reply_text' | 'agent_audio_end' | 'call_end' | 'error';
  text?: string;
  language?: string;
  message?: string;
  /** agent_audio_end only — signals the client to close the call after audio drains. */
  endCall?: boolean;
  reason?: string;
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

/** Synthesize all sentences in parallel, stream WAVs to the client in order as each resolves. */
async function streamTts(
  socket: WebSocket,
  text: string,
  language: string,
): Promise<void> {
  const tts = buildTtsForLanguage(language as 'en' | 'hi' | 'gu');
  const sentences = splitSentences(text);
  // Fire all TTS requests simultaneously — total time = slowest sentence, not sum of all.
  const wavPromises = sentences.map((s) => tts.synthesize(s, language as 'en' | 'hi' | 'gu'));
  for (const wavPromise of wavPromises) {
    if (socket.readyState !== socket.OPEN) break;
    const wav = await wavPromise;
    if (socket.readyState === socket.OPEN) socket.send(wav);
  }
}

export async function registerVoiceStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/ws/voice/session/:id',
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest<{ Params: { id: string } }>) => {
      const sessionId = req.params.id;
      let sessionBusy = false;
      const pendingUtterances: Buffer[] = [];

      // ── Caller-silence timer ─────────────────────────────────────────────────
      // A full seven seconds of no above-threshold caller audio ends the call.
      // The clock is paused while the agent is working or its audio is playing.
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let inactivityGen = 0; // incremented on every reset/clear to abort stale instances
      let awaitingAudioDone = false;
      let endAfterPlayback = false;

      function clearTimers(): void {
        inactivityGen++; // abort any in-flight handleInactivity rescheduled instances
        if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
      }

      function resetInactivityTimer(): void {
        clearTimers();
        const gen = inactivityGen;
        inactivityTimer = setTimeout(() => { handleInactivity(gen); }, CALLER_SILENCE_HANGUP_MS);
      }

      function handleInactivity(gen: number): void {
        inactivityTimer = null;
        if (gen !== inactivityGen) return;
        if (socket.readyState !== socket.OPEN) return;

        if (sessionBusy || awaitingAudioDone) {
          inactivityTimer = setTimeout(() => { handleInactivity(gen); }, 500);
          return;
        }
        send(socket, { type: 'call_end', reason: 'caller_silence_7s' });
        socket.close();
      }

      // ── Turn runner ─────────────────────────────────────────────────────────
      async function runTurn(pcmUtterance: Buffer): Promise<void> {
        sessionBusy = true;
        clearTimers(); // user is actively talking — cancel any inactivity sequence
        try {
          // STT and session load are independent — run them in parallel so the
          // slower one (STT, ~600ms) sets the total rather than summing both.
          const stt = buildStt();
          const [session, transcription] = await Promise.all([
            getCallSession(sessionId),
            stt.transcribe(pcm16ToWav(pcmUtterance), {
              format: 'wav',
              languageHint: undefined, // no hint — auto-detect is more accurate
            }),
          ]);

          if (!session) {
            send(socket, { type: 'error', message: 'unknown_session' });
            return;
          }

          const decision = normalizeVoiceTranscript(transcription);
          if (!decision.accepted) {
            req.log.info({
              reason: decision.reason,
              detectedLanguageCode: transcription.detectedLanguageCode ?? null,
              languageProbability: transcription.languageProbability ?? null,
            }, 'dropping untrusted voice transcript');
            return;
          }

          send(socket, {
            type: 'user_transcript',
            text: decision.text,
            language: transcription.detectedLanguage,
          });

          // Run the full conversation turn (tool loop + LLM).
          const outcome = await processTurn(sessionId, session.conversationState, decision.text);
          const language = outcome.state.currentLanguage;
          const callShouldEnd = outcome.state.currentTurnFacts.some((f) => {
            if (f.toolName !== 'create_verification_link') return false;
            try { return (JSON.parse(f.resultJson) as { ok?: boolean })?.ok === true; } catch { return false; }
          });

          send(socket, { type: 'agent_reply_text', text: outcome.replyText, language });

          // Persist conversation state and synthesize audio in parallel — the
          // DB write is independent of TTS, so both can fly simultaneously.
          await Promise.all([
            updateCallSessionState(sessionId, outcome.state),
            streamTts(socket, outcome.replyText, language),
          ]);

          endAfterPlayback = callShouldEnd;
          if (callShouldEnd) pendingUtterances.length = 0;
          awaitingAudioDone = true;
          send(socket, { type: 'agent_audio_end', endCall: callShouldEnd });
        } catch (err) {
          req.log.error(err, 'voice stream turn failed');
          send(socket, { type: 'error', message: (err as Error).message });
        } finally {
          sessionBusy = false;
          const next = pendingUtterances.shift();
          if (next) {
            void runTurn(next);
          }
        }
      }

      // ── Greeting ────────────────────────────────────────────────────────────
      async function runGreeting(): Promise<void> {
        sessionBusy = true;
        try {
          const session = await getCallSession(sessionId);
          if (!session) return;

          const greetingText =
            "Hello! Welcome to Earthora Farms. I'm your voice ordering assistant. How can I help you today?";

          const state = session.conversationState;
          state.messages.push({ role: 'assistant', content: greetingText });

          send(socket, { type: 'agent_reply_text', text: greetingText, language: 'en' });

          // Persist greeting to history and synthesize audio in parallel.
          await Promise.all([
            updateCallSessionState(sessionId, state),
            streamTts(socket, greetingText, 'en'),
          ]);

          awaitingAudioDone = true;
          send(socket, { type: 'agent_audio_end', endCall: false });
        } catch (err) {
          req.log.error(err, 'greeting failed — caller will need to speak first');
        } finally {
          sessionBusy = false;
          const next = pendingUtterances.shift();
          if (next) void runTurn(next);
        }
      }

      // ── Accumulator + socket wiring ─────────────────────────────────────────
      const accumulator = new AudioAccumulator((utterance) => {
        if (endAfterPlayback) return;
        if (sessionBusy) {
          pendingUtterances.push(utterance);
        } else {
          void runTurn(utterance);
        }
      }, {
        speechRmsThreshold: config.VOICE_SPEECH_RMS_THRESHOLD,
        onSpeechActivity: () => {
          if (!sessionBusy && !awaitingAudioDone) resetInactivityTimer();
        },
      });

      void runGreeting();

      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const parsed = JSON.parse(data.toString('utf8'));
            if (parsed.type === 'ping') send(socket, { type: 'pong' });
            else if (parsed.type === 'audio_done') {
              awaitingAudioDone = false;
              if (endAfterPlayback) {
                endAfterPlayback = false;
                clearTimers();
                send(socket, { type: 'call_end', reason: 'checkout_form_sent' });
                socket.close();
              } else {
                resetInactivityTimer();
              }
            }
          } catch {
            // ignore malformed control messages
          }
          return;
        }

        accumulator.push(bufferFromRawData(data));
      });

      socket.on('close', () => {
        clearTimers();
      });

      socket.on('error', (err: Error) => {
        clearTimers();
        req.log.error(err, 'voice stream socket error');
      });
    }
  );
}
