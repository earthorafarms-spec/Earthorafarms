# Earthora Farms — Voice Ordering Agent (Tata SmartFlo)
### Architecture + Phased Build Prompts for VS Code / Claude Code

This document is your complete build plan. Copy each **PROMPT** block, one at a time,
into Claude Code inside VS Code (in the same repo as `EarthoraFrams-PVT-LTD`). Do them in order —
each phase depends on the one before it. Don't paste all phases at once.

---

## 1. What we're actually building

Tata SmartFlo, on your plan, gives you **call routing + a webhook/API/SIP hook** — not a
no-code AI bot. SmartFlo's job is the phone line: it rings, connects to *your* server, and
streams audio back and forth. Everything else — STT, LLM decisions, TTS, ordering, payment —
lives in a system we build and host ourselves.

```
Caller
  │  (PSTN call)
  ▼
Tata SmartFlo  ──── webhook (call started) ────────────────────────┐
  │  (audio stream, WS or SIP)                                      │
  ▼                                                                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│               OUR VOICE AGENT SERVER (Node.js, always-on)             │
│                                                                        │
│  SmartFlo Adapter → STT Provider → LLM Orchestrator → TTS Provider   │
│                                          │                             │
│                              Tool functions:                           │
│                              list_products · check_stock               │
│                              create/modify/cancel_order                │
│                              get_order_status · search_knowledge       │
│                              initiate_payment                          │
└──────────────────────────────┬────────────────────────────────────────┘
                                ▼
               Supabase (same DB as the website)
               products / inventory / orders / users
                                ▼
               Razorpay Payment Links API
                                ▼
               SMS + WhatsApp → payment link to caller
                                ▼
         Razorpay webhook → payment.captured → order confirmed
```

**Key architectural fact:** this needs a server that stays alive and holds an open audio
connection for the duration of every call. Netlify Functions and Supabase Edge Functions are
serverless/short-lived — they **cannot** do this. We build a standalone **Node.js/TypeScript
server**, deployed to a platform that supports long-lived processes and WebSockets (Railway,
Render, or Fly.io). It talks to the **same Supabase project** your website uses, so adding or
removing a product on the website is automatically visible to the agent — nothing about the
catalog is ever hardcoded.

---

## 2. Key decisions

| Decision | Choice |
|---|---|
| Languages | English + Hindi + Gujarati |
| Payment link delivery | SMS **and** WhatsApp |
| Order modify/cancel by voice | Yes |
| Caller recognition | Match phone number to `User_details`; collect fresh details if not found |
| Order limits | No hard cap; agent repeats back and confirms anything over 50 units; blocks if over stock |
| Outbound calling | Not in scope (inbound only) |
| Unpaid orders | `pending_payment` status; auto-cancel after 24 h if unpaid |
| Primary AI provider | **Sarvam AI** (STT + LLM + TTS — built for Indian languages) |
| Fallback when Sarvam rate-limited | **Local PC** via Ollama (LLM) + faster-whisper (STT) + Piper (TTS), exposed via Cloudflare Tunnel |

---

## 3. Provider strategy: Sarvam primary, local PC fallback

### 3a. Primary — Sarvam AI

Sarvam AI is an Indian AI lab that offers a single API covering:
- **STT** (`saarika` model) — real Gujarati support, not just transliteration
- **LLM** (`sarvam-2b` or route to any model via their gateway)
- **TTS** (`bulbul` model) — natural-sounding Hindi and Gujarati voices

All three share one API key and one rate-limit bucket. When any one of them returns a 429
(rate limit) or 5xx, the server will transparently retry on the local fallback.

### 3b. Fallback — your local PC

| Layer | Local tool | Notes |
|---|---|---|
| STT | `faster-whisper` (large-v3) | Python HTTP server on port 8001. Decent Hindi, passable Gujarati — noticeably worse than Sarvam but functional. |
| LLM | Ollama (`qwen2.5:7b` recommended; your existing `gemma3:4b` also works) | Already running on your machine. Exposed on port 11434. |
| TTS | `Piper` | Fast neural TTS, Hindi voice pack available, Gujarati voice limited but exists. Runs on port 8002. |

Your existing chatbot already used Ollama+Gemma via a Supabase edge function, so you know the
setup. The new piece is faster-whisper and Piper — both are single commands to install and run.

### 3c. Tunnel (required for fallback to work)

The voice-agent-server runs in the cloud (Railway/Render). For it to reach your PC, you need
**Cloudflare Tunnel** (`cloudflared`) — a free tool that punches a stable HTTPS URL through to
your machine without needing a static IP or port-forwarding. You run one `cloudflared` command
on your PC; it stays open; the cloud server hits the tunnel URL.

