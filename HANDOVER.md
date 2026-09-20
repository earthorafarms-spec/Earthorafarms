# Earthora — Team Handover

> Authoritative handover for the team taking over Earthora on a new system.
> Last updated 2026-09-20. This file lives on the **`main`** branch (the authoritative branch — see §1).
> **Secrets are NOT in this repo.** Everything a fresh clone lacks is in the separate
> **credentials bundle** (`earthora-credentials-YYYYMMDD.zip`) delivered out-of-band — see §9.

---

## Voice deployment update — 20 September 2026

Web microphone and Tata phone voice now use the MSH/Sun Pathology-derived
LiveKit service under `livekit-voice/`. On the Earthora VPS, read
`/opt/earthora/SUNPATH_VOICE_ACTIVE` for its current immutable release.
GPU inference uses Whisper/IndicConformer,
Indic Parler (Neha across English, Hindi/Hinglish and Gujarati), and Qwen 3.5 9B.
Existing storefront/chat appearance and typed-chat behavior are preserved.

Tata endpoint 2163 now uses
`wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo`.
The legacy `voice-service/` container is retained for rollback; it is not the
active web/phone media path. The current API build context is
`/opt/earthora/releases/knowledge-api-625dc2a12bc8`.

Read [the SunPath deployment handoff](livekit-voice/SUNPATH-DEPLOYMENT.md) and
[runtime guide](livekit-voice/README.md) before deploying voice changes.
These supersede older voice/Render instructions below. Public synthetic tests
passed; a real handset call has not yet been tested. Runtime secrets stay on
the VPS and outside Git.

The September 20 follow-up verifies the nine approved tablet knowledge records
against the legacy bot's configured source; current Postgres records match.
The voice context now preserves complete records and provenance before prompt
budgeting. The same Neha voice uses a pitch-preserving 1.20× tempo on web and
phone. See [the conversation, knowledge and audio verification](livekit-voice/verification/sunpath/20260920-naturalness-and-knowledge.md)
for measured latency and the remaining completed-phrase synthesis limitation.

---

## 0. What Earthora is

Two products in one monorepo:
1. **Storefront** — the public Earthora Farms shop (single-origin organic Moringa). React 19 + Vite + Tailwind.
2. **AI platform** — a scenario-workflow RAG assistant across Chat / Voice / WhatsApp / Calls, with an admin
   console. Fastify API + self-hosted PostgreSQL 17 + pgvector, OpenAI today (Google/Gemini + Chirp behind adapters).

The whole thing was migrated **off Supabase + Netlify + Render** onto one owned stack on a Hostinger VPS.
Background/decision history: `output/earthora-ai-platform-master-plan.md`, `C:\Earthora\migration\progress.md` (in the bundle).

**Live URLs (production, real HTTPS):**
- Storefront → https://earthora.srv1915512.hstgr.cloud
- Admin console → https://ai.srv1915512.hstgr.cloud  (owner: `devarsh@earthorafarms.com`, password + email OTP)
- Assistant page → https://earthora.srv1915512.hstgr.cloud/assistant/`<channel-public-key>`
- Embed widget → `<script src="https://earthora.srv1915512.hstgr.cloud/widget.js" data-channel="pk_…" defer></script>`

