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

All workspaces typecheck and build. API: 144 passing tests. Storefront: eight passing
tests. Desktop and 390px mobile browser renders show no JavaScript errors or horizontal
overflow; delivery prefill is present, and there are no payment credential fields.
These review-page checks use an intercepted synthetic snapshot and make no payment call.
Live conversational acceptance is coordinated by the Studio operator after activation.

The repository's legacy `test:whatsapp-integration` command currently reports three
passing schema tests and three existing `knowledge-admin.test.mjs` harness failures
(`exports is not defined` in its isolated VM), before application logic executes.

## Staged deployment

- Earthora host: `187.52.121.146`
- Release: `/opt/earthora/releases/voice-actions20260922a`
- API image: `earthora-api:voice-actions20260922a`
- Image ID: `sha256:ba010712c333538dd4026d73773b3af50de4643a9b741b91cbdbe3f29249073c`
- Storefront: `/opt/earthora/releases/voice-actions-store20260922a`

`infra/vps/activate_voice_actions.py --studio-calls-drained` activates only the API
image and storefront root after the operator has drained Studio sessions. It backs
up the previous compose override and Nginx site and restores both automatically on
failure. The worker, typed chat, site widget alias, database schema, other routes and
other applications are unchanged. Previous hashed storefront assets are retained.
The separate Studio runtime/SDK/widget must be deployed in the same coordinated
window to handle `storefront_action` and its acknowledgement protocol.

For an operational rollback after draining sessions: restore the backed-up compose
override and Nginx site, recreate only the API service using the existing compose
files, check `/healthz`, then validate and reload Nginx. Preserve all database data.