```
Cloud voice-agent-server
        │
        │  HTTPS (via Cloudflare Tunnel)
        ▼
  your-tunnel.trycloudflare.com
        │
        ▼
  Your PC:
    :8001  faster-whisper STT
    :11434 Ollama LLM
    :8002  Piper TTS
```

**What this means for the build:** The server has a `SpeechProvider` interface and an
`LLMProvider` interface. At startup it tries Sarvam; on 429/5xx it switches to the local
fallback URLs (set via env vars `LOCAL_STT_URL`, `LOCAL_LLM_URL`, `LOCAL_TTS_URL`). When
Sarvam recovers (next health-check cycle, every 60s), it switches back.

---

## 4. What you need to do on your PC before Phase 4

Install the three local services (one-time setup — nothing in the code phases depends on this
being done first, but you'll need it for integration testing):

```bash
# faster-whisper (STT)
pip install faster-whisper flask
# then run: python local-services/whisper-server.py

# Piper TTS — download binary + voice model from https://github.com/rhasspy/piper/releases
# Hindi voice: hi_IN-hemant-medium
# Gujarati voice: gu_IN-bhagat-medium (if available) — check releases page
# then run: ./piper --model hi_IN-hemant-medium.onnx --output_raw | (pipe to HTTP server wrapper)

# Ollama — already installed, add the recommended model if you want:
ollama pull qwen2.5:7b

# Cloudflare Tunnel
brew install cloudflared   # macOS
# or download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8001  # one tunnel per service, or use a config file
```

Claude Code will generate a `local-services/` folder in Phase 4 with ready-to-run wrapper
scripts for faster-whisper and Piper, so you don't have to write those yourself.

---

## 5. Open items needed before Phase 3

Before we can wire the phone line, get these from **Tata SmartFlo's API docs** (ask their
support if not in your dashboard) and paste them into Claude Code when you reach Phase 3:
- Exact webhook payload when a call starts/ends (all fields, auth headers).
- How audio is streamed: WebSocket URL they connect to, or one you expose; codec + sample rate
  (commonly 8 kHz μ-law or 16 kHz PCM).
- How you send audio back (same socket, or a separate "play audio" API call).
- Whether DTMF (keypad) events are forwarded, for a fallback "press 1" option.
- Concurrent call limit on your plan.

Phases 1, 2, 4–8 do **not** depend on this — start immediately.

---

## 6. New Supabase schema needed

Migration file `supabase/migrations/03_voice_agent.sql`:

- **`call_sessions`** — one row per call: `id, caller_phone, language, started_at, ended_at,
  transcript JSONB, matched_user_email, outcome, order_id, ai_provider` (records whether
  Sarvam or local fallback handled the call — useful for monitoring).
- **`voice_orders`** — `order_id, payment_link_url, payment_link_id, payment_status, sent_via,
  customer_phone, created_at, expires_at (now()+24h), paid_at`.
- **`knowledge_base`** — `id, topic, question, answer, source_page`. Keyword-search only for
  now; comment notes pgvector can be added later if the dataset grows.
- Function `cancel_expired_voice_orders()` that finds unpaid orders past `expires_at` and
  inserts 'cancelled' into `Order_history` (existing trigger syncs to `orders.status`).

---

## 7. Phased build prompts

### Phase 0 — Repo setup (do yourself, 5 min)
Create `voice-agent-server/` as a new folder alongside the frontend. It will be its own
Node.js project (separate `package.json`), deployed separately from the Netlify site. The
Supabase project is shared between both.

---

### PROMPT — Phase 1: Database migration

