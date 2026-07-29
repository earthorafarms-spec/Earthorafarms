import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import dotenv from "dotenv";
import { smartFloAdapter, CallStartEvent, AudioChunkEvent, CallEndEvent } from "./telephony/smartflo-adapter.js";
import { providerRouter } from "./speech/provider-router.js";
import { languageSelector } from "./speech/language-selector.js";
import { SupportedLanguage } from "./speech/types.js";

dotenv.config();

const port = parseInt(process.env.PORT || "8080", 10);

const server = Fastify({
  logger: {
    level: "info",
  },
});

// Track session language & phone
const callLanguages = new Map<string, SupportedLanguage>();
const callPhones = new Map<string, string>();

// Register Fastify plugins
await server.register(fastifyCors, { origin: true });
await server.register(fastifyWebsocket);

// Mount telephony adapter routes
smartFloAdapter.registerRoutes(server);

import { registerRazorpayWebhook } from "./payments/webhook.js";
registerRazorpayWebhook(server);

import { startExpiredOrdersJob } from "./jobs/expire-orders.js";
startExpiredOrdersJob();

import { agentOrchestrator } from "./agent/orchestrator.js";

// Wire adapter event handlers
smartFloAdapter.onCallStart(async (event: CallStartEvent) => {
  callPhones.set(event.callId, event.callerPhone);
  server.log.info(
    { callId: event.callId, callerPhone: event.callerPhone },
    `📞 [CALL STARTED] Incoming call from ${event.callerPhone} (Call ID: ${event.callId})`
  );

  // Play initial multilingual greeting via TTS
  try {
    const greetingText = languageSelector.getInitialGreetingText();
    const { tts } = providerRouter.getSpeechProvider();
    const audioBuffer = await tts.synthesize(greetingText, "en");
    smartFloAdapter.sendAudio(event.callId, audioBuffer);
  } catch (err: any) {
    server.log.warn({ err: err.message }, "Could not synthesize initial greeting audio");
  }
});

smartFloAdapter.onAudioChunk(async (event: AudioChunkEvent) => {
  server.log.info(
    { callId: event.callId, chunkSize: event.buffer.length },
    `🎙️ [AUDIO CHUNK] Received ${event.buffer.length} bytes for call ${event.callId}`
  );

  try {
    let currentLang = callLanguages.get(event.callId);
    const callerPhone = callPhones.get(event.callId) || "unknown";

    // If language is not set, run language detection flow
    if (!currentLang) {
      const { selectedLanguage, initialTranscript } = await languageSelector.detectOrConfirmLanguage(event.buffer);
      currentLang = selectedLanguage;
      callLanguages.set(event.callId, selectedLanguage);
      server.log.info({ callId: event.callId, language: selectedLanguage, transcript: initialTranscript }, `🗣️ [LANG DETECTED] ${selectedLanguage.toUpperCase()} ("${initialTranscript}")`);

      // Initialize orchestrator session with detected language
      await agentOrchestrator.startSession(event.callId, callerPhone, selectedLanguage);

      if (initialTranscript.trim()) {
        await agentOrchestrator.processUserUtterance(event.callId, initialTranscript);
      }
      return;
    }

    // Transcribe via active STT provider
    const { stt } = providerRouter.getSpeechProvider();
    const result = await stt.transcribe(event.buffer, currentLang);

    if (result.text.trim()) {
      server.log.info({ callId: event.callId, text: result.text }, `📝 [TRANSCRIPTION] ${result.text}`);

      // Pass user utterance to LLM Orchestrator for tool calling & voice response
      await agentOrchestrator.processUserUtterance(event.callId, result.text);
    }
  } catch (err: any) {
    server.log.error({ callId: event.callId, error: err.message }, "Error processing audio chunk");
  }
});

smartFloAdapter.onCallEnd(async (event: CallEndEvent) => {
  callLanguages.delete(event.callId);
  callPhones.delete(event.callId);
  await agentOrchestrator.endSession(event.callId, event.reason);
  server.log.info(
    { callId: event.callId, reason: event.reason },
    `📴 [CALL ENDED] Call ${event.callId} disconnected (${event.reason || "normal release"})`
  );
});

// Health check endpoint with provider status
server.get("/health", async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "Earthora Voice Agent Server",
    telephonyProvider: "Tata SmartFlo",
    providers: providerRouter.getProviderStatus(),
  };
});

// Start listening
try {
  await server.listen({ port, host: "0.0.0.0" });
  console.log(`\n=================================================`);
  console.log(`🚀 Earthora Voice Agent Server running on port ${port}`);
  console.log(`📡 Health Check: http://localhost:${port}/health`);
  console.log(`📞 Webhook: POST http://localhost:${port}/webhooks/smartflo/incoming-call`);
  console.log(`🎧 Audio Stream: WS ws://localhost:${port}/ws/smartflo/stream`);
  console.log(`=================================================\n`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
