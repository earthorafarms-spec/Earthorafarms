# Earthora AI Platform — Master Plan

Date: 15 September 2026. Status: final revised planning baseline; execution has not started.

This is the single implementation reference, consolidating the owner's requirements, the Earthora repository review, Astra architecture work and Claude's revised proposal. It supersedes earlier architecture proposals. It describes the target system, not the current deployed state. Attached proposals are reference material; conflicting claims about decisions are resolved below.

## 1. Decisions and scope

| Area | Master-plan decision |
| --- | --- |
| Product | One scenario-driven AI platform; shared knowledge, workflows, functions and conversation state across Chat, Voice, WhatsApp and Calls. |
| Geography/languages | India first. English, Hindi and Gujarati are first-class launch languages for speaking, understanding, retrieval and written replies, including code switching and Roman-script Hindi/Gujarati. |
| Business scope | Earthora first. Tenant-aware data and authorization from the foundation; no multi-business UI or SaaS billing in v1. |
| Initial workload | 50 knowledgebase files; 10 simultaneous conversations across channels as the baseline. Also test all-voice load and a separate 10-chat + 10-call stress profile while ingestion runs. Measure pages, bytes and chunks. |
| Hosting/data | Hostinger KVM8; owned PostgreSQL plus pgvector; owned API and file storage. Remove operational dependence on Supabase, Netlify and existing Render runtimes. |
| Sequence | Complete data, storefront and hosting migration first. Preserve existing channel behavior through a temporary PostgreSQL-backed compatibility runtime. Build the new platform afterward, switch channels, then remove that runtime. |
| AI provider | Google baseline: Gemini text/structured analysis and embeddings; Chirp 3 STT and Chirp 3 HD TTS for controlled voice. Gemini Live is evaluated separately, not an automatic launch default. |
| Public location | Proposed default ai.earthorafarms.com, with /admin, /chat/earthora, /voice/earthora, /api, /ws and /webhooks. Storefront stays on its current public domain. |
| Appearance | This conversation explicitly requested a branded animated assistant; Claude's attachment says no avatar. Preserve a lightweight, switchable branded renderer in v1. No human-video avatar, 3D character or lip-sync service. Turning animation off changes presentation only. |
| Operator handoff | Callback/follow-up capture, team notification and read-only conversation history in v1. Live agent takeover and call transfer come later. |
| Repository | Preserve the existing repository, organization and history. No new repository under another organization or ownership transfer. |
| Navigation | Dashboard, Knowledgebase, Workflows, Functions, Channels. Conversations, Test Lab and Failed Jobs sit under Dashboard; compact Settings handles shared administration. |

The screenshots themselves and MyScanHub source have not been inspected in this review. Claude's detailed settings inform this specification; exact screenshot matching or component reuse is verified during UI implementation, not assumed.

## 2. Architecture: simple deployment, explicit responsibilities

Use a modular TypeScript application, not a fleet of microservices. Retain React, Vite, Tailwind and Fastify. Use npm workspaces as packages are extracted; do not introduce Next.js, Turborepo or a second package manager simply for this rebuild.

| Component | Responsibility |
| --- | --- |
| Caddy | TLS, static storefront/console, canonical redirects, API routing, SSE/WebSocket forwarding and headers. |
| Storefront | Existing React/Vite app adapted from direct Supabase calls to the owned API. Preserve public URLs and all existing admin functions. |
| Console | React/Vite administration and hosted assistant pages, sharing design tokens and a typed API client. |
| API process | Fastify storefront/admin endpoints, staff sessions, workflow execution, chat streaming, webhooks and shared commerce. |
| Media process | Browser audio, Smartflo sockets, interruption handling and speech adapters. Same codebase/image, separate process role. |
| Worker process | PostgreSQL-backed ingestion, inbox/outbox, reconciliation, notifications, summaries and schedules. CPU-heavy extraction uses bounded subprocesses. |
| PostgreSQL | Commerce, knowledge/chunks, workflow state, configuration versions, jobs, inbox/outbox, audit and usage. Extensions as needed: vector, pgcrypto, pg_trgm. |
| Asset storage | Persistent VPS volumes behind a storage interface for images, KB originals and enabled recordings; replaceable by object storage later. |
| Backup/monitoring | Backup service independent of application workers, off-server destination and external uptime monitoring. |

Docker Compose is the initial deployment mechanism. Verify the actual KVM resources and other workloads before tuning. Google handles model inference; no local LLM/GPU is assumed.

PostgreSQL is the only queue/state store at launch: no Redis hot copy or BullMQ dependency. Jobs require explicit leases, retries, deduplication, ordering and failure handling. Add another store only when measurements justify it.

Code boundaries: storefront, console, API, media, worker and widget entry points; shared database/migrations, commerce, workflow, retrieval, provider and transport packages. Extract incrementally instead of reorganizing everything during cutover. Preserve clear transaction/locking SQL; migrations are versioned deployment jobs.