```
Read supabase/migrations/01_schema.sql and 02_rls_policies.sql fully to understand the
existing schema conventions (naming style, RLS pattern, trigger pattern, GRANT pattern).

Create a new file supabase/migrations/03_voice_agent.sql that adds:

1. call_sessions table:
   - id UUID PK DEFAULT gen_random_uuid()
   - caller_phone TEXT NOT NULL
   - language TEXT CHECK (language IN ('en','hi','gu'))
   - started_at, ended_at TIMESTAMPTZ
   - transcript JSONB DEFAULT '[]'  -- array of {role, text, timestamp}
   - matched_user_email TEXT REFERENCES "User_details"(user_email) NULLABLE
   - outcome TEXT CHECK (outcome IN ('order_placed','order_modified','order_cancelled',
     'status_checked','faq_answered','abandoned','transferred'))
   - order_id TEXT REFERENCES orders(id) NULLABLE
   - ai_provider TEXT CHECK (ai_provider IN ('sarvam','local')) -- which stack handled the call
   - created_at TIMESTAMPTZ DEFAULT now()

2. voice_orders table:
   - id UUID PK DEFAULT gen_random_uuid()
   - order_id TEXT REFERENCES orders(id)
   - payment_link_url TEXT
   - payment_link_id TEXT  -- Razorpay payment link id
   - payment_status TEXT DEFAULT 'pending_payment'
     CHECK (payment_status IN ('pending_payment','paid','expired','failed','cancelled'))
   - sent_via TEXT CHECK (sent_via IN ('sms','whatsapp','both'))
   - customer_phone TEXT
   - created_at TIMESTAMPTZ DEFAULT now()
   - expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
   - paid_at TIMESTAMPTZ

3. knowledge_base table:
   - id SERIAL PK
   - topic TEXT
   - question TEXT
   - answer TEXT
   - source_page TEXT  -- e.g. '/health-benefits'
   - created_at TIMESTAMPTZ DEFAULT now()
   - updated_at TIMESTAMPTZ DEFAULT now()
   Add a comment: "pgvector embeddings can be added here later if dataset grows large"

4. A Postgres function cancel_expired_voice_orders() that:
   - Finds rows in voice_orders where payment_status = 'pending_payment' AND expires_at < now()
   - Updates them to payment_status = 'expired'
   - For each, inserts a row into "Order_history" with order_status = 'cancelled'
     (the existing trigger on Order_history syncs this to orders.status automatically)
   - Returns the count of orders cancelled

Follow all existing conventions:
- Extend the update_updated_at_column() trigger function's IF/ELSIF chain for the two new
  tables that have updated_at (knowledge_base and voice_orders).
- Enable RLS on all new tables; create permissive policies (FOR ALL USING (true)) matching
  the pattern in 01_schema.sql.
- GRANT ALL to anon, authenticated, service_role on all new tables.
- Do not modify 01_schema.sql or 02_rls_policies.sql.
```

---

### PROMPT — Phase 2: Knowledge base seeder

```
I need a script to populate the knowledge_base table with real site content so the voice agent
never invents health claims or policy details — it only answers using what's in this table.

1. Read these source files and extract factual, grounded content:
   - src/pages/health-benefits.tsx (moringa nutrition claims, comparison stats like "7x more
     Vitamin C than oranges", all keyBenefits and comparisonData arrays)
   - src/pages/products.tsx (product descriptions, usage instructions)
   - src/pages/recipes.tsx (if it contains usage/preparation content)
   - Any shipping/returns/contact policy text in src/pages/contact.tsx or layout components

2. Write scripts/seed-knowledge-base.mjs that:
   - Connects to Supabase via SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars
   - Upserts static Q&A rows into knowledge_base from the content above (topic/question/answer/
     source_page) — hardcode these based on what you read from the source files
   - Also fetches the live products table (name, description, health_benefits, usage_instructions,
     faqs JSONB, highlights) from Supabase and upserts one knowledge_base row per product FAQ
     item and per highlight — so re-running this script after a product edit keeps the knowledge
     base in sync
   - Add a comment: "Product PRICES and STOCK are NOT stored here — the voice agent always calls
     list_products() or check_product_stock() tools for live data. This table is qualitative
     content only."
   - Print a summary: X static rows upserted, Y product FAQ rows upserted

3. Add "seed:knowledge": "node scripts/seed-knowledge-base.mjs" to the root package.json scripts.
```

---

### PROMPT — Phase 3: Telephony adapter (SmartFlo)

