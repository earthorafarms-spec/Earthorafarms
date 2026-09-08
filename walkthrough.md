# Walkthrough: WhatsApp Production Bug Fixes

## Problem Summary & Root Causes

Following deployment `e710ff6`, three production issues were reported and investigated across the actual inbound payload path:
`provider → inbound → event/state → processTurn → product-card routing`.

### 1. "Hi"/"Hello" sometimes gets no response
- **Root Cause**:
  1. `shouldShowWhatsAppMenu` in `voice-service/src/conversation/controller.ts` relied on a strict greeting regex (`/^(?:hi|hello|hey|namaste|kem cho)$/i`) that missed common variants such as `"hi there"`, `"hello there"`, `"hii"`, `"helo"`, `"namaste ji"`, `"kem cho"`, and punctuation/extra whitespace.
  2. It also blocked greetings if `!awaitingProductOrQuantity` was false. When users were previously shown the product catalog (`PRODUCT_NUMBER_PROMPTS` asking `"Reply with the product number."`), subsequent greetings failed `shouldShowWhatsAppMenu` and fell through to the non-deterministic LLM `chatWithRouting` path.
  3. When an LLM error or timeout occurred on that non-deterministic path, `processInboxEvent` in `worker.ts` marked the inbox event as failed without delivering an outbound message, resulting in silence.

### 2. Clicking native "Benefits" or "Dosage" fell back to "Here are our current products"
- **Root Cause**:
  1. In Meta WhatsApp Cloud API webhooks, native quick-reply button clicks send `type: 'button'` with `{ button: { payload: '...', text: '...' } }`. `metaMessageText` in `whatsapp-chatbot/inbound.ts` was only checking `message.button?.text`, returning the button label (`"Benefits"` / `"Dosage"`), while ignoring `message.button?.payload`. For interactive list/button responses, camelCase keys (`buttonReply`, `listReply`) were also not supported.
  2. `parseProductActionInput` in `whatsapp-chatbot/product-card.ts` only checked for the prefix `__earthora_whatsapp_product_action__:`. Provider payloads with raw `earthora_product:` button IDs were not recognized as `productAction`.
  3. When `inbound.ts` returned plain text (`"Benefits"`), `resolveProductForTurn` in `controller.ts` searched only historical user messages. Since the user had previously replied with a number (`"1"`), the product name was never in `state.messages`, so `resolveProductForTurn` returned `null`.
  4. With `selectedProduct = null`, no approved knowledge facts were fetched (`currentTurnFacts = []`). The fallback prompt lacked grounding, causing the LLM to output catalog listings (`"Here are our current products"`).
  5. When a `productAction` was recognized, `state.messages` previously ended on `role: 'assistant'` without an incoming turn prompt, confusing the LLM context.

### 3. No reliable way to return from product browsing to the main menu
- **Root Cause**:
  1. `shouldShowWhatsAppMenu` did not recognize `"back"`, `"0"`, or Indic equivalents.
  2. `numberedProductSelectionNumber` used `/^\d+$/`, parsing `"0"` as a product number selection rather than a navigation command. Since product lists start at `1`, this yielded an error (`"That is not a valid product number"`), trapping the user.
  3. Product list and product card responses did not provide instructions on how to return to the main menu.
  4. Even when menu commands were sent, `state.whatsAppProductContext` was never cleared or reset.

---

## Minimal Patch Implementation

### 1. `whatsapp-chatbot/inbound.ts`
- Added payload extraction for Meta native button clicks (`message.button?.payload`), camelCase `buttonReply` / `listReply`, and normalized provider structures (`content.button_id`, `button.id`, `envelope.contacts[0].wa_id`).
- Converts button payload IDs matching `productActionInputFromButtonId` to structured action inputs for `processTurn`.

### 2. `whatsapp-chatbot/product-card.ts`
- Updated `parseProductActionInput` to accept both raw button IDs (`earthora_product:...`) and full action inputs (`__earthora_whatsapp_product_action:...`).
- Exported `parseProductActionFromText(text, contextProductId)` to deterministically resolve button label clicks (`Benefits` / `फायदे` / `ફાયદા`, `Dosage` / `खुराक` / `ખોરાક` / `માત્રા`, `Add to Cart`) against the active card context in `state.whatsAppProductContext`.

### 3. `voice-service/src/conversation/controller.ts`
- Added deterministic greeting matching (`isCommonGreeting`) supporting variants: `"hi"`, `"hello"`, `"hey"`, `"hii"`, `"helo"`, `"hi there"`, `"hello there"`, `"namaste"`, `"namaste ji"`, `"kem cho"`, and Indic scripts.
- Added deterministic main menu matching (`isExplicitMenuRequest`) supporting: `"menu"`, `"main menu"`, `"back"`, `"0"`, `"मेनू"`, `"મેનુ"`, `"વાપસ"`, `"પાછા"`.
- Updated `shouldShowWhatsAppMenu`:
  - Triggers immediately on `isExplicitMenuRequest`.
  - Triggers on `isCommonGreeting` unless actively inside address/payment checkout collection or awaiting quantity.
  - Clears `state.whatsAppProductContext` upon showing the menu without altering cart items or checkout fields.
- Fixed `numberedProductSelectionNumber` to `/^[1-9]\d*$/` so `"0"` is never interpreted as an invalid product index.
- Updated `resolveProductForTurn` to check `whatsAppProductContext.productId` as a fallback, ensuring follow-up queries retain the active product context.
- Grounded Benefits and Dosage responses directly in approved knowledge (`currentTurnFacts`), passing turn-scoped prompt instructions into `chatWithRouting` and enforcing `enforceOutputPolicy` without writing synthetic user messages to `state.messages`.
- Included explicit guidance in product catalogs and product cards: `"To return to the main menu, type Menu."`.

---

## Verification Results

| Suite / Step | Command | Result |
| --- | --- | --- |
| Root Typecheck | `npm run typecheck` | Passed (0 errors) |
| Voice Service Typecheck | `npm --prefix voice-service run typecheck` | Passed (0 errors) |
| Focused Regression Tests | `npx vitest run tests/unit/whatsapp-inbound.test.ts tests/unit/controller-state.test.ts tests/unit/whatsapp-worker.test.ts` | Test Files: 3 passed (3)<br>Tests: 51 passed (51) |
| Full Voice Service Tests | `npm --prefix voice-service run test` | Test Files: 22 passed \| 4 skipped (26)<br>Tests: 231 passed \| 5 skipped (236) |
| WhatsApp Integration Tests | `npm run test:whatsapp-integration` | 5 passed, 0 failed |
| Voice Service Build | `npm --prefix voice-service run build` | Passed (`dist/main.js` 269.89 KB) |
| WhatsApp Chatbot Build | `npm --prefix voice-service run build:whatsapp` | Passed (`dist-whatsapp/server.js` 269.90 KB) |
| Root Web App Build | `npm run build` | Passed (Vite production build 7.00s) |

---

## Remaining Production Limitations

1. **WhatsApp Interactive Button Limits**:
   - Meta allows a maximum of 3 quick-reply buttons on an interactive message header card (`Benefits`, `Dosage`, `Add to Cart`). Additional actions require user text input.
2. **Missing Knowledge Fallback**:
   - If admin-approved knowledge is not present in the database for a product's benefits or dosage, the system strictly refuses to speculate or hallucinate health claims (per output policy), informing the user that verified details are unavailable.
3. **Session Reset Timeout**:
   - Clearing `whatsAppProductContext` when returning to the main menu keeps the cart intact. To clear the cart completely, the user must explicitly type "clear cart" or wait for session expiration.