For Indian users, select available VPS/provider regions based on measured round-trip latency, service/language availability and operational requirements. India-first does not automatically mean every provider processes data in India; document actual regions rather than imply residency. Use Asia/Kolkata in business schedules and customer displays, UTC for stored timestamps.

## 3. Repository findings and reuse

These are code observations, not a claim that live configuration has already been audited:

- The browser directly reads and mutates Supabase; a database copy alone cannot migrate the storefront.
- Current guest authentication and client-side developer/SUN/KACC gates do not replace server authorization. Preserve their business functions behind real staff sessions.
- Storefront checkout persists several records through separate client operations; voice has a transactional finalizer. Converge on one server commerce contract.
- Invoice work crosses Netlify, Supabase and voice code; replace duplicate dispatch paths with recorded notification jobs.
- WhatsApp is separately deployable but imports the voice business engine. Deleting both immediately removes ordering and notifications.
- Existing approved product-knowledge rows are valuable sources, but not the new document RAG system.
- Tracking and stock alerts are independent dependencies of the old worker.
- Copy actual processed images and raw-upload objects, not just database metadata.
- Checkout/invoice links and callbacks may outlive the old bot.
- A separately configured Python messaging deployment has absent source here; inspect its live role before altering shared deployment resources.

Primary code evidence: src/hooks/useCheckout.ts, src/contexts/auth-context.tsx, admin gates, supabase/functions and migrations, netlify/functions, voice-service/src/payments, repositories, routes/smartflo-stream.ts and whatsapp-chatbot/worker.ts.

| Existing capability | Treatment |
| --- | --- |
| Pricing, coupons, checkout normalization, review form | Extract shared commerce; compare storefront/backend fixtures; retain one authoritative result. |
| Razorpay finalization, invoices, webhook handling | Preserve useful semantics, replace storage/delivery dependencies, add failed-event and concurrent-stock reconciliation tests. |
| Smartflo protocol, marks/clear, codecs/resampling, interruption epochs | Port with tests; verify actual account events and the Google audio path. |
| WhatsApp normalization, inbox/ordering, cards/templates | Adapt into transport/notification modules; preserve operational state. |
| Language, transcript and pronunciation utilities | Reuse after en/hi/gu regression tests. |
| Prompt/output checks | Preserve tested rules, add evidence and pre-release validation; copying the old checker does not guarantee grounding. |
| Old monolithic conversation engine | Temporary compatibility only; replace with the workflow engine. |
| MyScanHub patterns described by Claude | Inspect if available; reuse suitable UI/prompt patterns, not an unverified worker or retrieval stack. |

## 4. Knowledgebase

### 4.1 Structure and settings

Structure: business -> collections -> documents/approved facts -> versions -> chunks. Use many-to-many workflow associations; one file can serve multiple workflows without duplicate embeddings.

Initial collections: product descriptions/approved facts; usage/storage guides; purchase/shipping/return policies; customer-facing company information. Internal documents remain explicitly internal.

Product descriptions can be indexed for discovery. Prices, stock, discounts, delivery eligibility, private order information and payment state always come from live functions.

| Level | Settings |
| --- | --- |
| Business/KB | Languages, default visibility, approval rules, citations, retention, no-answer behavior and usage limits. |
| Collection | Purpose, authority, customer/internal access, tags, workflows and retrieval profile. |
| Source | Type, refresh policy, collection defaults, enabled state and import history; crawl schedules/include-exclude rules when introduced. |
| Document/fact | Title, tags, language, product links, workflows, visibility, authority, effective dates, notes, draft/published/withdrawn state and version. |
| Processing | Parsing/OCR profile, section/table handling, chunk/overlap settings, embedding model/version/dimensions, warnings and retry/reindex. |
| Workflow/step | Permitted collections/documents/tags, filters, context budget, candidate limit, optional rerank, minimum-evidence policy and internet search. |
| Diagnostics | Retrieval test in a workflow/channel context, passages/scores/filters/versions, index health, failed imports, conflicts and gaps. |

V1 supports PDF with OCR fallback, DOCX, TXT/Markdown/HTML, CSV/XLSX, manual facts, approved product-knowledge import and product-description sync. Preserve spreadsheet headers, units and record identity. Inspect the 50 files to identify actual parser requirements. Scheduled URL/sitemap crawling and transcript mining are subsequent source adapters, not launch prerequisites.

### 4.2 Ingestion

Upload original -> extract -> preserve headings/tables/page references -> propose metadata -> review -> chunk/embed -> inspect -> publish.

Start around 300–500 tokens per structure-aware chunk with modest overlap, tuned on the actual corpus. Split oversized tables by logical rows while retaining headers; expand parent sections within a context budget. Context headers carry factual document/section identity. Generated summaries aid discovery, not replace original evidence.

Hashes and processing versions prevent unnecessary reindexing. Stage replacement imports and swap published versions atomically; failure leaves the prior version available. Publication/withdrawal invalidates evidence caches. Enforce expiry at retrieval time.

Use one supported Gemini embedding profile initially; pin exact model ID, output dimensions and normalization. A model change requires separate reindex/testing and an atomic swap. Never mix incompatible vectors. Auto-tags, mappings and transcript-derived knowledge are drafts requiring approval.