```
[PASTE HERE: the SmartFlo webhook payload format, WebSocket/audio streaming spec, auth
mechanism, and codec/sample-rate details from their API docs — see section 5 of the plan]

Create the voice-agent-server/ project from scratch as a Node.js + TypeScript project.
Use Fastify (not Express — better WebSocket support) + the 'ws' package.

Structure:
  voice-agent-server/
    src/
      telephony/
        smartflo-adapter.ts
      index.ts
    .env.example
    package.json
    tsconfig.json

1. voice-agent-server/src/telephony/smartflo-adapter.ts:
   - HTTP POST endpoint: receives SmartFlo's incoming-call webhook, validates auth headers
     (per the docs I pasted above), extracts callId and callerPhone, emits onCallStart event.
   - WebSocket handler: receives inbound audio chunks, emits onAudioChunk(callId, Buffer).
     Has a sendAudio(callId, Buffer) function to play audio back to the caller.
   - Emits onCallEnd(callId) when the call disconnects.
   - The exported interface is purely: { onCallStart, onAudioChunk, onCallEnd, sendAudio } —
     nothing SmartFlo-specific leaks outside this file. This makes switching providers later
     a single-file change.

2. voice-agent-server/src/index.ts:
   - Starts the Fastify server, mounts the SmartFlo adapter.
   - Logs every event: call start (with caller phone), audio chunk received (chunk size in
     bytes, not the audio data itself), call end.
   - Has a GET /health endpoint returning {status: 'ok', timestamp}.
   - No STT/LLM/TTS yet — the goal of this phase is ONLY to prove SmartFlo reaches this
     server and streams audio. Log that proof clearly.

3. .env.example with: PORT, SMARTFLO_WEBHOOK_SECRET (and any other vars the adapter needs
   per the docs).

Keep this phase minimal — it's a connectivity test, not a working agent yet.
```

---

### PROMPT — Phase 4: Speech layer with Sarvam primary + local PC fallback

```
Build the entire speech layer for the voice agent with automatic failover between Sarvam AI
(primary) and local services running on my development PC (fallback when Sarvam is rate-limited
or unavailable).

Create voice-agent-server/src/speech/ with:

── Provider interfaces ──────────────────────────────────────────────────────────

src/speech/types.ts — define these TypeScript interfaces:
  interface STTProvider {
    transcribe(audioBuffer: Buffer, language?: 'en'|'hi'|'gu'): Promise<{text: string, detectedLang: string}>
  }
  interface TTSProvider {
    synthesize(text: string, language: 'en'|'hi'|'gu'): Promise<Buffer>  // returns audio in SmartFlo's expected format
  }
  interface LLMProvider {
    chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>
  }

── Sarvam implementations ───────────────────────────────────────────────────────

src/speech/sarvam-stt.ts — calls Sarvam's STT API (saarika model):
  - Accepts audio Buffer (convert from SmartFlo's codec to what Sarvam expects if needed)
  - Passes language hint if already detected, otherwise lets Sarvam auto-detect
  - Returns { text, detectedLang }
  - On 429 or 5xx: throws a SarvamRateLimitError (custom error class) so the router knows
    to switch to fallback

src/speech/sarvam-tts.ts — calls Sarvam's TTS API (bulbul model):
  - Takes text + language, returns audio Buffer in the correct format for SmartFlo
  - On 429/5xx: throws SarvamRateLimitError

src/speech/sarvam-llm.ts — calls Sarvam's LLM endpoint OR Anthropic's claude-sonnet-4-6:
  NOTE: Sarvam's own LLM (sarvam-2b) is weaker for complex multi-step tool-calling than
  Claude. Implement this as: try Sarvam's gateway first if SARVAM_USE_LLM=true in env,
  otherwise (default) use Anthropic claude-sonnet-4-6 directly. The fallback path uses
  Ollama. This way the STT/TTS rate-limit and the LLM rate-limit are handled independently.

── Local PC fallback implementations ───────────────────────────────────────────

src/speech/local-stt.ts — calls faster-whisper HTTP server running on my PC:
  - POST to LOCAL_STT_URL/transcribe (env var, e.g. http://your-tunnel.com/transcribe)
  - Body: { audio_base64, language }
  - Returns { text, detectedLang }

src/speech/local-tts.ts — calls Piper TTS HTTP server running on my PC:
  - POST to LOCAL_TTS_URL/synthesize (env var)
  - Body: { text, language }
  - Returns audio Buffer

src/speech/local-llm.ts — calls Ollama on my PC:
  - POST to LOCAL_LLM_URL/api/chat (env var, e.g. http://your-tunnel.com/api/chat)
  - Uses model from LOCAL_LLM_MODEL env var (default: 'qwen2.5:7b')
  - Must support the same tool-calling interface as the Sarvam/Anthropic path

── Also create local-services/ folder with ready-to-run Python scripts ─────────

local-services/whisper-server.py:
  - A minimal Flask HTTP server wrapping faster-whisper
  - POST /transcribe accepts { audio_base64, language }, returns { text, detectedLang }
  - Uses large-v3 model, runs on port 8001
  - Include a comment at top: "Run with: pip install faster-whisper flask && python whisper-server.py"

local-services/piper-server.py:
  - A minimal Flask HTTP server that calls the Piper binary as a subprocess
  - POST /synthesize accepts { text, language }, returns audio bytes
  - Runs on port 8002
  - Include a comment at top with the Piper download URL and voice model download commands
    for Hindi (hi_IN-hemant-medium) and the best available Gujarati model

── Provider router (the failover logic) ────────────────────────────────────────

src/speech/provider-router.ts — the key file. Exports:
  - getSpeechProvider(): returns the current active STT+TTS provider ('sarvam' | 'local')
  - getLLMProvider(): returns the current active LLM provider ('anthropic' | 'local-ollama')
  - A health-check loop that runs every 60 seconds: pings Sarvam's API; if it recovers after
    a rate-limit, switches back to primary automatically
  - Wraps all provider calls: on SarvamRateLimitError, marks Sarvam as degraded, logs a
    warning with estimated recovery time, and re-routes to local fallback for that call and
    all subsequent ones until the health-check recovers Sarvam
  - Exposes getProviderStatus() returning { stt, tts, llm, degradedSince } for the health
    endpoint

── Language selection flow ─────────────────────────────────────────────────────

src/speech/language-selector.ts:
  - On call start: play a short pre-recorded (or TTS-generated) greeting in all 3 languages:
    "Welcome to Earthora Farms. Please speak in English, Hindi, or Gujarati."
    "Earthora Farms mein aapka swagat hai. Hindi, English, ya Gujarati mein boliye."  
    "Earthora Farms maa aapnu swagat chhe. Gujarati, Hindi, ke English maa boliye."
  - Transcribe the caller's first response using STT with language auto-detection
  - Lock the session language based on what was detected
  - If language can't be determined: default to English and note it in call_sessions

── Wire into Phase 3 for testing ────────────────────────────────────────────────

Update voice-agent-server/src/index.ts to:
  - On onCallStart: run language selection flow, store chosen language
  - On onAudioChunk: transcribe via active STT provider, log the transcript to console
  - Echo the transcription back via active TTS provider using sendAudio — no LLM yet
  - This proves the full STT→TTS round trip works in all 3 languages before we add the agent

── .env.example additions ───────────────────────────────────────────────────────

Add to .env.example:
  SARVAM_API_KEY=
  SARVAM_USE_LLM=false          # set true to use Sarvam's own LLM instead of Anthropic
  ANTHROPIC_API_KEY=
  LOCAL_STT_URL=                # your Cloudflare Tunnel URL pointing to port 8001
  LOCAL_TTS_URL=                # your Cloudflare Tunnel URL pointing to port 8002
  LOCAL_LLM_URL=                # your Cloudflare Tunnel URL pointing to port 11434
  LOCAL_LLM_MODEL=qwen2.5:7b
```