These are `*.srv1915512.hstgr.cloud` subdomains (the VPS's own hostname) because the real domain DNS hasn't been
cut over yet — see §12.

---

## 1. Repository & branches — read this first

- Repo: **`github.com/earthorafarms-spec/Earthorafarms`** — **PUBLIC. Never commit a secret.** (`.env`, `apps/api/.env`,
  `.env.infra`, `voice-service/.env` are all gitignored; keep it that way.)
- **`main` is the single authoritative branch.** It contains the full AI platform (`apps/api`, `apps/console`,
  `apps/storefront`) **and** the team's ongoing storefront work. Base all new work on `main`.
- Monorepo: npm workspaces, `apps/*`. Node **>= 22** (no `.nvmrc`; use Node 22.x for reproducibility).
- Two contributors (Devarsh Joshi, "GithubforAdarsh") also commit to `main` — mostly the **legacy** `voice-service/` +
  `whatsapp-chatbot/` (the old Render bots) and storefront tweaks. Coordinate; pull before you push.
- The old `platform/*` branches have been removed — everything in them is already in `main`.
- A git submodule `earthora-messaging-platform` (same org, separate repo) is referenced in `.gitmodules` but is a
  **legacy Python service, not part of the new platform** — you can ignore it; `git submodule update --init` needs
  separate repo access and is not required to build or run anything here.

**New vs legacy code on `main`** (both currently coexist):
| Authoritative (the new platform) | Legacy (old stack, being retired — §12) |
|---|---|
| `apps/api`, `apps/console`, `apps/storefront`, `infra/vps` | `voice-service/`, `whatsapp-chatbot/`, `netlify/`, `supabase/`, `render.yaml`, `output/`, `tmp/`, `z.md` |

---

## 2. Architecture

```
Browser ─┬─ storefront (static)          ┐
         ├─ /assistant + widget.js       ├─ nginx (VPS, TLS) ─┬─ static files /opt/earthora/www/{store,console}
         └─ console (static)             ┘                    └─ /api /media /webhooks → 127.0.0.1:4100
                                                                                          │
   earthora-api (Fastify)  ── SQL ──▶  earthora-postgres (PG17 + pgvector, 127.0.0.1:5433)
   earthora-worker (jobs)  ──────────▶  (same DB; BullMQ-free, Postgres-backed queue)
```

- **apps/api** (Fastify, TS): staff auth (password + email OTP + server sessions, RBAC), a role-scoped table
  **gateway** replacing browser-side PostgREST, storefront + admin endpoints, one commerce contract (pricing/GST/
  orders/invoice PDF), a **Postgres-backed job queue + worker** (invoice/tracking/contact/low-stock emails, KB
  ingestion, schedules), and the AI platform: KB (chunk/embed/retrieve), workflow engine (router → slots →
  retrieval → tools → output policy), functions registry, and the 4 channels.
- **apps/console** (Vite/React): the admin console — Dashboard, Knowledgebase, Workflows, Functions, Channels,
  Conversations, Test Lab.
- **apps/storefront** (Vite/React): the shop. Talks to the API through a thin `supabase`-shaped gateway shim
  (`src/lib/supabase.ts` → `/api/admin/query`); it is NOT Supabase anymore.
- **Providers** behind adapters (`apps/api/src/platform/providers`): OpenAI is the working default for LLM,
  embeddings (text-embedding-3-small, 1536d), STT (whisper) and TTS; Gemini + Google Chirp are ready to switch on
  once the Google project is enabled (§12).

---

## 3. Production runtime (VPS)

- Host: **187.52.121.146** (`srv1915512.hstgr.cloud`), Ubuntu 24.04, **shared** with unrelated tenants
  (`hpai-*`, `sun-*` under pm2 + their own nginx + MariaDB). **Do not touch those.**
- Earthora lives under **`/opt/earthora`**; Docker Compose project **`earthora`**:
  - `earthora-postgres` — `pgvector/pgvector:pg17`, data bind-mount `/opt/earthora/data/postgres`, port `127.0.0.1:5433`.
  - `earthora-api` — built from `/opt/earthora/src-repo` via `apps/api/Dockerfile`, `127.0.0.1:4100`.
  - `earthora-worker` — same image, `ROLE=worker`.
- Runtime definition is **also in git now** at **`infra/vps/`** (compose.yml, compose.override.yml, the two nginx
  vhosts, backup.sh, api.env.example) so the topology is reproducible if the box is lost. The live copies are under
  `/opt/earthora/infra` and `/etc/nginx/sites-available/earthora-*`.
- nginx: `earthora-store` → `earthora.srv1915512.hstgr.cloud` (static + proxy `/api /media /widget.js /assistant
  /webhooks`); `earthora-console` → `ai.srv1915512.hstgr.cloud` (static + `/api /media`).
- TLS: one Let's Encrypt cert for both subdomains, auto-renewed by `certbot.timer` (expiry ~2026-12-14).
- Health path is **`/healthz`** (not `/health`). `/readyz` checks the DB.

---

## 4. Database

- Self-hosted **PostgreSQL 17 + pgvector** (replaces Supabase). Extensions: `vector`, `pgcrypto`, `pg_trgm`. UTC.
- DB `earthora`, user `earthora`, password = `POSTGRES_PASSWORD` / `EARTHORA_PG_PASSWORD` (in the bundle).
- ~58 tables, ~13 MB. Commerce tables keep their original names (migrated as-is). Platform tables are new
  (`kb_*`, `workflows`, `functions`, `channels`, `conversations`, `conversation_state`, `messages`, `turn_traces`,
  `inbound_events`, `escalations`, `jobs`, `staff_users`, …).
- Connect on the box: `docker exec -it earthora-postgres psql -U earthora -d earthora`.
  From a laptop: `ssh -i earthora_kvm -L 5433:127.0.0.1:5433 root@187.52.121.146` then
  `psql postgres://earthora:<pw>@127.0.0.1:5433/earthora`.

### Backups (set up 2026-09-19)
- Nightly **`pg_dump -Fc`** at **02:30 UTC** via cron → `/opt/earthora/backups/earthora-<ts>.dump`, 30-day retention,
  logged to `backup.log`. Script: `/opt/earthora/infra/backup.sh` (also in git at `infra/vps/backup.sh`).
- **TODO (do this):** copy the nightly dump **off-site** (the bundle has R2 S3 creds — push to a bucket, or scp to
  another host). On-box backups alone don't survive a host failure.
- **Restore drill (test it):**
  `scp earthora-<ts>.dump onto the box` → `docker exec -i earthora-postgres pg_restore -U earthora -d earthora_restore --clean` (into a scratch DB first). The one-time migration source is `/opt/earthora/migration/supabase-public-20260915.dump`.

---

## 5. Local development

```bash
git clone https://<GITHUB_PAT>@github.com/earthorafarms-spec/Earthorafarms.git
cd Earthorafarms && npm install          # Node >= 22
# restore env files from the credentials bundle:
#   env/master.env.infra      -> .env.infra
#   env/api.local.env         -> apps/api/.env
#   env/storefront-netlify.env-> .env         (legacy; only if touching old netlify/voice code)
# The api.local.env points DATABASE_URL at the VPS DB through an SSH tunnel:
ssh -i earthora_kvm -L 5433:127.0.0.1:5433 root@187.52.121.146   # keep open
npm run dev:api      # http://localhost:4100
npm run dev:store    # http://localhost:5173  (proxies /api -> 4100)
npm run dev:console  # http://localhost:5174
```
- Local login uses `DEV_LOGIN_OTP` (in `apps/api/.env`) so you don't need a real email OTP in dev. It is
  **non-production gated** (never active when `NODE_ENV=production`).
- Tests: `npm run test -w @earthora/api` (26 unit: pricing parity, GST/coupon, output policy, chunking) and
  `npm run test:schema` (6 PGlite schema regressions). `npm run typecheck` across all workspaces.

---

## 6. Front-end build-time env (important)

The storefront/console are static builds; some values are **baked in at build time**, not read at runtime:
- `apps/storefront/.env.production` (tracked in git — safe, values are public):
  - `VITE_RAZORPAY_KEY_ID=rzp_live_TGSxIdDZlPGyVI` — the Razorpay **publishable** key id (public by design).
  - `VITE_API_URL=` **empty on purpose** → the storefront calls **same-origin `/api`** (nginx serves the store and
    proxies `/api` to the API on the same host). Leave empty for the current same-origin deploy. Only set it if you
    ever host the storefront on a *different* origin than the API.
  - `VITE_VOICE_SERVICE_URL=` empty → the old Render voice-order form is unused by the new platform.
- The **console** calls same-origin `/api` too (its nginx vhost proxies `/api`), so it needs no build-time API URL.
- Consequence: after DNS cutover (§12) to `earthorafarms.com`, no storefront rebuild is needed for the API URL
  (still same-origin); you only change nginx `server_name`, the API's `PUBLIC_*_URL` / `CORS_ORIGINS`, and reissue TLS.

---

## 7. Deploy & rollback (currently manual — no CI/CD yet)

**API + worker (code change under `apps/api`):**
```bash
ssh -i earthora_kvm root@187.52.121.146
cd /opt/earthora/src-repo && git fetch origin && git checkout main && git reset --hard origin/main
cd /opt/earthora/infra && docker compose build api && docker compose up -d --force-recreate api worker
docker logs earthora-api --tail 20    # confirm "Server listening"
```
- Migrations do **NOT** run automatically on container start (`CMD node dist/main.js`). Migrations that DO exist run
  via `migrate.ts` on boot inside `main.ts`'s startup — confirm in logs ("migration applied: …"). If you add a
  migration under `apps/api/src/db/migrations`, deploy applies it on the next API start; verify in `docker logs`.
- **Rollback:** the image is tagged only `earthora-api:latest` (no versioned tags). To roll back, `git checkout`
  the previous commit in `src-repo` and rebuild. **Improvement to make:** tag images per release
  (`earthora-api:<gitsha>`) so rollback is instant.

**Storefront / console (static):**
```bash
# on your machine:
npm run build -w @earthora/storefront   # -> apps/storefront/dist
npm run build -w @earthora/console      # -> apps/console/dist
tar -C apps/storefront/dist -czf store.tgz . && tar -C apps/console/dist -czf console.tgz .
scp -i earthora_kvm store.tgz console.tgz root@187.52.121.146:/opt/earthora/
ssh -i earthora_kvm root@187.52.121.146 'tar -C /opt/earthora/www/store -xzf /opt/earthora/store.tgz && tar -C /opt/earthora/www/console -xzf /opt/earthora/console.tgz'
```
- **Improvement to make:** a `scripts/deploy.sh` + GitHub Actions pipeline; right now deploy is manual.

---

## 8. AI platform operating notes

- **Console → Test Lab** talks to the live engine exactly as a customer would; use it to sanity-check after changes.
- **Knowledgebase**: "Index entire website" crawls the storefront + syncs product docs; you can also upload files
  (PDF/DOCX/XLSX/HTML) or use "test retrieval". KB is grounding only — prices/stock/orders always come from live
  functions, never the vector store.
- **Workflows** are the product's core: each is a scenario playbook (when-to-use, slots, allowed sources/tools,
  playbook). "Draft with AI" generates one from a plain-language description. Publish re-embeds its example
  utterances (used by the router).
