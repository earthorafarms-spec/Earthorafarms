# Earthora Voice Ordering Agent — `voice-service`

A standalone Node.js/TypeScript service that powers a voice/text ordering assistant for
[Earthora Farms](../README.md). It talks to the same Supabase project as the main storefront
(`../src`) but runs as its own deploy target (Render), keeping server-only secrets (OpenAI,
Razorpay, Supabase service-role key) out of the browser bundle entirely.

Full product/architecture spec: [`../earthora-voice-agent-build-pack/`](../earthora-voice-agent-build-pack/).

## Scope of this build

Implements Phases 0–4 of the spec:

- **Phase 0** — this scaffolding.
- **Phase 1** — data model (`supabase/migrations/20260901000000_voice_agent_schema.sql`) and
  domain services (product/knowledge lookup, cart, server-side pricing).
- **Phase 2** — the conversation engine: GPT-4o mini with strict tool-calling, grounded only in
  live Supabase data and approved knowledge-base entries. **Text-mode only** — see below.
- **Phase 3** — the secure, editable verification form (`../src/pages/voice-checkout.tsx`) that a
  customer opens from a link sent to their WhatsApp number. This is the *only* confirmation step; the agent never
  reads the full order back verbally.
- **Phase 4** — Razorpay Payment Links, a signature-verified webhook, and an idempotent
  transactional finalizer that is the *only* code path allowed to write to the real
  `orders`/`order_items`/`Payments`/`Order_history` tables.

The ordering flow is intentionally sequential: the agent collects the cart and delivery details,
sends only the editable review form on WhatsApp, and ends the conversation. The customer can change
their details and cart in that form. The server recalculates and freezes the price after the reviewed
form is saved; only the form's explicit confirmation action can create and open a Razorpay Payment Link.
For voice-call follow-ups, configure an approved Meta WhatsApp template through
`WHATSAPP_CHECKOUT_TEMPLATE_NAME`; its body must contain one text placeholder for the secure form URL.

**Phase 5 (Tata Smartflo telephony) is explicitly out of scope for this build.** `src/adapters/tata-smartflo.ts`
exists only as an empty adapter seam — do not implement it until real Tata Smartflo account
credentials and API documentation are available. Do not guess at that API surface.

## Voice

Incoming speech uses OpenAI transcription by default (`STT_PROVIDER=openai`), so English calls do
not depend on Sarvam availability. In `TTS_PROVIDER=auto`, English uses OpenAI TTS while Hindi and
Gujarati prefer Sarvam and fall back to OpenAI TTS if Sarvam is unavailable. `src/adapters/google-stt.ts` and
`src/adapters/google-tts.ts` remain real adapter interfaces with stub implementations (`"not
configured"`, no fake audio logic) as a second seam in case Google credentials arrive later — the
conversation controller never needs to change either way.

There are two ways to talk to the agent, both hitting the exact same conversation engine, grounding,
and safety checks:

- **`public/harness.html`** — text-mode only, typed messages in and out. Useful for fast iteration
  on prompts/tools without burning STT/TTS calls.