---

### PROMPT — Phase 5: LLM conversation engine + tools

```
Read supabase/migrations/01_schema.sql fully (products, inventory, orders, order_items,
Order_history, User_details, Payments, voice_orders, knowledge_base tables and triggers).
Read src/pages/checkout.tsx to understand the exact order-creation and total-calculation flow.

Build voice-agent-server/src/agent/ — the conversation brain.

── System prompt ────────────────────────────────────────────────────────────────

src/agent/system-prompt.ts — exports buildSystemPrompt(language: 'en'|'hi'|'gu'):
  Agent name: "Mira" (warm, professional)
  Rules the prompt must include:
  - Respond ONLY in the caller's chosen language (passed in at runtime)
  - Keep all spoken responses to 1-2 short sentences — this is voice, not text
  - NEVER state a price, stock level, or health claim from memory — always call a tool
  - For quantities over 50 units: repeat the number back explicitly and require a verbal
    "yes" confirmation before proceeding to create_order
  - NEVER confirm an order is placed until create_order tool returns success
  - Only discuss Earthora Farms topics: products, orders, moringa health, shipping, returns
  - If asked anything unrelated: "I can only help with Earthora Farms orders and products."
  - After any tool error: apologize briefly and offer to continue or try again

── Tools ────────────────────────────────────────────────────────────────────────

src/agent/tools.ts — Anthropic tool-use schema + real Supabase implementations:
  (Use SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — service role, same project as the website)

  list_products()
    → SELECT products.id, slug, name, price, mrp, tag, description,
             inventory.total_stock - inventory.reserved_stock AS available_stock
      FROM products JOIN inventory ON products.id = inventory.product_id
      WHERE products.status = 'active'
    → Return as a spoken-friendly list (name, price, available yes/no)

  check_product_stock(slug: string)
    → Available stock for one product slug
    → If stock = 0: return out-of-stock message

  lookup_customer(phone: string)
    → SELECT * FROM "User_details" WHERE user_phone = $phone LIMIT 1
    → Returns { found: true, name, address, city, state, zip } or { found: false }

  save_customer_details(phone, name, address, city, state, zip, country?)
    → UPSERT into "User_details" matching user_phone
    → Validate: PIN code must be 6 digits for India (same regex as checkout.tsx)
    → Returns { success: true } or { success: false, error }

  create_order(userEmail: string, items: [{slug, quantity}], shippingAddress: object)
    → Validate stock for each item (recheck at create time, not just when browsing)
    → Compute total: sum of (products.price × quantity) — match checkout.tsx calculation exactly
    → INSERT into "Orders" one row per item (matching the schema exactly: order_user_id,
      order_product_id as UUID, order_product_quantity, order_product_price)
      The existing trigger sync_orders_trigger handles syncing to orders + order_items + inventory
    → Returns { success: true, orderId, total } or { success: false, error }

  get_order_status(identifier: string)
    → Try to find by order_id first, then by user email/phone via User_details join
    → JOIN orders with Order_history for full status timeline
    → Return human-readable status using the same status values as admin panel:
      pending → processing → packed → shipped → delivered | cancelled
    → Include estimated delivery if shipped

  modify_order(orderId: string, changes: { addItems?, removeItems?, updateQuantities? })
    → First check current status: only allow if status is 'pending' or 'processing'
    → If shipped/delivered/cancelled: return error "Order cannot be modified at this stage"
    → Apply changes to order_items, recompute total in orders table
    → Returns { success, newTotal } or { success: false, error, currentStatus }

  cancel_order(orderId: string)
    → Check status — only allow if 'pending' or 'processing'
    → INSERT into "Order_history" with order_status = 'cancelled'
      (existing trigger syncs to orders.status automatically)
    → If voice_orders row exists for this order: update payment_status = 'cancelled'
    → Returns { success } or { success: false, error, currentStatus }

  search_knowledge(query: string)
    → Full-text search: SELECT * FROM knowledge_base
      WHERE to_tsvector('english', question || ' ' || answer || ' ' || topic)
            @@ plainto_tsquery('english', $query)
      LIMIT 3
    → Return matched answers for the LLM to use verbatim
    → If no results: return { found: false } so LLM can say it doesn't know

  initiate_payment(orderId: string, customerPhone: string)
    → Stub for Phase 7 — for now: log "PAYMENT STUB: would send link to {phone} for order
      {orderId}" and return { success: true, stub: true, message: "Payment link will be sent" }

── Orchestrator ─────────────────────────────────────────────────────────────────

src/agent/orchestrator.ts:
  - Maintains a per-call conversation history (Message[]) in memory during the call
  - On each STT transcript received:
    1. Append { role: 'user', content: transcript } to history
    2. Append transcript to call_sessions.transcript in DB (JSONB push, don't overwrite)
    3. Call getLLMProvider().chat(history, tools) with the tools above
    4. If response contains tool_use blocks: execute each tool, append tool_result, call LLM again
    5. Get final text response, append to history and DB transcript
    6. Pass text to TTS → sendAudio to caller
  - On call end: update call_sessions with ended_at, outcome (infer from transcript), final
    order_id if an order was placed
  - Error handling: if any step fails, generate a brief apology message via TTS and keep the
    call alive — never let an exception silently kill the call
```