- **Output policy** is enforced server-side: the assistant never claims an order is placed / payment taken and never
  asks for card/OTP/CVV (verified). Keep those guarantees if you touch `apps/api/src/platform/engine`.

---

## 9. Credentials bundle (out-of-band, NOT in git)

The file **`earthora-credentials-YYYYMMDD.zip`** (delivered separately; point-in-time snapshot) contains everything a
fresh clone lacks. Open **`ACCESS.md`** inside for the full map. Contents:
- `ssh/earthora_kvm(.pub)` — VPS root SSH key (`chmod 600` after extracting).
- `env/master.env.infra` — every provider/API secret + VPS host + Postgres password (the master key file).
- `env/api.production.env` — the live API env from the box (COOKIE_SECRET, TOKEN_SIGNING_SECRET, PII_ENCRYPTION_KEY,
  provider keys). `env/postgres.compose.env` — `POSTGRES_PASSWORD`.
- `env/api.local.env`, `env/storefront-netlify.env`, `env/voice-service.env` — dev + legacy envs.
- `docs/` — CLAUDE.md (repo operating rules), phase-0-inventory.md, progress.md.
- **Also transfer separately** (currently only on the origin machine, not in the bundle or git):
  `C:\Earthora\Docs\` (E-34 lease, moringa crop guide, farm-worker plan) — business reference docs.

**Handling:** secure channel only; never commit, never email in plaintext; it goes stale if server env changes —
verify restored env against the live box.

### Account logins the owner must grant (NOT in the bundle — only API keys are)
Hostinger VPS/DNS control panel · GitHub org **ownership** of `earthorafarms-spec` · the `earthorafarms.com` domain
registrar · dashboard logins for Razorpay, Cloudflare/R2, Resend, OpenAI, Google/Gemini, Sarvam, Tata.

### Secret rotation (do this, carefully)
- **Rotate to per-person credentials:** the shared **root SSH key** and the **GitHub PAT** (currently embedded in the
  on-box git remote at `/opt/earthora/src-repo` and used in clones). Move to SSH deploy keys / per-engineer PATs.
- Safe to rotate anytime: Razorpay secret, Resend, Tata Omni token, OpenAI/Gemini/Sarvam keys.
- **DO NOT casually rotate:** `PII_ENCRYPTION_KEY` (rotating makes encrypted PII columns unreadable),
  `TOKEN_SIGNING_SECRET` (invalidates signed invoice links), `COOKIE_SECRET` (logs everyone out).
- Revoke the old, unrelated Supabase service-role JWT for project `ivhmxnixagdjtgjgchmo` (was once committed in a
  now-deleted `check-prods.mjs`; treat as compromised).

---

## 10. Verified state (2026-09-19 audit)

- Storefront, catalog API, platform health, `widget.js`, console — all **HTTP 200**.
- Live AI turn ("do you ship internationally?") → routed `policies`, grounded India-only answer citing the shipping
  policy. Order-status refuses a wrong phone; prompt injection rebuffed; no fabricated health claims; card/OTP refused.
- DB: PG17 + pgvector, 3 extensions, 58 tables; KB 7 docs / 9 chunks (9/9 embeddings), 6 workflows published, 10
  functions, 4 channels, 17 conversations. Providers health: `openai:true`, `google_cloud:false`.

---

## 11. Risks / open hardening

- **Single VPS, shared with other tenants**, `ufw` inactive (app ports are bound to 127.0.0.1, so not publicly
  exposed). Consider a dedicated host and enabling a firewall.
- **No monitoring/alerting** — the only health signal is manual `/healthz`. Add uptime + error tracking.
- **No CI/CD**, images only `:latest` — see §7 improvements.
- **Public repo hygiene:** `supabase/.temp/` exposes the (old) Supabase project ref/name — untrack it. Two
  secret-*shaped* placeholders in `apps/storefront/src/pages/developer/dashboard.tsx` are mock display values
  (`sk_live_chat_…`, `va_live_voice_…`) — confirm before relying on them being harmless.

---

## 12. Remaining owner-gated work (the platform is running, but not "go-live" complete)

1. **AI-checkout payment page + the compulsory live ₹ Razorpay trial.** The assistant already builds a secure
   checkout link and stores it (an `escalations` row) + notifies staff, but the `/ai-checkout/<token>` landing page
   that takes the real Razorpay payment isn't built. This is where the small live-money trial runs. Owner triggers it.
2. **DNS cutover to the real domains.** Point `earthorafarms.com` + `ai.earthorafarms.com` at the VPS. The
   `CLOUDFLARE_API_KEY` in the bundle is an **R2/S3** key, **not DNS-edit** — get a Cloudflare **DNS-edit token** (or
   have the owner change DNS). Then: add nginx `server_name`s, reissue the TLS cert (certbot), update the API's
   `PUBLIC_*_URL` + `CORS_ORIGINS`, and force-recreate the API. No storefront rebuild needed (same-origin, §6).
3. **Enable Google/Gemini.** The Google project is billing-blocked (health shows `google_cloud:false`). Add a
   service-account JSON on an enabled project to switch providers per-channel and turn on Chirp voice.
4. **WhatsApp / Calls live trials.** Tata Omni is wired — point the number's webhook to
   `https://earthora.srv1915512.hstgr.cloud/webhooks/whatsapp`. Smartflo calls need the DID repointed.
5. **Go-live data.** The single active product is test data (`slug='cheese'`, price ₹1 vs mrp ₹999) — fix before
   launch. **Product images still point at Supabase storage** (`cewnocilnkbvxwdkrvyn.supabase.co`) — migrate image
   hosting to R2/owned storage **before** deleting the Supabase project.
6. **Retire the old stack** (Render `voice-service` + `whatsapp-chatbot`, Netlify, Supabase) only **after** the
   channel live-trials pass and image hosting is migrated. Safe order: repoint channels → verify → drop Render/Netlify
   → migrate images off Supabase → drop Supabase last.

---

🤖 Handover prepared with [Claude Code](https://claude.com/claude-code)