### 4.3 Retrieval

1. Establish scenario, actual question and entities.
2. Apply tenant, customer/staff access, channel visibility, publication/effective dates and workflow/step scope.
3. Combine lexical retrieval and exact vector search using a tested rank-fusion strategy.
4. Expand relevant parent/neighbor sections. Use rewrite/rerank only when useful, not as mandatory serial calls.
5. Build a small evidence packet with source IDs, versions and page/section provenance.
6. Resolve conflicts by applicable authority, then effective date. If still unresolved, show the gap instead of blending claims.

General fallback searches only permitted, approved customer-facing sources. Internal material is not a fallback pool. Documents and web pages are evidence, never execution permissions.

Exact nearest-neighbor search is the launch baseline, subject to measured chunk count/latency. There is no fixed 100,000-chunk migration trigger. Add HNSW when measurements justify it; compare filtered recall against exact search before enabling it. Approximate filtering can return insufficient matches. [pgvector documentation](https://github.com/pgvector/pgvector)

Test English, Hindi, Gujarati, Roman-script variants and code switching independently. Keep original text/provenance alongside normalization; do not depend on English stemming or assume a universal similarity threshold.

Initially cache versioned source evidence and deterministic configuration, not complete answers reused solely at 0.95 semantic similarity. No shared cache of private customer answers or volatile commerce facts.

## 5. Workflows: the core product

The workflow defines how to help; the KB provides evidence; functions supply current facts/actions. A prompt is neither the durable state nor the permission system.

### 5.1 Authoring

The owner describes a scenario. AI asks focused questions about outcome, necessary facts, allowed sources/actions, then drafts an editable definition. It does not invent missing business policies.

Editor sections:

- Purpose, when to use, positive and negative examples.
- Playbook/stepped mode, priority, fallback and permitted sub-workflows.
- Facts to collect: type, validation, required condition, localized question, skip/carry rules.
- Playbook or steps, conditions and allowed transitions.
- Knowledge selection by collection/tag/product/document.
- Functions per step, parameter bindings, prerequisites, confirmation and retry rules.
- Internet search: off by default; allowed purpose/domains, budget and timeout when enabled.
- Editable prompt blocks, tone, language and channel-specific length.
- Outcomes, no-answer/escalation and post-conversation actions.
- Example conversations, simulation, regression tests, publish history and prior-version restore.

Use a guided editor with a read-only flow preview. Show editable prompt blocks and the effective compiled prompt; make channel defaults and workflow overrides visible. Do not build a general-purpose drag-and-drop diagramming product in v1.

### 5.2 Two modes, one enforcement engine

| Mode | Use | Enforcement |
| --- | --- | --- |
| Playbook | Product information, policies, recommendations | Flexible wording/question order, with required relevant facts, source/function scope and commercial boundaries enforced by the application. |
| Stepped | Cart/checkout, private order support, callback capture | Explicit prerequisites and transitions; no skipping identity, review or payment checks. |

Step vocabulary: ask, retrieve, condition, function, respond, wait, call_workflow, handoff, finish. Playbooks call the same stepped checkout; they do not gain weaker payment rules.

### 5.3 Launch scenarios

| Scenario | Behavior |
| --- | --- |
| Product recommendation | Reuse known preferences, ask a material missing question, retrieve approved eligibility/product evidence, offer a small relevant shortlist with reasons or a supported no-recommendation outcome, then optional cart action. |
| Product information | Identify the product if ambiguous and answer directly from evidence. Do not force recommendation intake. |
| Cart/checkout | Apply item/quantity changes, validate delivery details, recalculate price/stock, issue editable review link; payment creation follows confirmed review. |
| Order support | Establish permitted customer identity, query live status/tracking and escalate unresolved issues. |
| Policies/company information | Use effective approved sources, clarify or escalate unresolved contradictions. |
| Callback/inquiry | Capture minimum details, confirm request, save durable follow-up and notify the team. |
| General fallback | Clarify or answer from allowed public knowledge; no unrestricted functions/internal search. |

Health-related eligibility and claims require reviewed rules and approved evidence. A condition mention must not automatically produce a recommendation. Include no-recommendation/escalation outcomes in tests.

### 5.4 Natural conversation

- Handle correction, cancellation and factual interruptions before asking another missing question.
- Resolve unambiguous pending quantity/yes-no/PIN answers in code; otherwise combine intent and fact extraction in one structured analysis call.
- Confident routing must not discard supplied quantities/preferences.
- Ask one material question at a time; do not re-ask known facts unless invalidated, stale or ambiguous.
- Keep a bounded suspend/resume stack, initially depth three. A storage question mid-checkout answers and returns with cart/address intact.
- Corrections invalidate dependent price/confirmation/payment drafts where needed without restarting the conversation.
- Explicit “add two” is intent for that reversible cart operation. Do not require another yes for every function; bind material confirmations to their exact current arguments.
- Low-confidence routing or timeout clarifies or uses read-only fallback, never guesses a transactional action.

## 6. Durable runtime

### 6.1 State and versions

Persist active workflow/step, pinned workflow/channel versions, validated facts with provenance/source turn, pending question/action, selected product, cart/checkout references, suspended workflows, language, bounded history/summary, revision and lease ownership.

A summary is not the authoritative cart, address or verification state. Publishing affects new conversations; function revocation, withdrawn knowledge and changed access restrictions apply immediately. Volatile commercial facts are refreshed at action boundaries.

### 6.2 Turn processing and delivery

1. Verify/normalize intake, durably store a deduplicated event, then acknowledge webhook receipt.
2. Claim conversation ownership with a renewable lease and revision/fencing checks; serialize conflicting turns and preserve per-phone order.
3. Resolve deterministic continuations or bounded analysis; retrieve evidence and prepare permitted invocations.
4. Execute local mutations transactionally and remote operations through durable invocation records. Do not hold database transactions open during model/network calls.
5. Validate the response. Atomically save state, completed inbound status, reply and required outbox records. Streaming units have persisted sequence/checkpoint records before release.
6. Deliver committed records; retry delivery without rerunning a completed turn or committed mutation. Summaries/follow-ups are background jobs.

External APIs are not inside the database transaction. Each side-effecting invocation carries tenant-scoped idempotency key, operation/argument hash, status, provider IDs and saved result. A timeout after possible acceptance becomes uncertain/reconciliation, not a blind new attempt.

Use pending/running/succeeded/failed/uncertain outcomes, bounded backoff, stale-lease recovery and operation-aware replay. Fence stale workers before committing; reconcile remote operations already in flight when a lease expired.

Constraints/transactions prevent duplicate internal business effects. Universal exactly-once external delivery is not promised: a provider can accept a message and lose the acknowledgement. Track uncertain delivery separately and use provider lookup/idempotency where supported.

Persist ordered WhatsApp message parts and delivery IDs. SSE reconnect uses committed event IDs. Realtime audio has playback epochs: cancel obsolete speech, clear queues on interruption, never replay stale audio on reconnect. Committed business actions remain committed and must be described accurately.

### 6.3 Inspectability

Each trace shows workflow/step and short routing rationale, validated facts, evidence/versions, allowed functions, invocation results, prompt version/hash, model profile, timings, cost and delivery state. Authorized staff can inspect the compiled prompt with secrets excluded and customer data access-controlled. Do not require a model's hidden internal reasoning.

## 7. Functions and commerce

V1 is a code-maintained registry. The UI supports selection, enable/disable, descriptions/configuration, tests and retirement. Executable logic remains a code change; retirement preserves references/history and identifies affected workflows.

Each function has typed inputs/outputs, description, workflow/channel bindings, credential reference, preconditions, operation-specific confirmation, timeout, retry/idempotency policy, cost classification and history. Preview/Test defaults to fixtures or designated test context. Explicitly selected limited live tests use real providers within recorded scope.

Initial registry: product search/details/approved facts, stock, cart read/add/update/remove, delivery validation, price calculation, review-link creation, verified order status, shipment tracking, invoice delivery, callback and inquiry capture. Retrieval/web search follow the same scope policy. No unrestricted payment-link function bypassing review.

Commerce rules:

- One pricing/finalization contract serves storefront, compatibility runtime and new channels.
- Prices/stock/coupons/delivery are authoritative live data, revalidated at checkout.
- Confirmation is bound to the cart/address/amount revision; material changes invalidate downstream drafts.
- Editable review remains the customer confirmation boundary. Verify provider IDs, amount, currency and ownership before recording payment success.
- Order/items/payment/history, stock and coupon effects have one tested atomic boundary; never deduct inventory in both code and a trigger.
- Browser returns and delayed/duplicate/failed webhooks converge on one reconciled ledger.
- Invoice, tracking, dispatch and stock alerts are durable jobs independent of AI output.
- Private order access needs channel-appropriate verified identity. Order number plus a typed phone/email is not possession proof. Use authenticated sessions, signed access links or a verification flow. A signature-verified WhatsApp sender can support matching-account lookups; PSTN caller ID alone cannot authorize sensitive access. Never ask for payment-authentication OTPs.

## 8. India-first language and Google speech

### 8.1 Language behavior

English, Hindi and Gujarati must work at launch across text, speech, retrieval and critical business flows—not just greeting translations.

- Auto-detect from sufficient context; expose a language override and keep it until the user changes preference. Do not switch the entire conversation because of one English product name.
- Understand mixed Hindi/English and Gujarati/English, Devanagari, Gujarati script and Roman-script messages such as “be packet joiye” or “do packet chahiye.”
- Keep canonical product/SKU identity separate from display names, transliterations and pronunciation aliases.
- Preserve original utterance and normalized values. Correctly distinguish quantities, pack sizes, phone numbers, rupee/paise amounts, locality names and six-digit PIN codes.
- Ask for clarification when a number/address is ambiguous; use typed editable confirmation for delivery details rather than relying only on speech.
- Respond in the customer's preferred language with natural short phrasing. Expose translations for greetings, questions, no-answer text and callback confirmations.
- Retrieval evidence can be in another supported language; answer in the chosen language while preserving source references and meaning.
- Maintain reviewed en/hi/gu copies for exact price/order/payment messages. Localize dates, rupee formatting and business hours without changing canonical values.
- Validate all three languages individually. A blended average cannot hide poor Gujarati or Hindi performance.

### 8.2 Controlled launch pipeline

Browser/Smartflo audio -> streaming Chirp 3 STT -> shared workflow/evidence/functions -> validated text -> streaming Chirp 3 HD TTS -> channel audio.

Use Gemini fast profiles for ordinary generation/structured extraction and a higher-capability profile when justified for authoring/evaluation. Pin supported model IDs in deployment configuration after account/region verification. Provider overrides are explicit; planning-model choice does not determine customer-runtime models.

Validate complete short replies or complete claim units before chat/TTS release. Render exact amounts and payment/order outcomes from confirmed server records. Product/policy claims require relevant approved evidence and a pre-release check. Allow one bounded repair, otherwise a grounded limitation/callback. Masking after streaming cannot undo spoken claims.

This is a controlled release path, not a claim of perfect semantic validation. Reviewed evidence assertions and spoken-output tests remain necessary.

### 8.3 Gemini Live evaluation

Run the same 30 recorded en/hi/gu scenarios through the controlled pipeline and Gemini Live, plus live interactive interruption tests. Cover product names, numbers, addresses, corrections, tools and failures.

Measure useful latency, fact/transcription accuracy, grounded spoken wording, action confirmations, recovery and cost. A finite test pass does not make unbuffered native speech pre-validated. Use Live in grounded commerce only if the integration preserves the required output-control boundary; otherwise keep it restricted/experimental and the controlled pipeline authoritative. A transcript arriving after audio is not a pre-speech check. [Google Live API](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

### 8.4 Provider capability details

Google lists Chirp 3 HD for English (India), Hindi and Gujarati, with streaming PCM/MULAW among the formats. Gujarati Chirp 3 recognition is currently Preview. Test actual vocabulary and code switching rather than equating language support with accuracy. [Google TTS](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [Google STT](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)

Only expose controls supported for the chosen model/method/language. Gujarati is currently excluded from Chirp 3 HD custom-pronunciation controls; use tested text aliases/normalization as appropriate. Do not invent mood/temperature or streaming SSML controls. [Google voice-control language support](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd#language-availability-for-voice-controls)

Browser audio uses an AudioWorklet with negotiated PCM. Smartflo uses its verified telephony format; retain tested G.711/resampling adapters. Direct MULAW is a verified optimization, not a promise of zero transcoding. Barge-in cancels generation, clears queued audio and advances playback epoch.

If a language misses a critical speech gate, correct the profile/glossary/pipeline and retest; do not silently claim multilingual completion or fall back to English as a substitute. Text entry/callback is the visible degraded mode. Any non-Google fallback would be a separately documented provider decision.

## 9. Five-module console

### Dashboard

Metrics by workflow/channel: conversations, completion/abandonment, unnecessary questions, follow-ups due, KB gaps, routing ambiguity, tool/provider/ingestion failures, useful-response p50/p95, tokens/minutes/cost and caps.

Conversations: transcript, enabled recording playback, workflow path, evidence, functions, delivery diagnostics and follow-up. Separate real user feedback from inferred sentiment/model scores. “Add to KB” creates a draft.

Test Lab: draft/published simulations in test context, reviewed suites, version comparisons. Failed Jobs: inspect/retry/reconcile. Misroute review: add positive/negative examples to a draft and run regression tests.

### Knowledgebase

Collections, files/sources, approved facts, imports, version/publish/withdraw controls, retrieval tests, conflicts and gaps as specified in section 4.

### Workflows

AI drafting, playbook/step editor, facts/conditions, source/function permissions, compiled prompts, simulation, examples, publication/version history and performance.

### Functions

Registry, configuration, enable/retire, bindings, sample inputs, Test, invocation history and failure diagnostics.

### Channels

Shared: draft -> preview -> publish, compare versions, provider/model overrides, workflows/fallback, source/function scope, language, working hours, style, escalation, retention, caps, connection status and tests. Publications apply to new sessions; revocations apply immediately.

| Subtab | Settings/deliverables |
| --- | --- |
| Chat | Persona blocks (identity/environment/objective/tone/conditional questions/rules/custom), greeting/starters, name/logo/colors/optional animation, launcher/position, languages, citations/length, feedback, operating hours/offline text, embed domains, attachment policy, callback, install snippet, hosted page and live preview. |
| Voice | Agent/persona, pipeline, language policy, voice picker/sample, supported pace/style controls, pronunciation/recognition glossary, turn detection/barge-in, silence prompts/timeout, max duration, hang-up phrases, captions/mic controls, optional recording/retention, summaries/post-actions, KB/functions, Speak Now and diagnostics. |
| WhatsApp | Provider/number/WABA identifiers as applicable, credential fields, generated callback/verification, status, templates/languages/provider sync, cards, inbound media policy, opt-in/message-window handling, session TTL, optional menu, escalation, delivery/retry/uncertain-ack view, test send/webhook diagnostics. |
| Calls | Tata Smartflo account/DIDs, static WSS/dynamic resolver, supported endpoint authentication, inbound routing, greeting, inherited/overridden voice profile, hours/language, silence ladder/max duration, caller metadata, optional verified DTMF, recording/retention, summaries/follow-up and live diagnostics. |

WhatsApp settings are native to the console. Preserve Tata Omni for current-number continuity during migration; implement Meta Cloud in the new platform. Number/provider activation is a distinct verified cutover with one callback owner. Retaining a provider adapter does not retain the old chatbot service.

Tata Smartflo remains the call provider. Its documentation describes static/dynamic bidirectional endpoints and inbound/click-to-call integration. Verify actual events, codec and authentication capabilities. Do not claim transfer is impossible; live transfer is outside v1. [Smartflo streaming](https://docs.smartflo.tatatelebusiness.com/docs/copy-of-standard-operating-procedure-sop-for-voice-streaming)

Deliver hosted pages plus a lazy-loaded embed widget. Load voice assets only when needed. Optional branded animation reflects actual idle/listening/processing/speaking/interrupted states. Text, captions and speech share a session; private cross-channel history requires verified linkage.

Deferred: background ambience, elaborate avatars, live agent takeover, bulk outbound campaigns. Recordings and transcript post-actions are configurable, not enabled globally by assumption.

### Compact Settings

Business, team/roles, provider connections/capabilities, model profiles, budgets/limits, retention, backups/restore status, alerts and deployment diagnostics.

## 10. Data model and ownership

Preserve existing commerce table names/IDs at migration. Do not drop apparently unused tables, old runtime state or Supabase objects based only on repository guesses.

| Area | Core records |
| --- | --- |
| Identity | tenants, staff_users, memberships, staff_sessions, contacts/verified links, api_keys, audit_log; staff separate from migrated customers. |
| Commerce | Existing product/inventory/customer/cart/order/item/payment/history/coupon/analytics records; checkout drafts, payment-link mappings, invoices and provider-event ledger. |
| Channels | channels, channel_versions, credential references/capability profiles. |
| Knowledge | collections, sources, documents/versions, chunks, approved_facts, workflow mappings, ingestion jobs. |
| Workflows | workflows/versions/examples, published definitions and pinned execution references. |
| Runtime | conversations, conversation_state, messages, turn_traces, streaming checkpoints, workflow history. |
| Reliability | inbound_events, jobs, outbox messages/parts, function_invocations, reconciliation records. |
| Operations | assets, escalations, eval cases/runs/results, settings, usage_ledger, retention records. |

All business-scoped new records carry tenant ownership. Assign migrated commerce/assets/credentials to Earthora through explicit ownership mapping and additive constraints/columns as appropriate. Tenant-aware uniqueness, API queries, retrieval, caches, queues and functions must pass isolation tests before business two. A tenant_id field alone is not isolation.

Public browsing stays guest-friendly; staff roles start owner/admin/editor/viewer and are server-enforced. Audit publications and business/admin actions. Provider connections are encrypted/referenced by ID; credentials are excluded from logs/prompts.

## 11. Migration first, without channel downtime during the rebuild

### 11.1 Temporary compatibility runtime

Preserve existing conversation/transport behavior on KVM while replacing Supabase/Netlify dependencies with native adapters and extracted shared commerce/notification code.

This is not an unchanged redeploy. Adapt repositories, sessions, inbox/alerts, knowledge, payments/invoices, storage and mandatory configuration. Preserve active carts, checkout revisions, encrypted state, token signatures, pending links/events and notifications.

Storefront and compatibility runtime use one PostgreSQL authority and one finalization contract. Multiple coordinated processes are fine; competing ledgers are not. The bridge receives no new product features and is removed when replacement channels pass acceptance.

### 11.2 Inventory and restore

Inventory the live schema/version, extensions/roles/functions/triggers/sequences, drift, Auth users if any, all storage buckets/bytes, schedules/webhooks/jobs, callbacks, environment mappings, DNS/TLS/mail records, KVM workloads, pending transactions and public links. Check the separate Python service.

Match the verified source PostgreSQL major initially. Claude reports 17 but proposes pg16; do not introduce that unexplained downgrade. Preserve identifiers, timestamps, foreign keys and sequences. Dumps are not guaranteed to load into older majors. [PostgreSQL compatibility](https://www.postgresql.org/docs/17/app-pgdump.html)

Replace Supabase authorization/auth/storage dependencies deliberately; do not blindly strip every role/policy/function. Copy actual objects. Full Supabase self-hosted restore is not the same as this native PostgreSQL/API migration. [Supabase restore boundaries](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

Suppress identified stock/notification side effects during historical import, then enable/test intended target behavior and validate integrity. The restore target must not send real notifications or consume live queues.

Reconcile table counts/IDs, revenue/payment/order totals, stock/coupon balances, sequences and file hashes/bytes. Repeatable snapshot/delta logic handles updates/deletions, not just new rows. Run actual migrated SQL/API paths on real PostgreSQL; PGlite is supplementary coverage.

### 11.3 Controlled cutover

1. Before switching writers, prove storefront/bridge functionality, offsite restore, payment replay and rollback/data reconciliation. Demonstrate the storefront and compatibility runtime at measured current peak concurrency, including simultaneous calls/messages and backup activity, with bounded queues, database connections and resource usage.
2. Pause new transactions for a bounded window; fence old browser/admin builds, functions, workers, schedules and webhook mutations. DNS or a maintenance page alone is not a write fence.
3. Drain active calls; durably retain WhatsApp/payment events or preserve retryability. Never acknowledge unstored events.
4. Apply final data/object delta and reconcile. Route storefront/API/provider callbacks to KVM, then enable native workers/bridge. One callback owner per number, one authoritative database.
5. Run the owner's specified limited real purchase on the authoritative database. Verify provider payment, event ledger, order/items, one stock change, invoice/customer delivery and admin. No later source sync may overwrite that purchase.
6. Exercise real WhatsApp/voice/call behavior and existing signed links, plus tracking/restock continuity within the specified recipients/scope. Check independence with old Supabase/Netlify application access disabled.
7. Reopen normal traffic after reconciliation; track delayed events and keep rollback evidence.

After new writes exist, rollback retains PostgreSQL authority with a compatible application version or explicitly reconciles new data/events before switching authority back. Restoring an old snapshot or flipping DNS alone loses accepted business activity.

### 11.4 Retirement and public URLs

Preserve route/token/signing contracts until obligations resolve. An old onrender.com URL cannot be redirected using Earthora DNS. If necessary retain a narrow proxy or read-only asset endpoint temporarily, with no independent commerce writes. Track this separately from completed business-processing migration.

No automatic seven-day deletion. Retire endpoints/services only after replacements work, pending payments/messages/alerts reconcile, links are preserved/replaced/expired, recovery is proven and shared dependencies are resolved. Keep business history; runtime removal is not indiscriminate record deletion.

## 12. Delivery phases

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| 0. Inventory | Live dependencies/schema/assets/providers; 50-file inventory; deployment/model profiles; trial scope. | Verified access, writer/link/queue map, restore inputs, measurable acceptance cases. Reuse already supplied access. |
| 1. KVM/data foundation | Isolated prod/staging, native PostgreSQL/assets, reproducible import, TLS, backups, monitoring. | Counts/aggregates/checksums; real PostgreSQL restore; offsite WAL/base backup and timed fresh-target recovery; no import/staging side effects. |
| 2. Owned API + continuity | Staff auth, storefront/admin API, shared commerce, invoices/notifications, adapted frontend, PostgreSQL-backed legacy bridge. | Public/admin flows, duplicate/concurrent stock-payment tests, signed links, voice/WhatsApp/notifications; representative peak-load and backup co-load check; no required old application dependencies. |
| 3. Migration cutover | Storefront/data/hosting live on KVM; existing channel behavior on native DB. | Writer fencing/delta reconciliation; limited live purchase/channel tests; provider/DB/stock/invoice agreement; rollback data path. Migration is complete before new-platform build. |
| 4. Engine vertical slice | 50 files indexed, Google text/embeddings, workflow/runtime/functions, durable state/outbox, bare chat. | Recommendation vs product information through cart/review; interruptions/corrections, evidence gaps, privacy and crash/retry tests before console breadth. |
| 5. Console | Five modules, authoring, retrieval diagnostics, compiled prompts, function tests, publication, Test Lab/follow-up queue. | Draft isolation, roles, pinned versions, withdrawal, failed-job handling and reviewed evaluations. |
| 6. New channels | Hosted/embed chat, controlled voice + Google comparison, native WhatsApp adapters/settings, Smartflo calls, summaries/post-actions. | Real limited channel trials; en/hi/gu accuracy; barge-in, acknowledgements and review/payment continuity. Switch/drain each bridge channel after its acceptance. |
| 7. Final acceptance/retirement | Load/recovery/deploy evidence, runbooks, removal of old runtime code/deploys/dependencies. | Release targets, live-call drain, restored commerce test, old obligations closed or explicitly retained as compatibility endpoints. |

Hardening happens when each phase first depends on it, not only at the end. A calendar commitment follows measured Phase 0 scope and bridge/reuse assessment; the phase order is fixed here, not an unsupported seven-to-eight-week guarantee.

## 13. Operations and growth

- Separate prod/staging DBs, storage prefixes, routes and job environments. Test adapters by default; no duplicate live callbacks.
- Staff sessions/roles; verified provider ingress; request/body/origin limits; per-contact/IP/channel quotas and usage caps.
- Trace IDs across input, actions, payment and delivery; structured logs, readiness/health and failed-job/provider alerts. Health alone does not prove providers work.
- Connection-pool, CPU/memory, extraction and concurrency limits; reserve call headroom and prioritize interactive work.
- Persistent volumes, disk/WAL-growth alerts, log rotation, time sync, certificate renewal and service restart.
- Base backups plus continuous WAL to a verified off-server destination; back up assets/configuration and necessary key-recovery material. Do not assume a particular Hostinger storage product.
- Target RPO <=15 minutes and RTO <=4 hours including assets/configuration/routes and a commerce smoke test. Prove a fresh-target restore before cutover; nightly dumps alone are insufficient.
- External uptime monitoring that can alert when the VPS is down; local-only monitoring is insufficient.
- CI typecheck/tests/build, immutable images, one controlled migration job and readiness gates. No migrations independently running on every replica.
- Backward-compatible migrations and image/config rollback; image rollback is not a data rollback.
- Drain media/API connections during deployment: new sessions to new process, current calls finish within a defined duration. Test with an authorized live call.
- Retention/purge/export/delete with database/asset consistency and configurable recording policy.

One VPS is one failure domain, not high availability. Scale based on measured pressure: isolate ingestion, move assets, add media/API replicas, then separate database/search where justified. The boundaries support growth without promising an untested capacity multiplier.

## 14. Acceptance scorecard

These are targets to verify, not achieved results or universal accuracy guarantees.

| Area | Gate |
| --- | --- |
| Corpus/workflows | About 100 reviewed multi-turn cases with held-out paraphrases; >=95% correct routing and applicable completion. Report counts/failures per workflow and language, including Roman-script/code-switched variants. |
| Critical correctness | Zero unsupported price/payment/action-success claims, prohibited product/health claims, unauthorized private-data access or tool execution in the release suite. Critical failures block release regardless of average. |
| Conversation | Distinct recommendation/direct-information behavior; supplied facts retained; side-question/resume, corrections and operation-specific confirmation work. |
| Retrieval | Effective approved sources, clear conflicts/gaps, tenant/public/internal isolation, withdrawal/cache invalidation and filtered-recall evaluation before ANN. |
| Chat latency | p95 first useful content <=2 seconds for ordinary KB turns at baseline load. |
| Voice latency | p95 first useful audio <=3 seconds from end of customer speech, including turn detection, validation and synthesis. Record actual spoken output; filler does not count. |
| Retrieval latency | p95 <=300 ms on the measured corpus. |
| External actions/search | Separate latency/error budgets and truthful progress; no success claim on timeout. |
| Load | 10 overlapping active sessions including all-voice and simultaneous turns during ingestion/backup; separate 10-chat + 10-call stress test establishes admission/recovery behavior. |
| Reliability | Duplicates/reordering/restarts/lease expiry/uncertain provider acceptance do not duplicate internal cart/sale/stock effects; uncertain delivery is visible/reconciled. |
| Commerce/live | Scoped real purchase matches provider -> callback -> DB -> stock -> invoice/customer -> admin; old links/retries/concurrent last-stock purchase work. |
| Language | English, Hindi and Gujarati each pass critical product, quantity, money, phone/address/PIN and correction cases; no blended score conceals a failing language. |
| Channels/live | WhatsApp inbound/template/delivery state, Smartflo call, browser voice and live storefront embed; barge-in, silence and language behavior verified. |
| Recovery/deploy | Fresh-target WAL/assets recovery and commerce test meet targets; live-call drain and compatible rollback demonstrated. |
| Migration | Counts/aggregates/IDs/sequences/files reconcile; no active runtime dependency on removed providers; old state/obligations resolved. |

Use reviewed expected evidence and deterministic assertions for critical cases; a model judge assists but is not the only correctness authority. Run critical evaluations before KB/workflow/provider publication. Routine regressions are visible in Test Lab with an audited release decision.

Retain existing storefront/WhatsApp/voice typecheck, integration and build checks while packages exist. Add real-PostgreSQL API tests and browser smoke coverage; update runbooks/commands after package moves.

## 15. Execution agreement and completion

During execution inspect existing repository/deployment/account configuration first. Obtain only missing essentials when needed: KVM/DNS/DB access, Google/provider access, files and live-trial amount/recipients. Batch missing inputs; do not repeatedly request existing information or approval.

Supplied credentials are used for scoped work without logging or committing them. Specified limited live trials are required acceptance steps, not replaced by rehearsal. This planning request does not itself initiate deployments, purchases, cutovers or deletions.

Each phase ends with implemented/configured behavior, relevant tests, externally observed results where applicable and updated evidence/runbooks. Update current production instructions only when the corresponding cutover occurs; until then existing production invariants remain true.

Final result: storefront and business data owned on KVM; a Google-first scenario/RAG engine; five modules; four channels working in English/Hindi/Gujarati; commerce/history preserved; live trials reconciled; recovery/deploys proven; old bot runtimes removed after continuity obligations resolve.

The owner's idea remains central: recommendation, product information and order support are different conversations. Workflows define that behavior, scoped retrieval supplies evidence, and verified functions supply current facts and actions.
