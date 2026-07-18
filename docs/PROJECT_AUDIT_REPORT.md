# Earthora Farms Website Audit Report

Date: 18 July 2026  
Scope: Local source review of the Vite/React codebase in this repository, build/typecheck validation, dependency audit, and review of client-side security/data-flow assumptions.

## Executive Summary

The project currently builds successfully and has no known dependency vulnerabilities from `npm audit`. However, it should not be treated as production-secure in its current form.

The biggest hidden issue is that security-sensitive behavior is implemented in the browser. The admin area is protected only by a hardcoded password in `src/App.tsx`, and chat logs are queried from Supabase directly in the client. Any real protection must therefore exist in Supabase Row Level Security (RLS), database policies, and server-side/API boundaries. This repository does not contain Supabase schema or RLS policy files, so those controls cannot be confirmed from the codebase.

Risk level today: **High** if deployed publicly with real customer/admin data.

## Remediation Status

Started on: 18 July 2026

Implemented in this repository:

- Removed the `VITE_SUPABASE_SERVICE_ROLE_KEY` pattern from `.env` and added a safe `.env.example`.
- Changed Vite dev/preview defaults from public `0.0.0.0`/all-hosts to localhost-only unless explicitly configured.
- Replaced the hardcoded admin password gate with Supabase Auth and an admin `app_metadata` role check.
- Wired the public auth page to Supabase login, signup, and password reset flows.
- Replaced the browser-direct Ollama call with a Netlify serverless function at `/.netlify/functions/chat`.
- Added server-side chat limits, timeout, topic guardrails, and server-only `OLLAMA_BASE_URL`/`OLLAMA_MODEL` usage.
- Stopped new chat sessions from storing browser user-agent strings.
- Added a visible chat logging notice and message length limits.
- Wired the contact form to Netlify Forms-compatible submission with success/error feedback.
- Added `public/_headers` for CSP and browser security headers.
- Added `netlify.toml` for build/function configuration.
- Added `supabase/migrations/20260718000000_security_policies.sql` as the baseline RLS policy migration.
- Replaced admin dashboard SVG HTML injection with normal image rendering.
- Added `docs/SECURITY_DEPLOYMENT_CHECKLIST.md`.

Still required outside the repository:

- Apply and verify the Supabase RLS migration in the live Supabase project.
- Assign admin users immutable Supabase `app_metadata` claims.
- Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` as server-only deployment environment variables.
- Configure Netlify Forms/spam controls and verify submissions in production.
- Rotate any real service-role key if it was ever stored under a `VITE_` variable.

## What Was Checked

- Project structure and routing.
- Supabase usage and client-side data access.
- Admin access control.
- Chat widget data collection and AI endpoint integration.
- Environment variable naming and exposure risk.
- Contact, auth, cart, product, admin, and analytics flows.
- Vite build/development server settings.
- Dependency vulnerability status using `npm audit`.
- Production build output size and warnings.

Validation results:

- `npm.cmd run typecheck`: Passed.
- `npm.cmd run build`: Passed.
- `npm.cmd audit --audit-level=moderate`: Passed, 0 known vulnerabilities.

## Critical Findings

### 1. Admin authentication is fully client-side and bypassable

Evidence:

- `src/App.tsx:26` trusts `sessionStorage.getItem("admin_authenticated")`.
- `src/App.tsx:33` contains the hardcoded admin password.
- `src/App.tsx:34` sets the admin flag in browser storage.
- `src/App.tsx:113-127` renders admin routes after this browser-only check.

Impact:

Anyone with browser dev tools can set `sessionStorage.admin_authenticated = "true"` and access the admin UI. The hardcoded password is also visible in the JavaScript bundle. This is not real authentication.

Current severity: **Critical**.

Required fix:

- Remove the hardcoded `AdminGate`.
- Use real Supabase Auth or another identity provider.
- Create an admin role/claim.
- Enforce authorization in Supabase RLS and/or server-side endpoints.
- Never rely on React route guards for data protection.

### 2. Supabase admin chat data may be exposed if RLS is not strict

Evidence:

- `src/pages/admin/chat.tsx:35-44` selects all chat sessions.
- `src/pages/admin/chat.tsx:57-60` selects messages for any selected session id.
- `src/components/chat/ChatWidget.tsx:109-113` inserts chat sessions from the public browser.
- `src/components/chat/ChatWidget.tsx:126-130` inserts full chat message content from the public browser.
- No Supabase migration or policy files were found in the repo.

Impact:

If Supabase RLS permits the anon key to read `chat_sessions`, `chat_messages`, or joined `users`, visitor transcripts, user agents, names, and emails could leak. If anon inserts are too broad, attackers can spam chat tables, forge records, or inflate storage.

Current severity: **Critical until RLS is verified**.

Required fix:

- Enable RLS on all Supabase tables.
- Allow anonymous users only to insert minimal chat records, never select/update/delete.
- Allow admins to read chat logs only through authenticated admin roles.
- Avoid joining user profile data to chat logs in a public client query.
- Add database migration/policy files to the repository.

### 3. Service-role key is named as a Vite client variable

Evidence:

- `.env` contains `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- `src/lib/supabase.ts:3-4` correctly uses only URL and anon key, but any variable prefixed with `VITE_` is intended for client exposure in Vite.

