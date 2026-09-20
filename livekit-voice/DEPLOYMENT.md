# Earthora LiveKit deployment handoff — 20 September 2026

Earthora’s web microphone now uses a dedicated UniExl-derived LiveKit deployment on the Earthora VPS. Web and Smartflo transport share the same agent, GPU speech providers and validated Earthora conversation engine. Public web/phone synthetic acceptance passed, and Tata endpoint 2163 is saved to the new VPS URL. A real handset call has not been performed.

**Source and deployment**

UniExl upstream: `apps/voice-addon/` at commit `4660ed296b3152884aa72fd86ec4e4ced172b8c4`. The untouched copy and file hashes are retained in `livekit-voice/upstream/` and `livekit-voice/SOURCE.json`. Earthora integration commit: `71400f4`; language switching, nonblocking playback and acceptance regressions are saved in commit `a78a8f8`.

The supplemental language correction is in [voicePolicy.ts](../apps/api/src/platform/engine/voicePolicy.ts), [engine.ts](../apps/api/src/platform/engine/engine.ts) and [plymaxx.ts](../apps/api/src/platform/providers/plymaxx.ts), with [language-switch regression coverage](../apps/api/src/platform/engine/voiceEngine.test.ts). It preserves the current-language guard after conversation history and repairs or replaces replies whose script disagrees with the selected language. Typed chat and frontend files are unaffected by this correction.

| Component | Source / deployed location |
|---|---|
| LiveKit agent, VAD, turn detection, interruptions | `livekit-voice/server/earthora_agent.py` |
| GPU STT/TTS adapters | `livekit-voice/server/plymaxx.py` |
| Authenticated business API bridge | `livekit-voice/server/earthora_bridge.py` |
| Room admission and Smartflo transport | `livekit-voice/server/earthora_control.py` |
| Browser microphone transport | `livekit-voice/browser/transport.ts`; bundled as `apps/api/public/voice-client.js` |
| VPS | `187.52.121.146` |
| Voice runtime / compose | `/opt/earthora/uniexl-voice`; `compose.earthora.yml` |
| API correction release source / image | `/opt/earthora/releases/livekit-api-1f13f6bd24e5`; `earthora-api:livekit-1f13f6bd24e5` |
| Initial LiveKit API release | `/opt/earthora/releases/livekit-api-20260920`; `earthora-api:livekit-20260920` |
| Existing API configuration | `/opt/earthora/infra` |
| Containers | `earthora-livekit`, `earthora-voice-control`, `earthora-livekit-agent`, `earthora-api` |

LiveKit Server is pinned to 1.9.12; Agents 1.3.12, RTC 1.0.23 and API 1.1.0. Nginx terminates TLS. ICE uses TCP 7881 / UDP 7882; control is available on loopback 7860 and the private Docker network, with agent health on loopback 8081. Admission allows **two simultaneous sessions**, including rooms awaiting their caller. Existing worker and legacy voice services remain available.

**Models and application behavior**

- STT: `whisper-large-v3-turbo`, with automatic language detection each utterance. Detected Gujarati is re-decoded using `indic-conformer-600m-multilingual` when the enabled `AI_STT_REDECODE_GUJARATI=1` setting applies. Automatic detection permits switching back to English or Hindi.
- TTS: `indic-parler-tts`, speaker **Neha** across English, Hindi/Hinglish and Gujarati. Output is mono PCM16 at 44.1 kHz, adapted to each transport.
- Reasoning: self-hosted `qwen3.5:9b`, thinking disabled, maximum 256 output tokens and an 8,192-token context budget. Voice has no paid inference fallback.
- The storefront layout, widget styling and typed-chat flow/provider configuration are preserved. The existing microphone opens continuous LiveKit audio; its control ends the session.
- The Earthora API retains approved-knowledge retrieval, live catalogue/pricing, tool validation, checkout/payment boundaries and durable conversation state. Voice uses scoped SQL keyword retrieval and checks unsupported price/payment claims before returning speech. Turns are serialized per session; identical turn IDs are deduplicated for 15 minutes within the single API process.

**Endpoints**

| Endpoint | Purpose |
|---|---|
| `POST /api/platform/voice/livekit/session` | Enabled public voice-channel admission; returns a room-scoped 20-minute token and stable conversation ID |
| `POST /api/platform/voice/internal/session` | Authenticated synthetic/real Smartflo bridge admission |
| `POST /api/platform/voice/internal/turn` | Authenticated completed utterance → persisted, validated reply |
| `/voice-client.js` | Browser transport bundle |
| `wss://earthora.srv1915512.hstgr.cloud/livekit` | Public LiveKit signaling |
| `wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo` | Public Smartflo media bridge |
| `/voice/stream/endpoint` | Dynamic Smartflo endpoint resolver |
| `/healthz`, `/readyz` | API process and database readiness |

