# Website actions and checkout preparation

This release supplies the Earthora side of Studio's acknowledged storefront
actions. It does not restore the historical Render media or checkout service.

- `navigate_site` includes the storefront cart; existing page/section anchors remain.
- `scroll_page` exposes only up/down/top/bottom, with browser movement acknowledgement.
- Successful voice cart changes return IDs and quantities, never browser-trusted prices.
  The SPA fetches the current catalogue and updates only the selected product IDs,
  preserving unrelated manually added items. The voice conversation is authoritative
  for the quantities of products it changes.
- `create_checkout_link` now prepares a functioning `/ai-checkout/vc1.…` review page.
  Its authenticated encrypted snapshot expires after one hour and includes the exact
  cart and validated delivery details. Preparation does not write orders, escalations,
  notification jobs or payment records. Current prices and stock are checked again.
- The review page allows edits and hands payment to the existing user-operated
  Razorpay checkout. There is no browser tool for payment entry or payment submission.
  The payment endpoint validates optional prefilled delivery details; verified provider
  values take precedence when the paid order is finalized.
- Repeated adds check the resulting quantity, and quantity updates check live stock.

## Verification before activation

All workspaces typecheck and build. API: 145 passing tests. Storefront: 11 passing
tests. Desktop and 390px mobile browser renders show no JavaScript errors or horizontal
overflow; delivery prefill is present, and there are no payment credential fields.
These review-page checks use an intercepted synthetic snapshot and make no payment call.
Live conversational acceptance is coordinated by the Studio operator after activation.
An actual HTTP request against the staged API image and production read-only catalogue
also verifies long encrypted-token routing, customer prefill, live pricing and a 404
for malformed tokens. Checkout tokens are excluded from page analytics, Nginx access
logs and Referrer headers. Cancelling during a cart update cannot produce a success
acknowledgement for the interrupted action.

The repository's legacy `test:whatsapp-integration` command currently reports three
passing schema tests and three existing `knowledge-admin.test.mjs` harness failures
(`exports is not defined` in its isolated VM), before application logic executes.

## Staged deployment

- Earthora host: `187.52.121.146`
- Storefront activation release: `/opt/earthora/releases/voice-actions20260922b`
- API follow-up release: `/opt/earthora/releases/voice-actions20260922c`
- API image: `earthora-api:voice-actions20260922c`
- Image ID: `sha256:be96313e4c57bcaed7dd05ccd69989049e539ba10b08facd2a41ff0c02d65bb5`
- Storefront: `/opt/earthora/releases/voice-actions-store20260922b`

`infra/vps/activate_voice_actions.py --studio-calls-drained` activates only the API
image and storefront root after the operator has drained Studio sessions. It backs
up the previous compose override and Nginx site and restores both automatically on
failure. The worker, typed chat, site widget alias, database schema, other routes and
other applications are unchanged. Previous hashed storefront assets are retained.
`infra/vps/activate_voice_actions_api.py` is the API-only C follow-up, preserving the
B storefront and checkout privacy locations. It corrects Fastify's default 100-byte
named-parameter limitation by using a wildcard route; the authenticated snapshot
parser still restricts the token format and maximum length to 8192 characters.
The separate Studio runtime/SDK/widget must be deployed in the same coordinated
window to handle `storefront_action` and its acknowledgement protocol.

For an operational rollback after draining sessions: restore the backed-up compose
override and Nginx site, recreate only the API service using the existing compose
files, check `/healthz`, then validate and reload Nginx. Preserve all database data.