Impact:

The current value appears to be a placeholder, and it was not found as an active source usage. But if a real Supabase service-role key is ever placed in a `VITE_` variable, it can be exposed to browser-side code. A real service-role key bypasses RLS and would allow full database compromise.

Current severity: **Critical if the value is real; High as a configuration pattern**.

Required fix:

- Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` immediately.
- If a service-role key is needed, store it only in a server-only environment variable such as `SUPABASE_SERVICE_ROLE_KEY`.
- Rotate the service-role key if a real value was ever used in local, deployed, or shared environments.

### 4. AI/Ollama endpoint is called directly from the browser

Evidence:

- `src/components/chat/ChatWidget.tsx:7-9` defines a browser-visible Ollama base URL and model.
- `src/components/chat/ChatWidget.tsx:218-234` sends user prompts directly to `${OLLAMA_BASE_URL}/api/chat`.
- `.env` includes `VITE_OLLAMA_BASE_URL`.

Impact:

Anyone can discover and call the AI endpoint directly. If the endpoint is tunnelled or public, it can be abused for compute, prompt attacks, denial of service, or unwanted content generation. There is no server-side rate limiting, origin validation, authentication, timeout budget, or usage quota in this repo.

Current severity: **High**.

Required fix:

- Put AI calls behind a serverless function/API route.
- Keep model host details server-side.
- Add per-IP/session rate limits, request size limits, timeout limits, and logging.
- Validate CORS strictly.
- Consider moderation and abuse detection before requests reach the model.

## High-Priority Findings

### 5. Chat logging captures potentially sensitive personal data without visible consent controls

Evidence:

- `src/components/chat/ChatWidget.tsx:112` stores `navigator.userAgent`.
- `src/components/chat/ChatWidget.tsx:126-130` stores full message content.
- `src/pages/admin/chat.tsx:37-42` fetches user id, user agent, timestamps, and joined user name/email.

Impact:

Customers may enter health questions, contact details, order issues, or other personal information. This is stored as telemetry and shown in admin logs. The UI does not clearly disclose transcript storage before collection, and the code does not implement retention/deletion rules.

Current severity: **High**.

Required fix:

- Add a clear chat privacy notice before first message.
- Avoid storing unnecessary identifiers such as full user agent unless needed.
- Add transcript retention limits.
- Provide deletion/export processes where required.
- Mask emails, phone numbers, and addresses in logs if analytics only need aggregate insights.

### 6. Contact and auth pages look functional but do not perform real actions

Evidence:

- `src/pages/contact.tsx:65` prevents form submission without sending or storing the message.
- `src/pages/auth.tsx:142` prevents login/signup submission without calling Supabase Auth or another backend.

Impact:

Users may believe they contacted the business or created/logged into an account when no backend action happened. This is a trust and operations issue, and it can also cause lost customer inquiries.

Current severity: **High for business reliability; Medium for security**.

Required fix:

- Wire contact form to a backend, email service, Netlify Form, or Supabase table with spam controls.
- Wire auth form to Supabase Auth, remove fake account messaging, or clearly mark it unavailable.
- Add success/error states based on real backend responses.

### 7. Security headers are missing from the repo deployment config

Evidence:

- `public/_redirects:1` only configures SPA fallback.
- No `_headers`, `netlify.toml`, or equivalent security-header configuration was found.

Impact:

The deployed app may lack CSP, clickjacking protection, MIME sniffing protection, referrer controls, and browser permission restrictions. This matters more because the app loads third-party fonts, calls Supabase, calls an AI endpoint, and stores chat content.

Current severity: **High**.

Required fix:

Add deployment headers similar to:

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://your-chat-api.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

Tune `connect-src` to the real Supabase and API domains.

## Medium-Priority Findings

### 8. Vite dev and preview server allow all hosts

Evidence:

- `vite.config.ts:30-31` binds dev server to `0.0.0.0` with `allowedHosts: true`.
- `vite.config.ts:37-39` does the same for preview.

Impact:

This is risky on shared networks or exposed machines because hostile hosts can reach the local dev/preview server. It is usually not a production problem, but it can leak local builds, environment-derived behavior, or source maps during development.

Current severity: **Medium**.

Required fix:

- Use `host: "127.0.0.1"` for local development by default.
- Set explicit allowed hosts only when LAN testing is required.
- Do not expose Vite dev server to the public internet.

### 9. `dangerouslySetInnerHTML` is used for the admin map

Evidence:

- `src/pages/admin/dashboard.tsx:115` injects fetched SVG markup into the page.

Impact:

The SVG is loaded from `/world-map.svg` and partially cleaned before injection. If that file or response is modified maliciously, this can become an XSS vector. The current source is local static content, so the practical risk is lower than user-provided HTML, but the pattern is still sensitive.

Current severity: **Medium**.

Required fix:

- Prefer importing the SVG as a React component or sanitized asset.
- If runtime injection is required, sanitize using a trusted sanitizer and lock CSP.

### 10. Client-side guardrails do not secure the AI assistant

Evidence:

- `src/components/chat/ChatWidget.tsx:152-173` uses keyword matching for prompt-injection and topic filtering.
- `src/components/chat/ChatWidget.tsx:224-226` still sends the system prompt and chat history to the model.

Impact:

Keyword filtering is easy to bypass. It may reduce casual off-topic use but cannot enforce model behavior or business policy. Because the AI endpoint is directly callable, attackers can skip the UI guardrails entirely.

Current severity: **Medium to High**, depending on public exposure of the Ollama endpoint.

Required fix:

- Move guardrails server-side.
- Add deterministic validation before model calls.
- Add rate limits and abuse logging.
- Keep system prompts server-side if prompt confidentiality matters.

### 11. Build bundle is large

Evidence:

- Production JS bundle: about `819.13 kB` minified, `234.42 kB` gzip.
- Vite emitted a chunk-size warning over 500 kB.
- Several PNG assets exceed 700 kB to 1.2 MB.

Impact:

The static site can still scale well through a CDN, but large bundles reduce first-load performance, especially on mobile networks. This affects conversion, SEO signals, and perceived reliability under traffic spikes.

Current severity: **Medium**.

Required fix:

- Code-split admin routes and modal-heavy pages with dynamic imports.
- Lazy-load gallery/farm images.
- Convert large PNGs to WebP/AVIF.
- Use responsive image sizes.

## Data-Leak Assessment

### Confirmed local/config risks

- A service-role environment variable name exists with a `VITE_` prefix. It should be removed even though the current value appears placeholder-like.
- Admin password is embedded in frontend code and can be discovered by users.
- Chat transcripts and user-agent strings are sent to Supabase.
- The public frontend directly knows the AI endpoint URL.

### Potential data leaks requiring Supabase verification

These cannot be confirmed from this repo because RLS policy files are absent:

- Whether anonymous users can read `chat_sessions`.
- Whether anonymous users can read `chat_messages`.
- Whether anonymous users can join chat sessions to user profile data.
- Whether users can read or modify each other's chat messages.
- Whether insert policies restrict columns, size, and ownership.
- Whether admin read access requires a real server-side role.

Recommended Supabase policy target:

- Anonymous browser users: insert-only into controlled chat tables, no select/update/delete.
- Authenticated normal users: read only their own records if customer account features are implemented.
- Admin users: read/update through explicit admin role claims.
- Service role: only used from trusted server-side code.

## Request/Traffic Capacity Assessment

The website itself is a static Vite app. Static pages, JS, CSS, and images can handle very high traffic if served from a CDN or static host such as Netlify, Vercel, Cloudflare Pages, or S3/CloudFront. The bottlenecks are not React rendering on the server because there is no server-side rendering in this repo.

### Static site capacity

Expected capacity depends on the hosting platform/CDN, but the app is fundamentally cacheable. With proper CDN caching and optimized assets, it can serve thousands to hundreds of thousands of page views per day without application-server scaling concerns.

Current limiting factors:

- Large JS bundle.
- Large image assets.
- No explicit long-term cache headers in the repo.
- Google Fonts dependency adds third-party network dependency.

### Supabase capacity

Every chat message writes to Supabase. Admin chat reads can query full session/message tables. Capacity depends on Supabase project tier, RLS/indexes, row volume, and query patterns.

Current risk:

- No pagination is visible in admin chat session query.
- No rate limiting is visible before anonymous inserts.
- No request-size limit is visible for chat messages.
- Attackers can generate write load if anon insert policies allow it.

### AI/Ollama capacity

This is the weakest capacity point. A public Ollama model endpoint can usually handle far fewer concurrent requests than a CDN or managed API. The UI streams responses and limits tokens to 128, but there is no global queue, rate limit, or concurrency control in the repo.

Practical result:

- Static site: likely high capacity.
- Supabase chat logging: moderate capacity if indexed and rate-limited; risky if public inserts are unrestricted.
- Ollama chat: likely low to moderate capacity unless separately provisioned, proxied, and protected.

## Other Hidden Issues

### Demo admin data may be mistaken for real state

Several admin pages use local hardcoded arrays and local React state for products, orders, coupons, revenue, and analytics. Changes disappear on refresh and do not persist to a backend.

Risk:

- Business users may believe products/orders/coupons are being managed for real.
- Security expectations may be wrong because UI controls exist without server authorization.

### Cart and review data are local-only

Cart data is stored in `localStorage`, and product reviews are kept only in component state. This is acceptable for a prototype but not for real commerce.

Risk:

- Cart tampering is trivial.
- Prices cannot be trusted from the frontend.
- Fake reviews can be submitted locally but do not persist.
- There is no checkout/order creation backend.

### Encoding artifacts appear in source/UI text

Several files show mojibake such as `â€”`, `â‚¹`, and `ðŸŒ¿`. This suggests text encoding issues in source or tooling.

Risk:

- Unprofessional UI text.
- Possible SEO/accessibility quality issues.
- Incorrect currency display.

## Recommended Remediation Plan

### Phase 1: Immediate security cleanup

1. Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` from all environments.
2. Rotate Supabase service-role key if a real value was ever stored under that name.
3. Replace browser-only admin password with Supabase Auth.
4. Add and verify Supabase RLS policies for all tables.
5. Disable anonymous reads on chat/admin data.
6. Move Ollama calls behind a server-side API.
7. Add basic security headers.

