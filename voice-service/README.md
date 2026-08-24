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
  customer opens from an emailed link. This is the *only* confirmation step; the agent never
  reads the full order back verbally.
- **Phase 4** — Razorpay Payment Links, a signature-verified webhook, and an idempotent
  transactional finalizer that is the *only* code path allowed to write to the real
  `orders`/`order_items`/`Payments`/`Order_history` tables.

**Phase 5 (Tata Smartflo telephony) is explicitly out of scope for this build.** `src/adapters/tata-smartflo.ts`
exists only as an empty adapter seam — do not implement it until real Tata Smartflo account
credentials and API documentation are available. Do not guess at that API surface.

## Voice

Speech-to-text and text-to-speech run for real via Sarvam AI (`src/adapters/sarvam-stt.ts`,
`src/adapters/sarvam-tts.ts`; `STT_PROVIDER`/`TTS_PROVIDER=sarvam`). `src/adapters/google-stt.ts` and
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

See `render.yaml`. Set every secret in the Render dashboard (`sync: false` vars) — never commit
real credentials. `rootDir: voice-service` means this deploys independently of the main app's
Netlify deploy.
