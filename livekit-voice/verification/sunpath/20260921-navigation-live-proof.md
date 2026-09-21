# Real browser navigation proof — 21 September 2026

## Baseline: explicit navigation works

The reported navigation problem was investigated against deployed storefront and API assets at commit `9a820ae`. No frontend source changes were needed for this proof.

One owned synthetic web session used the **actual deployed widget and voice transport, live public session admission, LiveKit SFU, STT and native agent**. The deployed storefront was served through a localhost HTTPS tunnel for instrumentation. Only the HTML test loader and a synthetic audio track were local; navigation events, manifest retrieval, route handling and acknowledgements used the deployed code. The fixture permitted no business mutation endpoints. It did not use the person's microphone.

Input: “Please show me the contact form.”

| Observed event | UTC time |
| --- | --- |
| Real final STT transcript | 04:59:37.920 |
| Trusted navigation received, `contact_form` | 04:59:38.646 |
| `/contact#contact-form` rendered and focused, result `ok:true` | 04:59:39.903 |
| Agent replied “I've opened Send an enquiry…” | 04:59:40.007 |
| Owned session explicitly disconnected | 04:59:51.212 |

The route changed with **one connection and no reconnects**. The completion claim followed the browser acknowledgement by 104 ms. The compact voice strip remained present throughout. No enquiry, callback, notification, order or payment was submitted.

This exercises the actual LiveKit AGENT participant check, canonical destination matching, API manifest, persistent Wouter bridge, target focus and returned acknowledgement. It is stronger evidence than the earlier mocked bridge check. It does not prove that every general product question causes the agent to request navigation.

## Deployed assets and initialization

- Storefront entry: `/assets/index-Drt7C9U4.js` with a committed public-page marker and the expected home section anchors.
- Widget SHA256: `1df3c5ce585c075ed158e12b5901454cc87d818c488336ec1341ae7320b860c7`.
- Voice client SHA256: `92cb540ed468384bb843a2ed7dde562d8ff2398d143af971addad7cd40c8203e`.
- Both public JavaScript hashes exactly matched the working-tree artifacts, including the manifest timeout hardening. Their cache lifetime is 300 seconds; the site guide cache lifetime is 30 seconds.
- The React bridge mounts above the route switch. Widget loading is deferred to idle; the real proof confirmed the bridge was registered before its navigation callback. The storefront's unrelated payment iframe does not host the voice widget or navigation bridge.
- A tab that was already open before deployment retains its loaded JavaScript until refreshed. No active call was forcibly reloaded to update code.

The standalone `/assistant/` page has the widget but no storefront route bridge; its navigation callback returns `unsupported_page`. This is a known limitation of that standalone host, not the product-page entry point in the current report. It was not changed during this investigation.

## Baseline evidence

Task artifacts: `outputs/navigation-live-proof/browser-events.jsonl`, `contact-navigation.png`, the synthetic WAV, and deployed asset hash files. The event file contains only this owned synthetic session's events. No production customer audio or private credentials were captured.

The parent task identified that the recent ordinary product questions did not emit navigation requests. Its server change adds relevant content navigation without requiring words such as “show” or “open.”

## Activated worker: automatic product navigation passes

Worker candidate `764d22021f86` was activated at 05:16:28 UTC. A second owned browser session used the same production assets and live services through the instrumented localhost fixture. The cached synthetic Hindi question was “आपके product में क्या है?” (2.624 seconds). STT returned “आपकी प्रदक्ट में क्या है?”; neither the source nor recognized text requests navigation explicitly.

| Observed event | UTC time |
| --- | --- |
| Synthetic input finished | 05:19:07.248 |
| Real final STT transcript | 05:19:07.965 |
| Trusted `product:<active catalog ID>` navigation received | 05:19:08.684 |
| Actual `/product/<active catalog ID>` rendered; browser result `ok:true` | 05:19:09.283 |
| Grounded Hindi reply text delivered | 05:19:09.392 |
| Agent state reported speaking | 05:19:11.841 |
| Owned session explicitly disconnected | 05:19:21.951 |

The reply was “हर टैबलेट में 500 मिलीग्राम Moringa Leaf है।” The actual product page rendered and its heading received focus. Navigation completed in **599 ms**, and the answer text followed acknowledgement by **109 ms**. There was **one connection, zero reconnects and one explicit disconnect**; the compact voice strip stayed mounted. The agent's speaking-state event arrived 4.593 seconds after synthetic input ended; this is a state-event measurement, not an acoustic first-sample measurement.

The read-only verifier passed the no-navigation-word, product-route, successful-acknowledgement, 500 mg ingredient answer, Hindi script, connection and error checks. Evidence: `outputs/navigation-live-proof/ingredients-browser-events.jsonl`, `ingredients-result.json`, `ingredients-navigation.png` and `ingredients-hi.wav`. No form, notification, checkout or phone action was submitted. No frontend source change or frontend deployment was needed for this correction.
