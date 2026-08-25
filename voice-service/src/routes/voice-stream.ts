import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket, RawData } from 'ws';
import { AudioAccumulator, pcm16ToWav } from '../telephony/audio-accumulator.js';
import { buildStt, buildTtsForLanguage } from '../providers.js';
import { processBrowserMessage } from '../adapters/browser.js';
import { getCallSession, updateCallSessionState } from '../repositories/callSessions.repository.js';
import { splitSentences } from '../adapters/wav-utils.js';

// Real-time voice over a continuous WebSocket stream — no push-to-talk.
// Client streams raw PCM16 mono 16kHz audio the whole time the call is
// "active"; AudioAccumulator (server-side) decides utterance boundaries
// from silence alone, same underlying idea as the reference project at
// D:\Work\Sun\Agent (src/telephony/audio-accumulator.ts) but reimplemented
// clean for this system — see that file's own header comment for exactly
// what's kept vs. simplified.

const INACTIVITY_WARN_MS = 7_000; // "are you still there?" after 7s of user silence
const INACTIVITY_HANGUP_MS = 3_000; // hard disconnect 3s after the warning

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

      // ── Inactivity timer ────────────────────────────────────────────────────
      // Fires after INACTIVITY_WARN_MS of user silence WHILE THE AGENT IS IDLE.
      // A generation counter prevents stale handleInactivity() calls (that were
      // rescheduled while sessionBusy=true) from firing after the agent resumes.
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let hangupTimer: ReturnType<typeof setTimeout> | null = null;
      let inactivityGen = 0; // incremented on every reset/clear to abort stale instances
      // True while the inactivity warning audio is in flight — the next audio_done
      // should start the 3-second hangup countdown instead of resetting the watch.
      let pendingHangup = false;

      function clearTimers(): void {
        inactivityGen++; // abort any in-flight handleInactivity rescheduled instances
        if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
        if (hangupTimer) { clearTimeout(hangupTimer); hangupTimer = null; }
      }

      function resetInactivityTimer(): void {
        clearTimers();
        const gen = inactivityGen;
        inactivityTimer = setTimeout(() => { void handleInactivity(gen); }, INACTIVITY_WARN_MS);
      }

      async function handleInactivity(gen: number): Promise<void> {
        inactivityTimer = null;
        // Abort if we've been superseded by a newer timer cycle.
        if (gen !== inactivityGen) return;
        if (socket.readyState !== socket.OPEN) return;

        // Agent is busy (synthesizing/speaking) — reschedule, but only for this gen.
        if (sessionBusy) {
          inactivityTimer = setTimeout(() => { void handleInactivity(gen); }, 2_000);
          return;
        }

        sessionBusy = true;
        try {
          const warnText = "Are you still there?";
          send(socket, { type: 'agent_reply_text', text: warnText, language: 'en' });
          await streamTts(socket, warnText, 'en');
          // Flag BEFORE agent_audio_end so when the client finishes playing the
          // warning and sends audio_done, the handler starts the hangup countdown
          // instead of resetting the inactivity watch.
          pendingHangup = true;
          send(socket, { type: 'agent_audio_end', endCall: false });
        } finally {
          sessionBusy = false;
          const next = pendingUtterances.shift();
          if (next) {
            pendingHangup = false; // user spoke during warning — cancel intent
            void runTurn(next);
            return;
          }
        }

        // Safety fallback: if audio_done never arrives (browser crash, proxy drop)
        // hang up after a generous timeout — warning audio is ~1s, so 15s is plenty.
        if (gen !== inactivityGen) { pendingHangup = false; return; }
        hangupTimer = setTimeout(() => {
          hangupTimer = null;
          pendingHangup = false;
          if (gen !== inactivityGen) return;
          if (socket.readyState === socket.OPEN) {
            send(socket, { type: 'call_end', reason: 'inactivity' });
            socket.close();
          }
        }, 15_000);
      }

      // ── Turn runner ─────────────────────────────────────────────────────────
      async function runTurn(pcmUtterance: Buffer): Promise<void> {
        sessionBusy = true;
        clearTimers(); // user is actively talking — cancel any inactivity sequence
        try {
          const session = await getCallSession(sessionId);
          if (!session) {
            send(socket, { type: 'error', message: 'unknown_session' });
            return;
          }

          const wav = pcm16ToWav(pcmUtterance);
          const stt = buildStt();
          const transcription = await stt.transcribe(wav, { format: 'wav' });

          if (!transcription.text.trim()) {
            return; // false trigger — nothing to respond to
          }

          // Drop transcriptions in scripts we don't support (Kannada, Tamil,
          // Telugu, Malayalam, Odia, …). Sarvam sometimes picks up background
          // audio and transcribes it as a regional Indian language — those turns
          // would confuse the LLM and should be silently discarded.
          // Unicode ranges: Odia U+0B00-U+0B7F, Tamil U+0B80-U+0BFF,
          // Telugu U+0C00-U+0C7F, Kannada U+0C80-U+0CFF, Malayalam U+0D00-U+0D7F.
          // Devanagari (U+0900-U+097F) and Gujarati (U+0A80-U+0AFF) are supported.
          if (/[଀-෿]/.test(transcription.text)) {
            req.log.info({ text: transcription.text }, 'dropping turn — unsupported script');
            return;
          }

          // Correct common STT misrecognitions of brand/product names.
          transcription.text = transcription.text
            .replace(/\barthora\s+farms?\b/gi, 'Earthora Farms')
            .replace(/\barthora\b/gi, 'Earthora');

          send(socket, {
            type: 'user_transcript',
            text: transcription.text,
            language: transcription.detectedLanguage,
          });

          const result = await processBrowserMessage(sessionId, transcription.text);
          send(socket, { type: 'agent_reply_text', text: result.replyText, language: result.language });

          await streamTts(socket, result.replyText, result.language);

          // agent_audio_end tells the client to exit speaking mode.
          // If the payment link was just sent, also signal end-of-call so the
          // client closes the connection after the audio drains.
          send(socket, { type: 'agent_audio_end', endCall: result.callShouldEnd });
        } catch (err) {
          req.log.error(err, 'voice stream turn failed');
          send(socket, { type: 'error', message: (err as Error).message });
        } finally {
          sessionBusy = false;
          const next = pendingUtterances.shift();
          if (next) {
            void runTurn(next);
          } else {
            // Don't start the 7s timer yet — the client is still playing audio.
            // audio_done from the client will call resetInactivityTimer() once
            // playback finishes. Long fallback here covers dropped messages.
            const gen = inactivityGen;
            inactivityTimer = setTimeout(() => { void handleInactivity(gen); }, INACTIVITY_WARN_MS + 30_000);
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
          await updateCallSessionState(sessionId, state);

          send(socket, { type: 'agent_reply_text', text: greetingText, language: 'en' });
          await streamTts(socket, greetingText, 'en');
          send(socket, { type: 'agent_audio_end', endCall: false });
        } catch (err) {
          req.log.error(err, 'greeting failed — caller will need to speak first');
        } finally {
          sessionBusy = false;
          const next = pendingUtterances.shift();
          if (next) void runTurn(next);
          else {
            const gen = inactivityGen;
            inactivityTimer = setTimeout(() => { void handleInactivity(gen); }, INACTIVITY_WARN_MS + 30_000);
          }
        }
      }

      // ── Accumulator + socket wiring ─────────────────────────────────────────
      const accumulator = new AudioAccumulator((utterance) => {
        if (sessionBusy) {
          pendingUtterances.push(utterance);
        } else {
          void runTurn(utterance);
        }
      });

      void runGreeting();

      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const parsed = JSON.parse(data.toString('utf8'));
            if (parsed.type === 'ping') send(socket, { type: 'pong' });
            else if (parsed.type === 'audio_done') {
              if (pendingHangup) {
                // Warning just finished playing — start the hard hangup countdown.
                pendingHangup = false;
                clearTimers();
                const gen = inactivityGen;
                hangupTimer = setTimeout(() => {
                  hangupTimer = null;
                  if (gen !== inactivityGen) return;
                  if (socket.readyState === socket.OPEN) {
                    send(socket, { type: 'call_end', reason: 'inactivity' });
                    socket.close();
                  }
                }, INACTIVITY_HANGUP_MS);
              } else {
                // Normal agent reply finished — start fresh inactivity watch.
                resetInactivityTimer();
              }
            }
          } catch {
            // ignore malformed control messages
          }
          return;
        }

        // User is sending audio. Only reset the inactivity clock when the agent
        // is idle — resetting during synthesis/speaking would start the 7s window
        // too early (before the user can even hear the response).
        if (!sessionBusy) resetInactivityTimer();
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
