# Earthora WhatsApp Chatbot

This folder contains the WhatsApp-specific transport layer for the Earthora
ordering agent. It intentionally reuses the voice service's conversation,
product, cart, checkout, Razorpay, and order-finalization code so both channels
behave consistently.

## Files

- `routes.ts` authenticates Meta or Tata Omni callbacks and queues messages.
- `inbound.ts` converts provider callback payloads into one internal format.
- `worker.ts` processes queued messages through the shared conversation engine.
- `events.repository.ts` implements durable delivery, deduplication, ordering,
  and retries.
- `sessions.repository.ts` stores conversation state per WhatsApp number.
- `provider.ts` sends text replies and secure checkout-form messages.
- `prompt.ts` contains the WhatsApp-specific assistant instructions.

The durable inbox schema is in
`../supabase/migrations/20260905000000_whatsapp_chatbot_inbox.sql`.
Runtime configuration and deployment steps are documented in
`../voice-service/README.md` under **WhatsApp ordering chatbot**.

## Separate Render service

The folder has its own server entry point and a free-plan Render definition.
It starts only `/health`, `/whatsapp/webhook`, and the durable WhatsApp worker;
voice sockets, the Razorpay webhook, checkout HTTP routes, and static files stay
on the existing voice service.

Manual Render settings:

- Root directory: repository root (`.`)
- Build: `cd voice-service && npm ci --include=dev --no-audit --no-fund --loglevel=info && npm run build:whatsapp`
- Start: `cd voice-service && npm run start:whatsapp`
- Health check: `/health`
- Plan: Free (trial only)

Copy the secret environment values from an authorized password manager or
configure fresh values. Never commit them. `TOKEN_SIGNING_SECRET`, Supabase,
provider, and checkout-related values must match the existing production flow.

Tata Omni's Additional Callback URL and Additional Status Callback URL can both
point to `https://<service>.onrender.com/whatsapp/webhook?token=<secret>`. The
same secret must be configured as `TATA_OMNI_WEBHOOK_SECRET` on Render. The
callback route suppresses request URL logging so the token is not logged.

Render Free instances sleep after 15 minutes without inbound traffic. The next
provider callback wakes the service and its durable inbox safely handles
retries, but a free instance cannot guarantee immediate 24/7 replies. Do not
add an internal self-ping loop: it stops when the process sleeps and cannot
provide that guarantee.
