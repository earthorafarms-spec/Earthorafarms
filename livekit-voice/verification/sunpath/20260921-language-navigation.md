# Language agreement and proactive navigation — 21 September 2026

## Reported behavior and changes

The reported Hindi agreement error was present in generated reply text, rather than introduced by speech synthesis. An ASR filler prefix caused a language-only request to bypass the finite acknowledgement. A shared, bounded language-request parser now recognizes that request and responds **“हाँ, मैं हिंदी में बात कर सकती हूँ।”** Base and current-turn instructions reinforce feminine first-person agreement and everyday Hinglish. Narrow corrections of observed malformed agreement apply only to generated prose, before the existing output guard; quoted values and request readbacks are not rewritten.

Gujarati remains automatic across turns. Its original-audio Indic re-recognition path now catches additional short/fused Gujarati phonetic forms sometimes decoded by Whisper as Hindi. See `20260921-gujarati-recognition.md` for measured synthetic recognition evidence and limits.

The browser transport already supported explicit navigation. Ordinary questions about products, ingredients, benefits and the company did not reliably invoke it. The native worker now selects the relevant destination from the public site guide and uses the existing acknowledged navigation action. After arrival it answers the actual question. A compound “open this page and explain” request likewise continues to the answer instead of replacing it with a generic opening acknowledgement.

Navigation avoids repeating the current destination, pauses during an active enquiry, and excludes dosage, cart, account, payment and order-specific state. An explicit request to stay on the page disables automatic navigation; a later explicit opening request still works. No automatic browser actions are issued for phone sessions. Public destinations, caller identity, interruption/epoch checks, action acknowledgement and request confirmation requirements remain enforced.

## Verification

- Immutable runtime candidate: `sunpath-voice-764d22021f86`.
- **795 runtime tests passed** inside the production Linux image with its installed LiveKit SDK, network disabled. One pre-existing Python `audioop` deprecation warning remains.
- The previous storefront/API assets are unchanged. The explicit navigation baseline and subsequent real-browser check are recorded in `20260921-navigation-live-proof.md`.
- **25 native-agent turns passed** using the real GPU model and production context/tool schemas: `20260921-language-navigation-qa.json`. These cover Hindi acknowledgement, automatic Gujarati replies from an English-started session, proactive benefits/company navigation, compound opening/explanation, request collection, and phone behavior. Request writes and browser acknowledgements in this text-only QA are simulated; it sends no notifications, purchases or real requests.

The extended compound-request check also exposed a grounded company answer being replaced by the factual guard because its optional trailing offer mentioned “health benefits.” A bounded trim removes only that extra topic-offer after a substantive company answer. It preserves the answer verbatim, sole questions, uncertainty and purchase/enquiry flows. The source selection and factual guard are unchanged; an actual unsupported benefit claim still fails validation.

Recognition and native model checks cannot guarantee perfect grammar or detection for every accent or very short utterance. The standalone `/assistant/` diagnostic host still lacks the storefront route bridge; website navigation is supported from the public storefront widget.

## Deployment

Activated at **2026-09-21 05:16:28 UTC**, after confirming zero active rooms. Agent, voice-control and API readiness returned HTTP200. Only voice worker/control services were recreated; the storefront and API releases are unchanged.

- Image: `earthora-livekit-agent:sunpath-764d22021f86`.
- Image ID: `sha256:3135776795c6b2dbfc7f893e8e861c05409e7e6e72a7997c45e7817133aeda4d`.
- Previous release: `/opt/earthora/releases/sunpath-voice-0513efa1471b`.
- Rollback snapshot: `/opt/earthora/backups/pre-concierge-voice-20260921T051616Z`.
- TTS profile/speed, idle settings, model endpoints and capacity limits are unchanged.

Postactivation browser verification passed: the spoken Hindi ingredient question automatically opened the active product route, acknowledged completion in599ms, and returned the approved500mg answer109ms after acknowledgement. One connection, zero reconnects and one explicit disconnect were observed. API/control/agent health remained healthy with zero restarts and zero remaining rooms after the test; see `20260921-language-navigation-health.txt`.