- **`public/voice-stream.html`** — a real live call: press once to connect, then just talk. No
  push-to-talk button. The browser streams raw PCM16 16kHz audio continuously over a WebSocket
  (`GET /ws/voice/session/:id`) to the server, which runs it through `AudioAccumulator`
  (`src/telephony/audio-accumulator.ts`) — an RMS-energy silence detector that decides utterance
  boundaries on its own, the same underlying idea as the reference project at `D:\Work\Sun\Agent`
  but reimplemented clean for this system (see that file's header comment). Barge-in is
  client-driven: the page stops its own audio playback the instant it detects itself producing
  speech-level input again — a plain energy-threshold gate, not a neural VAD model. The older
  batch upload-and-wait route (`POST /voice/session/:id/audio-message`, hold-to-talk) still exists
  in `src/routes/voice.ts` for callers that can't do a persistent WebSocket.

## WhatsApp ordering chatbot

WhatsApp is a third transport over that same conversation engine. It does not
maintain a second catalogue or create orders directly:

1. `POST /whatsapp/webhook` authenticates the callback and stores each provider
   message id in `whatsapp_message_events`.
2. A database-backed worker claims messages with `FOR UPDATE SKIP LOCKED`,
   deduplicates provider message ids, and preserves each customer's message
   order across retries and multiple Render instances.
3. The shared product, knowledge, cart, language and checkout tools fetch live
   Supabase data on every relevant turn.
4. After delivery details are complete, the existing secure review form is sent
   in WhatsApp. The chatbot never creates an order or marks a payment successful.
5. Review-form confirmation creates a Razorpay Payment Link. The signed payment
   webhook and `finalize_voice_order` transaction write to the same order tables
   shown in the admin portal.

Apply these SQL files in order before enabling the callback:

1. `supabase/migrations/schema_website.sql`
2. `supabase/migrations/schema_agent.sql`
3. `supabase/migrations/whatsapp_sessions.sql`
4. `supabase/migrations/20260905000000_whatsapp_chatbot_inbox.sql`

For Tata Omni, set `WHATSAPP_PROVIDER=tata_omni`, `TATA_OMNI_ACCESS_TOKEN`,
`WHATSAPP_CHECKOUT_TEMPLATE_NAME`, and a random 16+ character
`TATA_OMNI_WEBHOOK_SECRET`. In Omni, set the Additional Callback URL to:

```text
https://<voice-service-host>/whatsapp/webhook
```

Configure Tata to send an `X-Webhook-Secret` header with the same secret. If
your Omni account cannot add callback headers, use a Tata-supported gateway or
authentication mechanism before enabling the endpoint; do not expose an
unauthenticated callback. The status callback can use the same endpoint;
delivery receipts are acknowledged and ignored.
The public Tata setup guide does not publish a fixed incoming-message JSON
schema, so `../whatsapp-chatbot/inbound.ts` is the isolated normalization
boundary. Save one redacted real callback fixture and add it to
`tests/unit/whatsapp-inbound.test.ts` before production launch. All WhatsApp
transport code lives together in the top-level `whatsapp-chatbot/` folder; it imports the shared
conversation and checkout engine instead of duplicating business logic.

For direct Meta Cloud API, use `WHATSAPP_PROVIDER=meta` and configure the phone
number id, permanent token, verification token and app secret. Subscribe Meta's
messages webhook to the same URL. Meta callbacks are verified against the exact
raw request bytes using `X-Hub-Signature-256`.

### Tata/VOICE Streaming WebSocket

The service also exposes a telephony-compatible bidirectional socket at
`wss://<voice-service-host>/ws/voice/smartflo`. This is the URL to configure as a **Static**
VOICE Bot endpoint. It implements the documented `connected`, `start`, `media`, `stop`, `mark`,
and `clear`-compatible flow, converts inbound G.711 mu-law/8 kHz audio to PCM16/16 kHz for Sarvam
STT, and converts Sarvam TTS WAV output back to 160-byte G.711 mu-law frames.

For a **Dynamic** endpoint, configure `GET` or `POST`
`https://<voice-service-host>/voice/stream/endpoint`. It returns the platform's exact required
payload (`sucess` is intentionally misspelled in that external contract). Set
`VOICE_STREAM_PUBLIC_WSS_URL=wss://<voice-service-host>/ws/voice/smartflo` in production so the
resolver always advertises the canonical public hostname.

Do not use a LiveKit server's `wss://` signaling URL as the VOICE Bot endpoint: LiveKit speaks its
own room/signaling protocol, while the telephony platform sends JSON media events and base64
G.711 audio. If LiveKit is also self-hosted, keep its URL for LiveKit clients and use this bridge
URL for the VOICE Bot connection.

## Known, accepted tradeoff: pricing logic duplication

GST/coupon/festival-deal pricing logic is reimplemented here in `src/domain/pricing.ts` rather than
imported from the main app, because there is no shared package between this service (Node/Render)
and the main app (Vite/Netlify) — introducing one would be a bigger structural change than this
feature warrants. The source of truth to stay in sync with:

- GST split: `../src/pages/checkout.tsx` (`gstBreakdown` calculation)
- Festival deal discounting: `../src/lib/api.ts` (`mapProduct`)

`tests/fixtures/pricing-cases.json` is a shared *data* fixture (not code) asserted against in
`tests/unit/pricing.test.ts` here — if you change a tax/discount rule in one place, update the
fixture and re-check the other implementation by hand.

## Local development

```bash
cd voice-service
npm install
cp .env.example .env   # fill in what you have; Google vars can stay blank
npm run dev
```

Then open `http://localhost:4000/harness.html` for text mode, or
`http://localhost:4000/voice-stream.html` for a real live call (needs mic permission and a
`SARVAM_API_KEY` set).

```bash
npm run typecheck
npm test
```

## Deploying

### Render service settings

For a manually created Render **Web Service**, use these settings even if Render
auto-detects a different runtime from the repository root:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root directory | `voice-service` |
| Build command | `npm ci --include=dev --no-audit --no-fund --loglevel=info && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |

`cargo build --release` is incorrect: this is a Node/TypeScript service and has no
`Cargo.toml`. The build explicitly installs dev dependencies because `tsup` is a
build-time dependency, even when `NODE_ENV=production`. Keep security auditing
as a separate check (`npm audit`), not a network dependency of the release build.

Set `PUBLIC_APP_URL` to the deployed storefront origin, never localhost.
Set `VOICE_STREAM_PUBLIC_WSS_URL` to
`wss://<this-render-service-host>/ws/voice/smartflo`. Point the telephony provider
at this same service (or its `/voice/stream/endpoint` resolver). Configure the
storefront's `VITE_VOICE_SERVICE_URL` with the backend HTTPS origin and rebuild
Netlify: Vite embeds this setting at build time.

Local `.env` changes do not update Render. Add the required secrets to this
service's environment, including the Tata token and Sarvam key pool when used.
`/health` and `/ready` do not verify external provider credentials or payments.
Free Render instances sleep when idle; use an approved paid compute plan for
always-on calling. Do not apply the repository-root Blueprint indiscriminately:
it also defines a separate, paid messaging-platform service.

### Sarvam credit failover

Set the server-only secret `SARVAM_API_KEYS` to an ordered comma-separated list.
It overrides `SARVAM_API_KEY`; leaving it blank retains single-key compatibility.
STT (including language-confidence retries), WAV/mu-law TTS, and Sarvam chat all
share one pool per service process. HTTP 402 credit failures retry the same request
with the next key. Exhausted slots are skipped across calls for five minutes
(`SARVAM_KEY_COOLDOWN_MS=300000`), then checked again to allow recovery after top-up.
Only slot numbers are logged, never credentials or caller audio/text.

Each request tries each eligible key at most once within its timeout budget.
There is no key rotation on 429 rate limits, 401/403 access failures, invalid
requests, network failures, or server errors. Once the pool has no funded keys,
it raises `SARVAM_CREDITS_EXHAUSTED` immediately during cooldown. Existing automatic
LLM/TTS routing can still fall back to OpenAI; explicit Sarvam STT has no cross-vendor
fallback. `STT_PROVIDER=openai` keeps transcription independent of Sarvam credits.

Keys on the same exhausted Sarvam balance do not provide extra credits. Add credits
or use independently funded, authorized keys; do not use rotation to evade account
limits. See [Sarvam billing](https://docs.sarvam.ai/api/platform/billing).

For Render, add `SARVAM_API_KEYS` as a secret on the **voice service**, then deploy
the updated backend. Updating the local ignored `.env` does not change Render.
The September 4 call logs showed deployed Sarvam STT returning 402 even though the
local/default transcription provider is OpenAI: verify the deployed provider setting
and code version too. No real API requests or customer messages are made by the
mocked failover regression tests.

See `render.yaml`. Set every secret in the Render dashboard (`sync: false` vars) — never commit
real credentials. `rootDir: voice-service` means this deploys independently of the main app's
Netlify deploy.