**Verified results and limits**

API typecheck/build and **53 Node tests** passed (48 baseline tests plus five language-switch regressions); **66 Python tests** passed, including eight scheduling tests and eight smoke-acceptance regressions. Public HTTPS admission and WebRTC audio were exercised with synthetic input. The initial web language/interruption sequence passed. A stronger phone sequence exposed Hindi replies after switching back to English; the deployed API correction makes the latest language authoritative and validates reply script, while preserving natural Hinglish. An isolated 13-second Gujarati result was traced to the previous callback awaiting all speech playback; the deployed scheduling correction removes that wait. The API release is `1f13f6bd24e5`, and both voice containers use image `sha256:2ef954451256da8825b2744ee11d14cda4caa97be82bddb55997fd2d70c1b84f`. API, control and agent health checks returned 200. Strengthened public acceptance passed after both fixes. No real handset call is represented by these results.

| Measurement | Observed latency |
|---|---:|
| Public web: input stop → transcript | 1.203 s |
| Public web: input stop → validated reply text | 2.328 s |
| Public web: input stop → first received reply audio | **4.016 s** |
| API-only validated turn: English / Hindi / Gujarati | 1.389 / 1.148 / 1.181 s |
| Final web: Gujarati / English / interrupted English, first reply audio | 3.540 / 4.002 / 3.926 s |
| Final public phone: English / Hindi / Gujarati / Hinglish / back to English | 4.381 / 4.383 / 7.206 / 4.394 / 5.414 s |
| Final phone interrupted follow-up | 3.865 s |
| Confirmed interruption from VAD speaking: web / phone | 0.451 / 0.457 s |

The public measurement is recorded in [earthora-public-rtc-smoke-20260920.json](verification/earthora-public-rtc-smoke-20260920.json). API checks confirmed `plymaxx` traces, current database prices, 4–6 ms duplicate responses, and no cart/checkout/callback effects. The observed catalogue price was ₹1; testing did not change it.

GPU recognition returns completed utterances and Parler returns completed phrases. Short first phrases reduce the initial wait; LiveKit provides continuous transport and interruptions. Roughly four seconds was observed in the public synthetic test, and shared GPU load can increase it. This is not a latency guarantee or a measurement of human microphone/native-pronunciation quality.

**Phone cutover and final acceptance**

- The final Smartflo sequence used the **public WSS URL**, exercising TLS/nginx and the media bridge. All six turns passed transcript/reply-script checks with zero pipeline errors. Phone results include immediate buffer clearing on interruption, two clear events, one acknowledged final mark, no malformed outbound audio frames, normal remote close code 1000, and test-room cleanup. The final close event was injected into the owned synthetic room to exercise transport shutdown; it was not an actual carrier call.
- Evidence: [phone JSON](verification/earthora-live-smoke-phone-public-final.json), [web JSON](verification/earthora-live-smoke-web-final.json), and [verification report](verification/Earthora-Verification.md). The corresponding files are also on the VPS under `/opt/earthora/uniexl-voice/tests-media/`.
- Tata endpoint **2163**, renamed **Earthora LiveKit Voice Bot**, was saved and verified in the dashboard on 20 September 2026: `wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo`. It remains Static, Enabled, with hangup failover. Existing telephone-number assignments were preserved.
- **Real PSTN trial: not performed.** No person was called. A real handset test is still needed to validate carrier routing and phone audio quality.

**Rollback**

The pre-activation backup is `/opt/earthora/backups/pre-livekit-20260920T122956Z`, also recorded in `/opt/earthora/uniexl-voice/ROLLBACK_PATH`. It contains the former API environment, compose override, nginx virtual host and image ID. Restore those exact files/image, recreate only the API service, then validate and reload nginx. Tata must be rolled back separately; its previous endpoint was `wss://earthorafarms-mhwv.onrender.com/ws/voice/smartflo`. No database schema migration or storefront build migration was introduced. The language-fix API backup is `/opt/earthora/backups/voice-language-20260920T130022Z`; the prior voice image is retained as `earthora-livekit-agent:before-scheduling-fix` and source backup at `/opt/earthora/uniexl-voice/scheduling-before-20260920T130401Z`.

This report contains no credentials; production keys remain in the VPS runtime configuration.
