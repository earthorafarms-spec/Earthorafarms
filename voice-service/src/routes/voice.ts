import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCallSession } from '../repositories/callSessions.repository.js';
import { createInitialState } from '../conversation/state.js';
import { processBrowserMessage } from '../adapters/browser.js';
import { sendMessageBodySchema } from '../schemas/voice.js';
import { buildStt, buildTtsForLanguage } from '../providers.js';
import { getCallSession } from '../repositories/callSessions.repository.js';
import { normalizeVoiceTranscript } from '../conversation/transcript.js';

// Fastify only auto-parses application/json and text/plain by default — a
// browser-recorded audio blob (audio/webm, audio/ogg, etc.) needs an
// explicit raw-buffer content-type parser registered, same pattern as the
// payment-webhook route's raw-body requirement, just for a different reason
// (audio bytes vs. signature verification).
const AUDIO_CONTENT_TYPE = /^audio\//;

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/voice/session', async (_req, reply) => {
    const session = await createCallSession(createInitialState());
    return reply.send({ sessionId: session.id });
  });

  app.post<{ Params: { id: string } }>('/voice/session/:id/message', async (req, reply) => {
    const parsed = sendMessageBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    try {
      const result = await processBrowserMessage(req.params.id, parsed.data.text);
      return reply.send({ reply: result.replyText });
    } catch (err) {
      req.log.error(err, 'voice session message failed');
      return reply.status(400).send({ error: 'session_error' });
    }
  });

  // Real voice: browser records one utterance, POSTs the raw audio blob,
  // gets back JSON with the transcript (so the caller can see what was
  // heard), the reply text, and base64 WAV audio of the spoken reply.
  // Registered in its own encapsulated context so the raw-audio content
  // parser doesn't affect any other route.
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      AUDIO_CONTENT_TYPE,
      { parseAs: 'buffer' },
      (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body)
    );

    scoped.post<{ Params: { id: string } }>('/voice/session/:id/audio-message', async (req, reply) => {
      const audio = req.body as Buffer;
      if (!audio || audio.length === 0) {
        return reply.status(400).send({ error: 'empty_audio' });
      }

      try {
        const session = await getCallSession(req.params.id);
        if (!session) return reply.status(404).send({ error: 'unknown_session' });

        const stt = buildStt();
        const format = String(req.headers['content-type'] ?? '').includes('wav') ? 'wav' : 'webm';
        const transcription = await stt.transcribe(audio, {
          format,
          languageHint: session.conversationState.currentLanguage,
        });
        const decision = normalizeVoiceTranscript(transcription);

        if (!decision.accepted) {
          return reply.status(422).send({ error: 'untrusted_transcript', reason: decision.reason });
        }

        const result = await processBrowserMessage(req.params.id, decision.text);

        const tts = buildTtsForLanguage(result.language);
        const audioReply = await tts.synthesize(result.replyText, result.language);

        return reply.send({
          transcript: decision.text,
          detectedLanguage: transcription.detectedLanguage ?? null,
          reply: result.replyText,
          replyLanguage: result.language,
          audioBase64: audioReply.toString('base64'),
        });
      } catch (err) {
        req.log.error(err, 'voice session audio-message failed');
        return reply.status(500).send({ error: 'audio_session_error', message: (err as Error).message });
      }
    });
  });
}
