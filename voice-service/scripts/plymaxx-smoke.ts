/**
 * Live end-to-end check of the self-hosted Plymaxx providers, through the real
 * provider factories rather than raw HTTP — so it exercises exactly what a
 * call would.
 *
 * Load the credentials into this process first, then run it:
 *   . 'C:\Users\JITENDRA\.config\plymaxx-voicebot\Use-PlymaxxAI.ps1'
 *   npm run smoke:plymaxx
 *
 * It makes real GPU requests. It never prints the API key, and it never
 * touches orders, payments or any customer record.
 */

// Everything below is loaded with dynamic import(), after the environment is
// prepared. This marks the file as a module so top-level await is allowed.
export {};

// Config validates the whole service at import time, so satisfy the unrelated
// required fields before importing anything that pulls it in.
const PLACEHOLDERS: Record<string, string> = {
  PUBLIC_APP_URL: 'http://localhost:5173',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'smoke',
  OPENAI_API_KEY: 'smoke',
  RAZORPAY_KEY_ID: 'rzp_test_smoke',
  RAZORPAY_KEY_SECRET: 'smoke',
  RAZORPAY_WEBHOOK_SECRET: 'smoke',
  RESEND_API_KEY: 'smoke',
  RESEND_FROM_EMAIL: 'smoke@example.com',
  TOKEN_SIGNING_SECRET: 'smoke-token-signing-secret',
  PII_ENCRYPTION_KEY: '0'.repeat(64),
};
for (const [key, value] of Object.entries(PLACEHOLDERS)) process.env[key] ??= value;

if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY) {
  console.error('AI_BASE_URL/AI_API_KEY are not set. Load the credential helper into this process first.');
  process.exit(1);
}
process.env.LLM_PROVIDER = 'plymaxx';
process.env.STT_PROVIDER = 'plymaxx';
process.env.TTS_PROVIDER = 'plymaxx';

const { config } = await import('../src/config.js');
const { buildLLM, buildStt, buildTtsForLanguage } = await import('../src/providers.js');
const { parseWav, writeWav } = await import('../src/adapters/wav-utils.js');
const { mulawByteToPcm16 } = await import('../src/telephony/mulaw.js');
const { splitForSynthesis } = await import('../src/adapters/plymaxx-tts.js');

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

const base = config.AI_BASE_URL!.replace(/\/$/, '');
const auth = { Authorization: `Bearer ${config.AI_API_KEY}` };

// 1. The configured models and voices must actually exist on the server.
// Hard-coding a voice that was removed would otherwise fail mid-call.
{
  const models = (await (await fetch(`${base}/models`, { headers: auth })).json()) as { data?: { id: string }[] };
  const voices = (await (await fetch(`${base}/audio/voices`, { headers: auth })).json()) as {
    data?: { id: string; model: string; language?: string; aliases?: string[] }[];
  };
  const modelIds = new Set((models.data ?? []).map((m) => m.id));
  const voiceList = voices.data ?? [];

  const wanted: { label: string; model: string; voice?: string }[] = [
    { label: 'stt en', model: config.AI_STT_MODEL_EN },
    { label: 'stt hi', model: config.AI_STT_MODEL_HI },
    { label: 'stt gu', model: config.AI_STT_MODEL_GU },
    { label: 'tts en', model: config.AI_TTS_MODEL_EN, voice: config.AI_TTS_VOICE_EN },
    { label: 'tts hi', model: config.AI_TTS_MODEL_HI, voice: config.AI_TTS_VOICE_HI },
    { label: 'tts gu', model: config.AI_TTS_MODEL_GU, voice: config.AI_TTS_VOICE_GU },
  ];

  const missing: string[] = [];
  for (const want of wanted) {
    if (!modelIds.has(want.model)) missing.push(`${want.label}: model ${want.model}`);
    if (want.voice) {
      const known = voiceList.some(
        (v) => v.model === want.model && (v.id === want.voice || (v.aliases ?? []).includes(want.voice!)),
      );
      if (!known) missing.push(`${want.label}: voice ${want.voice} for ${want.model}`);
    }
  }
  record(
    'configured models/voices exist in the live catalogue',
    missing.length === 0,
    missing.length === 0
      ? `${modelIds.size} models, ${voiceList.length} voices; all ${wanted.length} configured choices found`
      : `missing -> ${missing.join('; ')}`,
  );
}

// 2 + 3. Synthesis, then recognition of that same audio, for every language
// this product speaks — including English, which now runs on the GPU too.
const SAMPLES: { language: 'en' | 'hi' | 'gu'; text: string; script: RegExp }[] = [
  { language: 'en', text: 'Yes, we ship across India.', script: /[A-Za-z]/ },
  { language: 'hi', text: 'नमस्ते, मोरिंगा पाउडर की कीमत क्या है?', script: /[\u0900-\u097F]/ },
  { language: 'gu', text: 'નમસ્તે, મોરિંગા પાવડરની કિંમત કેટલી છે?', script: /[\u0A80-\u0AFF]/ },
];

for (const sample of SAMPLES) {
  const started = Date.now();
  const wav = await buildTtsForLanguage(sample.language).synthesize(sample.text, sample.language);
  const parsed = parseWav(wav);
  const seconds = parsed.pcm.length / (parsed.sampleRate * 2);
  record(
    `TTS ${sample.language}`,
    wav.subarray(0, 4).toString('ascii') === 'RIFF' && parsed.bitsPerSample === 16 && seconds > 0.3,
    `${wav.length}B WAV, ${parsed.sampleRate}Hz, ${parsed.numChannels}ch, ${seconds.toFixed(2)}s, ${Date.now() - started}ms`,
  );

  const sttStarted = Date.now();
  const transcription = await buildStt().transcribe(writeWav(parsed.pcm, parsed.sampleRate, 16, 1), {
    languageHint: sample.language,
    format: 'wav',
  });
  record(
    `STT ${sample.language} round trip`,
    transcription.text.length > 0 && sample.script.test(transcription.text),
    `${Date.now() - sttStarted}ms -> "${transcription.text}"`,
  );
}

