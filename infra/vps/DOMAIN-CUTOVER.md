# Earthora real-domain DNS and cutover

Inspected 21 September 2026. This is a prepared target configuration; no DNS records or production domain settings were changed. The owner still needs to confirm the final domain. Existing application configuration already lists `earthorafarms.com`, so the examples below use it.

## DNS records

The verified Earthora VPS is **187.52.121.146**. The domain currently delegates DNS to Cloudflare (`abby.ns.cloudflare.com`, `moura.ns.cloudflare.com`). Its apex and `www` resolve to Cloudflare proxy addresses; `ai.earthorafarms.com` currently returns NXDOMAIN. Public DNS does not expose the existing proxied origin IP.

At the planned cutover, create or edit these records in the selected domain's authoritative DNS zone:

| Type | Name | IPv4 value | TTL | Purpose |
| --- | --- | --- | --- | --- |
| A | `@` | `187.52.121.146` | 300 | Storefront, business API, browser voice and phone bridge |
| A | `www` | `187.52.121.146` | 300 | Website alias, redirected to the chosen canonical hostname |
| A | `ai` | `187.52.121.146` | 300 | Existing Earthora AI administration console |

Use DNS-only (grey cloud) for the initial direct-origin validation. This is a cutover/testing choice, not a claim that Cloudflare cannot proxy WebSockets. Cloudflare explains the distinction at https://developers.cloudflare.com/dns/proxy-status/ . Edit an existing record rather than adding a conflicting second destination. Preserve email and verification records. Do not replace the currently live apex/`www` records before the server-side domain configuration is prepared.

No separate `api`, `voice`, `livekit`, TURN, SRV or DNS record per model is required by the current deployment. Its public nginx host already routes these services by path. The GPU endpoint remains `https://ai.plymaxx.com/v1`; it does not move to the Earthora VPS or require a new Earthora DNS record.

## Resulting URLs if the final domain is earthorafarms.com

| Service | Target URL |
| --- | --- |
| Website | `https://earthorafarms.com/` |
| Store administration | `https://earthorafarms.com/sun-earthora/` |
| AI administration console | `https://ai.earthorafarms.com/` |
| Earthora business API | `https://earthorafarms.com/api/` |
| Browser LiveKit signaling | `wss://earthorafarms.com/livekit` |
| Tata Smartflo media stream | `wss://earthorafarms.com/ws/voice/smartflo` |
| Smartflo dynamic resolver, if used | `https://earthorafarms.com/voice/stream/endpoint` |

These are target URLs, not a statement that they are live today. DNS supplies hostnames/IPs; the paths above are server routes.

## Server and integration work required with DNS

1. Prepare the existing nginx storefront/console virtual hosts for the confirmed names, preserve current temporary hosts during testing, and provision valid TLS certificates. Verify the existing `/livekit`, Smartflo, API, assets and widget route mappings under the new hosts.
2. Set API `PUBLIC_STORE_URL`, `PUBLIC_API_URL`, `PUBLIC_CONSOLE_URL`, `ASSETS_PUBLIC_BASE` and allowed CORS origins to the confirmed HTTPS URLs. Inspect built storefront/console assets and persisted integration settings for absolute temporary-host references before cutover.
3. Set voice `LIVEKIT_PUBLIC_URL` to the new public WSS signaling URL. Internal Docker/loopback service URLs and GPU model URLs remain internal/existing. Use the active release pointer at `/opt/earthora/SUNPATH_VOICE_ACTIVE`, rather than a historical source directory.
4. After HTTPS and synthetic WSS validation, update the saved Tata Smartflo endpoint to the new media-stream URL. Audit checkout/payment, notification links, callback/webhook registrations, widget origins and website knowledge-source URLs for hostname references. Do not change telephone-number assignments or invoke real calls as part of synthetic verification.
5. Verify canonical redirects, admin login, typed chat, microphone admission, inbound/outbound audio, proactive navigation, and synthetic phone transport. Keep temporary endpoints available until clients/integrations have been verified.

LiveKit media currently uses the VPS's existing TCP7881/UDP7882 transport. These are firewall/media settings, not DNS record values. No new exposed model-service ports are needed for a hostname migration.