### Phase 2: Data protection and abuse controls

1. Add chat rate limiting by IP/session.
2. Add max message length and transcript retention.
3. Add privacy notice and consent for chat logging.
4. Add pagination to admin chat logs.
5. Add audit logging for admin access.
6. Add server-side validation for contact/auth/order flows.

### Phase 3: Production readiness

1. Implement real contact submission.
2. Implement real auth flow or remove the auth page until ready.
3. Replace demo admin data with backend data protected by server-side auth.
4. Implement real order creation and checkout logic.
5. Optimize bundle and images.
6. Add deployment cache headers.
7. Add monitoring for frontend errors, Supabase errors, and AI failures.

## Suggested Security Acceptance Checklist

Before production launch:

- No service-role key exists in any `VITE_` variable.
- Admin route requires real authenticated admin identity.
- Supabase RLS is enabled on every table.
- Anonymous users cannot select chat/admin/customer/order data.
- Anonymous inserts are limited to specific tables and columns.
- AI endpoint is not directly reachable from arbitrary browsers.
- Rate limits exist for chat, contact, auth, and order endpoints.
- CSP and security headers are deployed.
- Contact and auth forms either work or are clearly disabled.
- Product price and order totals are calculated server-side.
- Logs do not store unnecessary personal data.
- Dependency audit is clean.
- Typecheck and production build pass.

## Bottom Line

The current codebase is a strong frontend prototype, but it is not yet a secure production commerce/admin system. The website can likely handle high static traffic through a CDN, but the live data and AI portions need server-side boundaries, RLS verification, rate limiting, and secret hygiene before real customer data should flow through it.
