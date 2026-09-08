import 'dotenv/config';
import WebSocket from 'ws';
import { SarvamSttAdapter } from '../src/adapters/sarvam-stt.js';
import { SarvamTtsAdapter } from '../src/adapters/sarvam-tts.js';
import { pcm16ToWav } from '../src/telephony/audio-accumulator.js';
import { mulaw8kToPcm16k } from '../src/telephony/mulaw.js';
import type { SupportedLanguage } from '../src/conversation/language.js';

const socketUrl = process.env.SMOKE_WSS_URL ?? 'wss://earthorafarms.onrender.com/ws/voice/smartflo';
const requestedSmokeLanguage = process.env.SMOKE_LANGUAGE;
const callerLanguage: SupportedLanguage = requestedSmokeLanguage === 'hi' || requestedSmokeLanguage === 'gu'
  ? requestedSmokeLanguage : 'en';
const DEFAULT_CALLER_PHRASE: Record<SupportedLanguage, string> = {
  en: 'What products are available at Earthora Farms?',
  hi: 'Earthora Farms में कौन सा प्रोडक्ट उपलब्ध है?',
  gu: 'Earthora Farms માં કયું પ્રોડક્ટ ઉપલબ્ધ છે?',
};
const callerPhrase = process.env.SMOKE_CALLER_PHRASE ?? DEFAULT_CALLER_PHRASE[callerLanguage];
const speakBeforeGreeting = process.env.SMOKE_EARLY_SPEECH === 'true';
const callSid = `codex-smoke-${Date.now()}`;
const streamSid = `codex-stream-${Date.now()}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 30_000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

async function main(): Promise<void> {
  const tts = new SarvamTtsAdapter();
  const stt = new SarvamSttAdapter();
  const callerMulaw = await tts.synthesizeMulaw8k(callerPhrase, callerLanguage);
  const ws = new WebSocket(socketUrl);
  const messages: Array<Record<string, any>> = [];
  ws.on('message', (raw) => messages.push({ ...JSON.parse(raw.toString()), receivedAt: Date.now() }));
  await waitForOpen(ws);

  ws.send(JSON.stringify({ event: 'connected' }));
  ws.send(JSON.stringify({
    event: 'start', streamSid,
    start: {
      streamSid, callSid, direction: 'inbound',
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000 },
    },
  }));

  const waitForMark = async (prefix: string, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mark = messages.find((message) => message.event === 'mark' && message.mark?.name?.startsWith(prefix));
      if (mark) return mark;
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${prefix} mark; events=${messages.map((m) => m.event).join(',')}`);
  };

  let inboundChunk = 1;
  let callerAudioFinishedAt = 0;
  const sendCallerAudio = async () => {
    for (let offset = 0; offset < callerMulaw.length; offset += 800) {
      const frame = callerMulaw.subarray(offset, Math.min(offset + 800, callerMulaw.length));
      ws.send(JSON.stringify({
        event: 'media', streamSid,
        media: { payload: frame.toString('base64'), chunk: String(inboundChunk++), timestamp: String(offset / 8) },
      }));
      await sleep(100);
    }
    // Production waits 1.1s of trailing silence before finalizing a turn so
    // natural pauses and grouped phone digits are not split. Send a little
    // more than that here so this probe exercises the real boundary.
    for (let i = 0; i < 12; i++) {
      ws.send(JSON.stringify({
        event: 'media', streamSid,
        media: { payload: Buffer.alloc(800, 0xff).toString('base64'), chunk: String(inboundChunk++), timestamp: String(callerMulaw.length / 8 + i * 100) },
      }));
      await sleep(100);
    }
    callerAudioFinishedAt = Date.now();
  };

  if (speakBeforeGreeting) await sendCallerAudio();
  const greetingMark = await waitForMark('greeting-', 45_000);
  const greetingAudioBytes = messages
    .filter((message) => message.event === 'media' && message.media?.payload)
    .reduce((sum, message) => sum + Buffer.from(message.media.payload, 'base64').length, 0);
  ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: greetingMark.mark.name } }));
  messages.length = 0;

  if (!speakBeforeGreeting) await sendCallerAudio();

  const responseMark = await Promise.race([
    waitForMark('reply-', 60_000),
    waitForMark('repeat-', 60_000),
  ]);
  const responseMulaw = Buffer.concat(
    messages.filter((message) => message.event === 'media' && message.media?.payload)
      .map((message) => Buffer.from(message.media.payload, 'base64'))
  );
  const firstResponseMediaAt = messages.find((message) => message.event === 'media' && message.media?.payload)?.receivedAt ?? null;
  ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: responseMark.mark.name } }));
  ws.send(JSON.stringify({ event: 'stop', streamSid, stop: { callSid, reason: 'codex_production_smoke' } }));
  await sleep(300);
  ws.close();

  if (responseMulaw.length === 0) throw new Error('No bot audio received');
  const botTranscript = await stt.transcribe(pcm16ToWav(mulaw8kToPcm16k(responseMulaw)), {
    format: 'wav', languageHint: callerLanguage,
  });
  console.log(JSON.stringify({
    socketUrl, callSid, callerLanguage, callerPhrase, speakBeforeGreeting, greetingAudioBytes,
    botMark: responseMark.mark.name,
    responseFirstAudioMs: firstResponseMediaAt === null || callerAudioFinishedAt === 0
      ? null
      : firstResponseMediaAt - callerAudioFinishedAt,
    outboundAudioBytes: responseMulaw.length,
    botTranscript: botTranscript.text,
    detectedLanguageCode: botTranscript.detectedLanguageCode,
    languageProbability: botTranscript.languageProbability,
  }, null, 2));
}

await main();
// Sarvam's HTTP client keeps an idle connection alive for roughly 30 seconds.
// This is a one-shot CLI probe, so exit after stdout has been emitted instead
// of making deploy verification wait for that unrelated keep-alive timer.
process.exit(0);