---

### PROMPT — Phase 6: Checkout-by-voice conversation flow

```
Read src/pages/checkout.tsx completely — pay attention to: required form fields (name, phone,
address, city, state, zip, country), validation rules for Indian PIN codes and phone numbers,
how the total is computed (base price × quantity, coupon deduction, any active festival
discounts), and how orders are written to the DB.

Refine the agent's checkout flow so it collects exactly the same information as the website
checkout, in a natural spoken order:

Step 1 — Item confirmation
  Agent reads back: "You'd like [X units of Product A] and [Y units of Product B]. Is that right?"
  Wait for explicit "yes" / "हाँ" / "હા" before proceeding.
  If quantity > 50: extra confirmation step: "Just to confirm — that's [N] units, which is
  [₹total]. Do you want to continue with that quantity?"

Step 2 — Customer details
  Call lookup_customer(callerPhone) first.
  If found: "I have your delivery address as [address], [city], [state] — [PIN]. Is that
  correct, or would you like to update it?"
  If not found: collect in order — full name → delivery address → city → state → PIN code
  Validate PIN as 6 digits. If invalid: ask again with a gentle correction prompt.
  "For your PIN code, I need 6 digits — for example, 380015."

Step 3 — Payment number confirmation
  "I'll send the payment link to [callerPhone]. Would you like it sent to a different number
  instead?" — allow them to provide an alternative number; validate Indian format.

Step 4 — Compute and read back total
  Check for active festival_details discount (query festive_deals view, same logic as
  checkout.tsx), apply if valid, explain the discount to caller.
  "Your total comes to ₹[amount] including [any discount]. Shall I confirm this order?"
  Require explicit verbal confirmation.

Step 5 — Place order
  Call create_order. On success: "Your order is confirmed — I'm sending a payment link to
  [phone] by SMS and WhatsApp right now. Complete the payment there and your order will be
  shipped within 3–7 business days."
  Call initiate_payment(orderId, phone) — stub in Phase 5, real in Phase 7.
  On failure: explain the issue briefly and offer to retry or speak to support.

Also handle modify_order and cancel_order conversational flows:
  Modify: "I found your order for [items]. What would you like to change?" → collect changes
  → read back new total → confirm → call modify_order.
  Cancel: "Your order is currently [status]. Are you sure you want to cancel it?" → explicit
  confirmation → call cancel_order → "Your order has been cancelled."

All confirmation phrases must work in English, Hindi, and Gujarati — write out the key
phrases in all three languages in system-prompt.ts so the LLM doesn't have to guess.
```

