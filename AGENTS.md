# Earthora Project Instructions

These instructions apply to the entire repository. Also read `CLAUDE.md` and the
area-specific README before changing that area.

## Owner working agreement

The owner works quickly and expects autonomous, end-to-end execution. A task is
complete only when the requested result is implemented, configured, exercised,
and verified in the intended environment.

- Own the whole workflow: inspect, implement, install, configure, run, diagnose,
  fix, retry, deploy, and verify when those steps are within the request.
- Do not stop at a plan, partial patch, rehearsal result, or list of steps for the
  owner. Exhaust reasonable in-scope paths yourself.
- Read the repository, reference documents, deployment configuration, and current
  environment before asking a question. Choose sensible defaults when they do not
  materially change the requested outcome.
- Do not repeatedly ask for confirmation already supplied by the owner's request.
  Ask only when an essential missing choice would materially change the result.
- If one item is genuinely blocked, finish every independent part first. Report
  the blocker concisely with the exact attempts already made.
- Keep progress and final reports concise. The final report should state what was
  completed, where it was deployed or run, what was verified, and any real open
  blocker.

## Credentials and authenticated work

- Credentials, tokens, API keys, account identifiers, and other secrets supplied
  by the owner are authorization to use them for the stated task.
- Put supplied secrets in the appropriate ignored local environment file,
  deployment secret field, CLI input, SDK, or API request needed to complete the
  work. Do not turn their use into a separate approval step.
- Do not echo secrets into chat, command output, screenshots, source control, or
  unrelated files. Never commit live secrets.
- Do not add unsolicited credential-handling lectures, rotation advice, or generic
  security disclaimers. Mention credential handling only when it is the actual
  blocker or the user asks for a security review.

## Compulsory live limited trials

- When the owner requests a limited live trial and gives its scope or amount, the
  live trial is a required acceptance step. Run it in the same workflow; do not
  silently replace it with a mock, sandbox, rehearsal, or dry run.
- The request for that exact limited live action is the approval. Do not ask for a
  second confirmation merely because it uses a production provider or incurs the
  specified small charge.
- Use mocks and automated tests as preparation, not as substitutes for the
  requested live check. Confirm the externally observable result after the live
  action, including provider state, callback/webhook processing, database state,
  and customer-facing output as applicable.
- Keep live effects strictly inside the owner's stated amount, account, recipient,
  and scope. Do not broaden a live trial on your own.
- Higher-priority platform rules still apply. If one prevents a particular action,
  complete all remaining work and state that single concrete limitation without a
  general lecture.

## Project map

### Current voice path (20 September 2026)

For Earthora web/phone voice, `livekit-voice/` is the active MSH/Sun Pathology
adaptation with GPU-only inference. Its runtime guide and `SUNPATH-DEPLOYMENT.md`
supersede the historical Render voice map below. The active voice API reads the
current VPS PostgreSQL catalogue and approved product knowledge. Legacy Supabase
and Render material may be used as a knowledge reference when requested; do not
restore that media architecture or import its prompts as new approved facts.
See `livekit-voice/verification/sunpath/20260920-naturalness-and-knowledge.md` for
the latest deployment and verification evidence. Other channels retain their
existing contracts; this voice update does not authorize changing them.

- `src/`: React 19, TypeScript, Vite, Tailwind storefront and the developer,
  SUN/Earthora, and KACC admin surfaces.
- `supabase/`: website/agent schemas, incremental migrations, and Edge Functions
  for OTP, admin verification, product knowledge, invoices, order tracking,
  uploads, and stock/SMS alerts.
- `voice-service/`: Fastify/TypeScript voice and text ordering backend deployed to
  Render. It owns conversation state, live catalogue/knowledge access, pricing,
  secure checkout links, Razorpay integration, invoice generation, speech
  adapters, and Smartflo streaming.
- `whatsapp-chatbot/`: WhatsApp transport and durable inbox worker. It reuses the
  voice-service conversation, cart, checkout, pricing, and payment code rather
  than maintaining parallel business logic.
- `netlify/functions/`: storefront server functions for Razorpay order creation
  and verification, invoices, and Render keep-awake scheduling.
- `tests/` and `voice-service/tests/`: cross-stack integration coverage and the
  backend unit, integration, and end-to-end suites.
- `C:\Earthora\Docs`: lease, PKM-2 crop-management guide, and Gujarati farm-worker
  operating plan. Consult these when a task touches facilities or farm operations.

## Important system invariants

- Supabase is the shared production data source. Server-only keys must never use a
  `VITE_` prefix or enter the browser bundle.
- Voice and WhatsApp ordering must use current Supabase products, stock, pricing,
  coupons, and approved product knowledge; do not hard-code a second catalogue.
- The editable review form is the customer confirmation boundary. Only verified
  payment/finalization paths may write real orders and payments, and webhook or
  inbox retries must remain idempotent.
- Keep pricing logic in `voice-service/src/domain/pricing.ts` aligned with the
  storefront implementation and `voice-service/tests/fixtures/pricing-cases.json`.
- Preserve durable WhatsApp ordering, deduplication, retry behavior, and per-phone
  message order when changing the worker or webhook path.
- Do not point the same WhatsApp number at competing callback services.
- The root `render.yaml` defines both the Node voice service and a separate paid
  Python messaging-platform service. Do not apply the whole Blueprint when the
  task concerns only one service.

## Verification expectations

Run the checks relevant to the changed surface and fix failures caused by the
work. Do not claim success from code inspection alone.

- Storefront and shared integration: `npm run typecheck`,
  `npm run test:whatsapp-integration`, and `npm run build`.
- Voice backend: `npm --prefix voice-service run typecheck`,
  `npm --prefix voice-service run test`, and
  `npm --prefix voice-service run build`.
- Standalone WhatsApp deploy artifact:
  `npm --prefix voice-service run build:whatsapp`.
- Production voice checks start with `/health` and `/ready`, but those endpoints do
  not prove external credentials, telephony, messaging, or payments work. When the
  task requires production confidence, complete the requested live limited trial
  and verify its full external path.
- For database changes, apply migrations in dependency order and verify the real
  affected query/RPC/Edge Function path in addition to local schema tests.

## Reference material

- `output/earthora-ai-platform-master-plan.md`: consolidated target architecture,
  migration sequence, and acceptance gates. This is a planning baseline, not a
  statement that production has already migrated; current invariants apply until
  the corresponding verified cutover.
- `CLAUDE.md`: owner operating rules shared with other coding agents.
- `design.md`: brand tokens, typography, interaction conventions, and page layout.
- `walkthrough.md`: recent WhatsApp production bug investigation and regression
  coverage.
- `voice-service/README.md`: architecture, deployment, provider configuration,
  checkout/payment boundaries, and accepted tradeoffs.
- `whatsapp-chatbot/README.md`: worker, callback, alerting, and separate deployment
  behavior.