// 4. Auto-detection: the first utterance of a call has no known language, and
// guessing wrong would corrupt the transcript.
{
  const wav = await buildTtsForLanguage('en').synthesize('Hello, I would like to place an order.', 'en');
  const parsed = parseWav(wav);
  const started = Date.now();
  const detected = await buildStt().transcribe(writeWav(parsed.pcm, parsed.sampleRate, 16, 1), { format: 'wav' });
  record(
    'STT auto-detect with no language hint',
    detected.detectedLanguage === 'en' && detected.text.length > 0,
    `${Date.now() - started}ms -> language=${detected.detectedLanguage} "${detected.text.slice(0, 80)}"`,
  );
}

// 5. Telephony stream: each model's own sample rate resampled to the 8 kHz
// mu-law the phone transport needs. Neither 22050 nor 44100 divides evenly.
for (const language of ['hi', 'en'] as const) {
  const started = Date.now();
  const tts = buildTtsForLanguage(language);
  let firstChunkMs = 0;
  let total = 0;
  let nonSilent = 0;
  const text = language === 'hi' ? 'नमस्ते, आपका ऑर्डर तैयार है।' : 'Your order is ready.';
  for await (const chunk of tts.synthesizeMulaw8kStream!(text, language)) {
    if (!firstChunkMs) firstChunkMs = Date.now() - started;
    total += chunk.length;
    for (const byte of chunk) if (Math.abs(mulawByteToPcm16(byte)) > 500) nonSilent++;
  }
  record(
    `TTS ${language} -> 8kHz mu-law stream`,
    total > 0 && nonSilent / total > 0.2 && total / 8_000 > 0.3,
    `${total}B = ${(total / 8_000).toFixed(2)}s of audio, first chunk ${firstChunkMs}ms, ${((nonSilent / total) * 100).toFixed(0)}% voiced`,
  );
}

// 6. The 400-character request ceiling.
{
  const long = 'यह एक लंबा उत्तर है जिसमें बहुत सारी जानकारी है। '.repeat(20);
  const chunks = splitForSynthesis(long);
  record(
    'long reply split under the 400-char limit',
    chunks.every((c) => c.length <= 400) && chunks.length > 1,
    `${long.length} chars -> ${chunks.length} ordered requests, longest ${Math.max(...chunks.map((c) => c.length))}`,
  );
}

// 7. The LLM, with grounding facts supplied the way the engine supplies them.
{
  const started = Date.now();
  const result = await buildLLM().chatWithTools(
    [
      {
        role: 'system',
        content:
          'You are Eva, the voice assistant for Earthora Farms (Gujarat, India). Answer only from the FACTS below, in one short spoken sentence.\n\nFACTS:\n- Earthora Farms ships within India only. There is no international shipping.',
      },
      { role: 'user', content: 'Do you ship internationally?' },
    ],
    [],
  );
  const text = result.kind === 'message' ? result.content : '';
  record(
    'LLM grounded answer (no confabulation)',
    result.kind === 'message' && /india/i.test(text) && !/united states|u\.s\./i.test(text),
    `${Date.now() - started}ms -> "${text.slice(0, 140)}"`,
  );
}

{
  const started = Date.now();
  const result = await buildLLM().chatWithTools(
    [
      { role: 'system', content: 'You are Earthora Farms\u2019 assistant. Use the supplied tools for order questions. Never invent an order status.' },
      { role: 'user', content: 'Where is my order EO-1042?' },
    ],
    [
      {
        name: 'get_order_status',
        description: 'Look up the status of a customer order by its order number.',
        parameters: {
          type: 'object',
          properties: { order_number: { type: 'string', description: 'Order number such as EO-1042' } },
          required: ['order_number'],
          additionalProperties: false,
        },
      },
    ],
  );
  const called = result.kind === 'tool_calls' ? result.calls[0] : undefined;
  let argumentsParse = false;
  if (called) {
    try {
      argumentsParse = typeof JSON.parse(called.argumentsJson) === 'object';
    } catch {
      argumentsParse = false;
    }
  }
  record(
    'LLM tool calling',
    result.kind === 'tool_calls' && called?.name === 'get_order_status' && argumentsParse,
    `${Date.now() - started}ms -> ${called ? `${called.name}(${called.argumentsJson})` : `kind=${result.kind}`}`,
  );
}

// 8. A rejected combination must fail loudly rather than substituting
// something plausible-sounding.
{
  // config is a frozen singleton, so this checks the server contract directly
  // rather than trying to reconfigure the adapter after import.
  const send = async (payload: Record<string, unknown>): Promise<number> => {
    const r = await fetch(`${base}${config.AI_SPEECH_URL}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await r.arrayBuffer();
    return r.status;
  };

  const unknownVoice = await send({ model: 'piper', voice: 'not-a-real-voice', language: 'hi', input: 'नमस्ते', response_format: 'pcm' });
  const mismatched = await send({ model: config.AI_TTS_MODEL_HI, voice: config.AI_TTS_VOICE_HI, language: 'gu', input: 'નમસ્તે', response_format: 'pcm' });
  record(
    'bad model/voice/language combinations are rejected, not substituted',
    unknownVoice === 422 && mismatched === 422,
    `unknown voice -> ${unknownVoice}, Hindi voice with language=gu -> ${mismatched} (both must be 422)`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('Failed: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
