import { z } from 'zod';

// Required at boot — the service cannot run at all without these.
const requiredSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_APP_URL: z.string().min(1, 'PUBLIC_APP_URL is required (used for CORS + email links)'),
  LOG_LEVEL: z.string().default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Vendor-neutral provider seams — see src/providers.ts. Selecting by env
  // var (rather than importing a vendor SDK directly wherever it's used)
  // means adding/switching a provider is an env change + a new class, not a
  // conversation-engine refactor — see the OpenAI <-> Sarvam swap, which
  // needed zero changes to conversation/controller.ts.
  // 'auto' = per-turn routing (see providers.ts): Sarvam for Hindi/Gujarati
  // (purpose-built for Indian languages, per testing), OpenAI for English
  // and as a fallback if Sarvam errors mid-conversation (e.g. a billing
  // lapse) — a routing failure should degrade to "answers in English"
  // rather than break the caller's turn outright.
  LLM_PROVIDER: z.enum(['openai', 'sarvam', 'auto']).default('openai'),
  // Default 'sarvam' — it's the real, working implementation (Google stays
  // an unconfigured stub pending credentials; see google-stt.ts/-tts.ts).
  STT_PROVIDER: z.enum(['google', 'sarvam']).default('sarvam'),
  // 'auto' = English → OpenAI TTS (nova voice, much better English than
  // bulbul:v3), Hindi/Gujarati → Sarvam TTS. Mirrors LLM_PROVIDER=auto logic.
  TTS_PROVIDER: z.enum(['google', 'sarvam', 'openai', 'auto']).default('auto'),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().min(1),

  TOKEN_SIGNING_SECRET: z.string().min(16, 'TOKEN_SIGNING_SECRET must be at least 16 characters'),
  PII_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'PII_ENCRYPTION_KEY must be 64 hex chars (32 bytes) for AES-256-GCM'),
  VOICE_CHECKOUT_TTL_MINUTES: z.coerce.number().int().positive().default(30),
});

// Optional — missing values only disable specific features (Google STT/TTS),
// they never crash the process.
const optionalSchema = z.object({
  // Only required when LLM_PROVIDER=sarvam — see src/providers.ts, which
  // throws a clear "not configured" error rather than a confusing SDK
  // failure if this is unset and sarvam is selected.
  SARVAM_API_KEY: z.string().optional(),
  // sarvam-30b was deprecated server-side (confirmed live, 2026-08-21) —
  // sarvam-105b is the current default. Check Sarvam's dashboard/docs before
  // assuming this default is still current; their model lineup moves fast.
  SARVAM_MODEL: z.string().default('sarvam-105b'),
  // Pin STT instead of inheriting a moving SDK/server default.
  SARVAM_STT_MODEL: z.enum(['saaras:v3', 'saaras:v4']).default('saaras:v3'),
  SARVAM_STT_MIN_LANGUAGE_PROBABILITY: z.coerce.number().min(0).max(1).default(0.6),
  // Voice name for Sarvam TTS (bulbul:v3). Defaults to "neha" rather than
  // Sarvam's own default ("shubh") — "neha" is the voice a reference project
  // (D:\Work\Sun\Agent) landed on after direct comparison; override here to
  // try another (e.g. "shubh", "priya", "rahul").
  SARVAM_TTS_SPEAKER: z.string().default('neha'),
  VOICE_STT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  VOICE_LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  VOICE_TTS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  VOICE_SPEECH_RMS_THRESHOLD: z.coerce.number().int().min(50).max(5_000).default(600),
  // Public bot socket advertised to the voice platform's dynamic resolver.
  // Example: wss://voice.example.com/ws/voice/smartflo
  VOICE_STREAM_PUBLIC_WSS_URL: z.string().url().refine((url) => url.startsWith('wss://'), {
    message: 'VOICE_STREAM_PUBLIC_WSS_URL must use wss://',
  }).optional(),

  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),
  GOOGLE_STT_LANGUAGE_CODE: z.string().default('en-IN'),
  GOOGLE_TTS_LANGUAGE_CODE: z.string().default('en-IN'),
  GOOGLE_TTS_VOICE_NAME: z.string().optional(),
  // Base URL of the main storefront's Netlify deploy, used only to fire the
  // existing send-invoice function after a voice order finalizes. Optional —
  // if unset, invoices can still be resent manually from the admin portal.
  MAIN_APP_NETLIFY_URL: z.string().url().optional(),

  // WhatsApp Business Cloud API (Meta). All three must be set for WhatsApp
  // routes to register; if any is absent the /whatsapp/* routes are skipped.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(), // from Meta developer portal
  WHATSAPP_TOKEN: z.string().optional(),            // permanent or system-user token
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),     // chosen by you, used for webhook setup
  WHATSAPP_APP_SECRET: z.string().optional(),       // app secret for HMAC signature verification

  // Tata SmartFlow SMS — same credentials as the send-sms-alert Supabase Edge
  // function. All three must be set for SMS delivery to work; if any is absent,
  // SMS is skipped gracefully and only email (Resend) is sent.
  SMARTFLOW_API_KEY: z.string().optional(),
  SMARTFLOW_SENDER_ID: z.string().optional(),
  // Empty string means "not configured" — treat same as absent.
  SMARTFLOW_BASE_URL: z.string().url().optional().or(z.literal('')),
});

export type Config = z.infer<typeof requiredSchema> & z.infer<typeof optionalSchema> & {
  googleSttTtsConfigured: boolean;
  smartflowConfigured: boolean;
  whatsappConfigured: boolean;
};

function loadConfig(): Config {
  const required = requiredSchema.safeParse(process.env);
  if (!required.success) {
    // eslint-disable-next-line no-console
    console.error('[config] Missing/invalid required environment variables:');
    for (const issue of required.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('voice-service cannot start: invalid configuration. See errors above.');
  }

  const optional = optionalSchema.parse(process.env);
  const googleSttTtsConfigured = Boolean(
    optional.GOOGLE_CLOUD_PROJECT_ID && optional.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );

  if (!googleSttTtsConfigured) {
    // eslint-disable-next-line no-console
    console.warn('[config] Google Cloud STT/TTS credentials not set — Google STT/TTS unavailable (fine, Sarvam is the default provider for both).');
  }
  if ((required.data.STT_PROVIDER === 'sarvam' || required.data.TTS_PROVIDER === 'sarvam') && !optional.SARVAM_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[config] STT/TTS_PROVIDER=sarvam but SARVAM_API_KEY is unset — voice routes will fail until it is set.');
  }

  const smartflowConfigured = Boolean(
    optional.SMARTFLOW_API_KEY &&
    optional.SMARTFLOW_SENDER_ID &&
    optional.SMARTFLOW_BASE_URL &&
    optional.SMARTFLOW_BASE_URL.startsWith('http')
  );

  const whatsappConfigured = Boolean(
    optional.WHATSAPP_PHONE_NUMBER_ID &&
    optional.WHATSAPP_TOKEN &&
    optional.WHATSAPP_VERIFY_TOKEN
  );

  if (whatsappConfigured) {
    // eslint-disable-next-line no-console
    console.info('[config] WhatsApp channel enabled.');
  }

  return { ...required.data, ...optional, googleSttTtsConfigured, smartflowConfigured, whatsappConfigured };
}

export const config = loadConfig();
