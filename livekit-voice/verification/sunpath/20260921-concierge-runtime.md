# Voice concierge runtime — 21 September 2026

## Scope

The existing storefront and typed chat retain their design. Voice opens in a
280 × 56 px strip with microphone mute/unmute, maximize and end controls.
Maximizing/minimizing preserves the connection; microphone mute leaves incoming
audio enabled. The persistent storefront bridge supports finite public page and
section destinations, preserving the call across SPA navigation. See
[browser evidence](20260921-concierge-browser.md) and
[API evidence](20260921-concierge-api.md).

Eva introduces herself as an AI shopping guide and asks whether the visitor
needs personal shopping, business buying or order help. The prompt prioritizes
the immediate question and one useful follow-up. Current catalogue and approved
knowledge remain the only fact sources. Medical, pricing, checkout and payment
constraints remain in force; page content is not automatically approved spoken
knowledge. Phone sessions share the same persona, providers and enquiry tools,
but have no website navigation tool.

## Reliable actions and requests

Explicit page-opening commands select an existing native navigation tool.
Success is spoken only after the admitted browser caller acknowledges a rendered
destination. Interruptions and timeouts cancel pending actions. Muted web calls
pause the idle-disconnect check; the overall session limit still applies.

Clear callback/enquiry requests and unambiguous name/phone/email/message answers
select native API tools directly. This avoids relying on a model's promise to
save a detail. Ambiguous answers and product questions remain conversational.
One missing required field is requested at a time; API validation determines
whether a write succeeded. Failed actions are recorded in the current turn and
are not automatically repeated. Explicitly labelled messages preserve the
visitor's words, including questions intended for the team.

The full review is formatted from the saved fields without model rewriting.
Phone digits and meaningful email punctuation are spoken explicitly. An
oversized or invalid review cannot produce an actionable confirmation token.
Only a new explicit confirmation immediately following the review can select
submission. Corrections, intervening questions, navigation, language changes,
interrupted review speech and pipeline failures invalidate prior review tokens.
The API independently checks conversation scope, revision, expiry and the new
persisted visitor confirmation. A success means recorded with a durable team
notification queued, not confirmed delivery. No order or payment is created by
these enquiry tools.

## Speech cadence

The GPU keeps the same Indic Parler model and Neha speaker in EN/HI/GU. Earthora
opts into `VOICE_TTS_PROFILE=conversational` while retaining its existing
pitch-preserving `VOICE_TTS_SPEED=1.20`. Other clients omitting the profile retain
the exact prior model description. No second permanent model or paid inference
fallback was added.

An identical source WAV captured through isolated LiveKit at 16 kHz and 8 kHz
showed 5.27 seconds of source speech versus 5.23 seconds received; envelope
alignment found a stretch ratio of 1.001. This did not reproduce a half-speed
playback/sample-rate bug. The original model description requested a moderate
pace. A controlled same-seed comparison of one phrase per language found shorter
pauses/phrases with the conversational description. Gujarati's audible span
changed from 7.39 to 6.26 seconds; Hindi from 6.32 to 5.94. English's shorter total
was mainly reduced boundary silence. ASR retained the meaning of all six samples.

These measurements are not a human naturalness rating or a universal latency
guarantee. The TTS remains a completed-phrase generator. Full synthetic audio,
metrics and GPU rollout details are in the task workspace at
`outputs/earthora-audio-diagnosis-20260921/`. GPU rollback backup:
`/srv/ai/backups/tts-profile-20260921T040739Z`.

## Runtime candidate verification

Candidate `sunpath-voice-0513efa1471b` passed **639 tests** in the installed Linux
LiveKit SDK environment, with network disabled. Coverage includes tool/turn
binding, request corrections and failed writes, exact contact review, ambiguous
confirmation rejection, late/interrupted action handling, caller-bound browser
acknowledgement and provider configuration. Separate API tests and an isolated
real-PostgreSQL transaction/outbox proof are documented in the API evidence.

The [native conversation probe](concierge-model-qa.json) passed **20 turns** across
English callback/contact collection, Gujarati callback collection, acknowledged
EN/GU navigation, Hindi newcomer guidance, English wholesale guidance and a
phone enquiry. It used actual production context/tool schemas and two real GPU
Qwen generations. Clear form/navigation steps bypassed inference. Browser
acknowledgements and request writes in this probe were simulated; successful
database/outbox transactions were independently exercised in the isolated real
PostgreSQL check. Deliberately failed submission was reported as failure, with
no test notification sent. The probe timings exclude real ASR/TTS and are not
end-to-end voice latency measurements.

## Activation

- Active worker/control source: `/opt/earthora/releases/sunpath-voice-0513efa1471b`
- Image: `earthora-livekit-agent:sunpath-0513efa1471b`
- Image ID: `sha256:3b056f53c4d53790db6e34aae2f19e7322f1f2b0487189316de7feee76f428e8`
- Activation: **04:39:25 UTC**
- Previous source: `/opt/earthora/releases/sunpath-voice-cc2904d546b5`
- Backup: `/opt/earthora/backups/pre-concierge-voice-20260921T043859Z`

Zero active rooms were verified before replacing only agent/control. API,
control and worker readiness returned 200. The actual container environment
matched `conversational`, speed `1.20`, web idle 60 seconds plus 90 seconds grace,
phone idle 30 seconds and ambience disabled. Rollback uses the preserved previous
compose/source/env, recreating only agent/control after active calls finish;
the activation script automatically rolls back if readiness fails. The active
pointer is `/opt/earthora/SUNPATH_VOICE_ACTIVE`.

## Final audio acceptance

The [audio probe](concierge-transport-qa.json) used exactly two single-turn
sessions to exercise the activated runtime using cached
synthetic Hindi input: one WebRTC call and one simulated Tata Smartflo socket.
Both containers used the conversational profile and speed 1.20. Both runs
recognized the product-ingredients question and answered that each tablet
contains 500 mg Moringa Leaf, using the approved ingredient source rather than
the unrelated conflicting dosage entry. Both received speech with no pipeline
errors; the phone framing and normal socket-close checks passed.

| Transport | First audible reply after input ended |
| --- | ---: |
| WebRTC | 3.519 seconds |
| Simulated Smartflo | 4.038 seconds |

The two rooms were removed. [Final API/control/agent health](concierge-final-health.txt) was good, all three
containers had zero restarts and no rooms remained. These are two synthetic
transport samples, not a PSTN trial, microphone-accent benchmark or a guarantee
of immediate replies. No real phone call, customer request or notification was
sent during acceptance.