---

### PROMPT — Phase 7: Payment link + SMS/WhatsApp delivery

```
Read netlify/functions/create-razorpay-order.mjs and verify-razorpay-payment.mjs for the
existing Razorpay pattern and env var names (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET).
Read supabase/functions/send-sms-alert/index.ts for the Tata SMS/SmartFlow API pattern.

1. voice-agent-server/src/payments/razorpay-link.ts — createPaymentLink(params):
   Input: { orderId, amount (in rupees), customerName?, customerPhone?, customerEmail? }
   - Multiply amount × 100 for paise
   - POST to https://api.razorpay.com/v1/payment_links with:
     { amount (paise), currency: 'INR', description: `Earthora Farms Order #${orderId}`,
       customer: { name, contact, email }, notify: { sms: true, whatsapp: true },
       reminder_enable: true, callback_url: `${WEBSITE_URL}/order-confirmation?order=${orderId}`,
       callback_method: 'get' }
     Note: Razorpay's payment_links API has built-in SMS/WhatsApp notify — set both to true
     as a first layer. Our own send is a second layer (belt-and-suspenders).
   - INSERT into voice_orders: { order_id, payment_link_url, payment_link_id, payment_status:
     'pending_payment', customer_phone, expires_at: now()+24h }
   - Return { paymentLinkUrl, paymentLinkId }

2. voice-agent-server/src/payments/notify.ts — sendPaymentLink(phone, linkUrl, orderSummary):
   SMS path:
   - Reuse the same Tata SmartFlow SMS API pattern from send-sms-alert/index.ts
   - Env vars: SMARTFLOW_API_KEY, SMARTFLOW_SENDER_ID, SMARTFLOW_BASE_URL
   - Message: "Earthora Farms: Pay ₹{amount} for your order here: {linkUrl} — link expires in
     24 hours. Reply STOP to unsubscribe."

   WhatsApp path:
   - First check: does TATA_WHATSAPP_API_KEY env var exist? Tata Communications sometimes
     bundles WhatsApp Business API access — if the env var is set, use Tata's WhatsApp API.
   - If not: check META_WHATSAPP_TOKEN env var — use Meta WhatsApp Cloud API directly.
   - If neither is configured: log a warning "WhatsApp not configured — SMS only" and skip
     gracefully. Do NOT throw an error or block the order flow.
   - Update voice_orders.sent_via to 'sms', 'whatsapp', or 'both' accordingly.

   Add a note in the file: "Meta WhatsApp Cloud API requires a verified Meta Business account
   and approved message template. This is a separate approval process — if not yet approved,
   SMS alone works fine and WhatsApp can be enabled later without code changes."

3. voice-agent-server/src/payments/webhook.ts — Razorpay webhook receiver:
   - POST /webhooks/razorpay endpoint
   - Verify signature: X-Razorpay-Signature header vs HMAC-SHA256 of raw body with
     RAZORPAY_WEBHOOK_SECRET — mirror the exact verification from verify-razorpay-payment.mjs
   - On event payment_link.paid:
     UPDATE voice_orders SET payment_status='paid', paid_at=now() WHERE payment_link_id=...
     INSERT into "Order_history": { order_id, order_status: 'processing' }
     (existing trigger syncs this to orders.status automatically)
   - On event payment_link.expired:
     UPDATE voice_orders SET payment_status='expired'
   - On event payment_link.cancelled:
     UPDATE voice_orders SET payment_status='cancelled'
   - Return 200 immediately on receipt (before DB writes) — Razorpay retries if it doesn't
     get a 200 within 5 seconds; do DB work asynchronously.

