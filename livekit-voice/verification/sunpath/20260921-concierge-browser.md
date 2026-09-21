# Voice concierge browser verification — 21 September 2026

## Deployed storefront

The storefront is deployed at `/opt/earthora/releases/concierge-store-9380d85ef822`, using the existing production public Vite settings. Only the Earthora storefront Nginx root changed. The previous static files and content-addressed assets remain available, including chunks needed by already-open tabs. API, voice worker, SFU, business data and typed-chat behavior were not changed by this static deployment.

Rollback: `/opt/earthora/backups/pre-concierge-store-20260921T041508Z/rollback.sh`. The script restores the previous Earthora site configuration, validates Nginx, and reloads it. The original root remains `/opt/earthora/www/store`.

The initial health check raced Nginx's asynchronous reload and automatically restored the previous configuration. The successful retry waited for the exact new index. HTTPS checks then verified home and contact HTTP 200, the new navigation bundle, and the API-served compact widget and voice transport. A real Chrome visit independently loaded `/assets/index-Drt7C9U4.js`, the new public section markers, and the Eva launcher. No production voice session was admitted during this browser verification.

## Call controls and navigation

Voice starts minimized as a **280 × 56 px** corner strip. Mute, maximize and end each have a **44 × 44 px** target with keyboard focus and accessible labels. Maximizing/minimizing preserves the same connection. Mute disables only the microphone; incoming audio continues. The competing chat launcher is hidden during the call. On mobile product pages, the strip clears the measured purchase bar by at least 12 px. A blocked audio-autoplay state has a compact Play audio control.

The persistent Wouter bridge lives above the route switch. It navigates within the SPA, waits for the correct page and target to render, then focuses and scrolls with reduced-motion support. An active nonempty form field returns `form_active`; navigation never fills or submits browser forms. Standalone embeds without this bridge return `unsupported_page`, without reloading the host or disconnecting the call.

Only LiveKit AGENT participants can send accepted voice data. Navigation must exactly match the finite API manifest's destination, path and anchor, and a public relative route. External, staff, checkout-token and altered targets are rejected. Action IDs deduplicate retransmits; reused IDs with changed payloads fail. `cancel_navigation` aborts pending observation; a closed call suppresses late acknowledgements. Manifest waiting is limited to four seconds, total navigation has an 8.5-second deadline, and an expired action cannot begin navigation after a suspended tab resumes.

The client sends `client_action_result` after a rendered target is ready. It publishes `client_voice_state` after mute changes, agent arrival, reconnection, and the worker's `request_voice_state` handshake. The worker owns whether muted calls pause idle closure and whether tool narration waits for browser success.

## Public destinations and forms

| Destinations | Existing page/section |
| --- | --- |
| `home`, `products` | `/`, `/#products` |
| `home_benefits`, `home_testimonials`, `home_faq` | `/#benefits`, `/#testimonials`, `/#faq` |
| `our_story`, `health_benefits` | `/our-story`, `/health-benefits` |
| `contact`, `contact_form` | `/contact`, `/contact#contact-form` |
| `faq`, `shipping_policy`, `privacy_policy`, `terms_of_use` | Corresponding existing public routes |
| `product:<active ID>` | `/product/<exact active catalogue ID>` |

The cart is intentionally absent from the API guide: the browser's local cart and voice conversation cart are separate. Checkout tokens, staff pages and result-only order pages are also excluded. Existing contact UI requires name, email and message, with optional phone/topic; the separate backend voice request tools own collection, review, explicit confirmation and durable submission. Newsletter consent, payment controls and all existing typed forms were left unchanged.

Existing marketing-page statements and product accordion text are page content, not additional approved knowledge. Navigating to a section does not authorize the worker to adopt every visible claim as a grounded product fact.

## Verification evidence

- **25 tests across four focused suites passed:** canonical allowlist, stale/duplicate/cancelled actions, four-second manifest timeout, expired deadline, trusted participant handling, microphone-only mute and reconnect state, compact/maximize/end controls, persistent SPA bridge, active form preservation, and focus only after target rendering.
- Storefront TypeScript, browser transport TypeScript, widget JavaScript syntax, browser bundle build and production storefront build passed.
- CUA rendered checks covered desktop and a real **390 × 844** viewport. DOM measurements confirmed the strip and control dimensions. In the mobile product view the purchase bar began at 776.2 px while the strip ended at 764 px.
- A mocked room running the real storefront/widget proved home-to-contact navigation with success acknowledgement and **one connection, zero disconnects**; mute and maximize/minimize preserved that connection. End then produced exactly one disconnect. This is UI lifecycle evidence, not a claim about real microphone, speech or GPU performance.
- Screenshots are in the task's `outputs/voice-concierge-ui/`: `desktop-compact.png`, `mobile-compact.png`, and `production-home.png`. The same directory contains deployment metadata.
- The required repository integration command passed its three PostgreSQL/schema checks. Three unchanged `knowledge-admin.test.mjs` tests fail in the VM harness before handler execution with `ReferenceError: exports is not defined` from TypeScript transpilation. This unrelated harness issue was not changed for the voice UI release.

The final API release `concierge-a10964a58102` serves the compact controls and the manifest/deadline hardening, verified by public TLS artifact hashes and all 25 browser tests. Its activation is recorded in [API evidence](20260921-concierge-api.md). Worker activation and audio acceptance are recorded in [runtime evidence](20260921-concierge-runtime.md). No real enquiry, callback, payment, purchase, notification or telephone call was submitted during these browser checks.