4. Replace the initiate_payment stub in tools.ts from Phase 5 with the real implementation:
   Call createPaymentLink + sendPaymentLink, return a spoken confirmation string to the LLM.

5. Add to .env.example:
   RAZORPAY_KEY_ID=
   RAZORPAY_KEY_SECRET=
   RAZORPAY_WEBHOOK_SECRET=
   WEBSITE_URL=                    # e.g. https://earthorafarms.com
   SMARTFLOW_API_KEY=
   SMARTFLOW_SENDER_ID=
   SMARTFLOW_BASE_URL=
   TATA_WHATSAPP_API_KEY=          # optional — leave blank if not available yet
   META_WHATSAPP_TOKEN=            # optional — leave blank if not Meta-approved yet
   META_WHATSAPP_PHONE_NUMBER_ID=  # optional
```

---

### PROMPT — Phase 8: Auto-expiry, admin panel, README

```
1. Scheduled auto-expiry (voice-agent-server/src/jobs/expire-orders.ts):
   - Use node-cron (already always-on, no external infra needed)
   - Run every 15 minutes: call the cancel_expired_voice_orders() Postgres function
   - Log: "Expiry job: {N} orders cancelled"
   - Import and start this in src/index.ts

2. Admin panel — voice order visibility (in the existing frontend, not the server):
   Read src/pages/admin-earthora/orders.tsx carefully — understand its data-fetching pattern,
   component structure, and styling conventions (Tailwind classes, shadcn/ui components used).
   Make these additions while matching those patterns exactly:
   
   a) In the orders list: show a small green "📞 Voice" badge next to any order that has a
      matching row in voice_orders. Fetch voice_orders ids in one query alongside the orders
      query and do a client-side join — don't add a new network request per row.
   
   b) In the order detail side-panel (the panel that slides open when you click an order):
      If the order has a voice_orders row: show a "Voice Order" section with:
      - Payment link status (pending/paid/expired)
      - Payment link URL (clickable)
      - Sent via (SMS/WhatsApp/both)
      - expires_at timestamp
      If the order has a call_sessions row (join on order_id): show a collapsible "Call
      Transcript" section with the full transcript (role + text, formatted clearly).
   
   Fetch the voice_orders and call_sessions data alongside the existing orders query using
   Supabase joins — read how the existing query is structured and extend it rather than
   adding separate useEffect calls.

3. voice-agent-server/README.md:
   Write a clear, complete README covering:
   - What this server does and how it fits with the website
   - Full list of env vars with descriptions and where to find each value
   - Local development setup:
       a) Clone, npm install
       b) Copy .env.example to .env, fill in values
       c) Start local PC services (faster-whisper on :8001, Piper on :8002, Ollama on :11434)
       d) Set up Cloudflare Tunnel: exact commands for exposing all 3 ports
       e) npm run dev
   - Running the Phase 2 knowledge base seeder: npm run seed:knowledge
   - Deployment to Railway (recommended):
       a) Push voice-agent-server/ to its own GitHub repo (or monorepo subfolder)
       b) Railway: New Project → Deploy from GitHub, set root directory to voice-agent-server/
       c) Set all env vars in Railway dashboard
       d) Railway gives you a public HTTPS URL — paste it into SmartFlo as the webhook target
       e) Register the /webhooks/razorpay endpoint in the Razorpay dashboard
   - How to test: SmartFlo test-call feature, curl commands for the health endpoint
   - Provider status: GET /health returns provider status (from getProviderStatus() in Phase 4)
```

---

## 8. Deployment note

Never deploy this to Netlify — it needs a long-lived process with WebSocket support. Use:

- **Railway** (easiest, has a free tier, Mumbai region available) — recommended
- **Render Web Service** (not Serverless Functions)
- **Fly.io** with Mumbai region for lowest call latency from India

The Netlify site and this voice-agent-server are **separate deployments** sharing one
Supabase project. They don't interact directly — both just read/write the same Postgres DB.

---

## 9. The one thing still blocked on Tata

Get the SmartFlo webhook/audio-streaming API docs (section 5) before Phase 3. Everything
else — Phases 1, 2, 4, 5, 6, 7, 8 — can be built and tested in parallel without it.