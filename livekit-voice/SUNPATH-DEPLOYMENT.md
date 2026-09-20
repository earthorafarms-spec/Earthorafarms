# Earthora: MSH / SunPath voice implementation

Implementation reference: `D:/MSH/sun/sunpath-voicebot`; build briefs: `D:/MSH/sun/sunvoicebot.zip`. The ZIP contains specifications, not the source tree. `SOURCE-SUNPATH.json` identifies the preserved source files and hashes. `SUNPATH-PARITY.md` distinguishes reusable call behavior from Sun Pathology's business-specific data.

The former Render bot is not an implementation reference for this migration. No Render prompt, controller, knowledge migration or deployment change was applied during this task. Earthora's currently published configuration, live catalogue and public knowledge remain its business data.

## Call path

Browser microphone or Tata Smartflo G.711 stream → the same self-hosted LiveKit room → named `earthora-sunpath` agent → Silero VAD → local speech recognition → Qwen native tool conversation → reply validation → local Neha speech → caller.

| Component | Runtime |
| --- | --- |
| STT | `whisper-large-v3-turbo` with automatic language detection; Gujarati re-decoded by `indic-conformer-600m-multilingual` |
| LLM | `qwen3.5:9b`, GPU OpenAI-compatible protocol, thinking disabled, 256-token reply cap |
| TTS | `indic-parler-tts`, speaker `Neha` for English, Hindi/Hinglish and Gujarati |
| Session | LiveKit Agents 1.3.12, explicit named dispatch, two concurrent rooms maximum |
| Data/tools | Authenticated Earthora API; current Postgres catalogue, public knowledge and existing business functions |

The `livekit-plugins-openai` package is a protocol adapter. `AI_BASE_URL` and `AI_API_KEY` explicitly select the owner's GPU endpoint; it does not use OpenAI inference. Google, Gemini, Edge, Sarvam and hosted inference fallbacks are not selected in this voice path. Knowledge lookup runs in local voice scope and does not call a hosted embedding service. Existing typed chat is outside this change.

## Source responsibilities

- `server/sunpath_config.py`: three provider builders.
- `server/earthora_agent.py`: native AgentSession, function tools, utterance/language handling, greeting, interruption, silence and closure.
- `server/sunpath_runtime.py`: prompt construction, current-turn evidence and checks before speech.
- `server/sunpath_bridge.py`: authenticated context/tool/transcript requests. It does not call the old full-turn LLM endpoint.
- `apps/api/src/platform/channels/sunpath.ts`: allowlisted tools, schema checking, serialized state and duplicate-call protection.
- `server/earthora_control.py`: room admission and Tata media transport. The public Tata WebSocket URL is preserved.

The existing chat frontend, layout, controls and text-chat flow are preserved. Voice room events retain the existing `earthora.voice` topic, transcript/reply correlation, interruption and call-end contract.

## Deliberate adaptations

The Sun reference uses cloud streaming recognition and synthesis. Current GPU speech endpoints return completed utterances and audio phrases. The session is continuous and interruptible, but this does not turn those models into native streaming speech services. Do not promise the reference brief's sub-1.5-second target without an end-to-end measurement.

Sun's medical catalogue, doctor names, contacts and simulated lead store are not copied into Earthora. The native tool pattern instead uses Earthora's existing business functions. Tool failure cannot be reported as successful delivery, payment, order placement or live human transfer.

The reference's logging-only accuracy hook is replaced by validation before any generated reply reaches TTS. Tool results belong to their originating turn. Silence/farewell/error closure waits for the actual terminal speech rather than a fixed-duration sleep. Batch STT uses a VAD-based interruption threshold; a streaming interim-word gate cannot be transplanted unchanged.

An acceptance test exposed contradictory usage directions in Earthora's existing Morilife product entry versus its Payments/FAQ entries. The migration does not rewrite those business records. Product/topic-matched retrieval and a conflict response withhold unconfirmed dosage; an owner should reconcile the published entries before expecting spoken usage instructions. These targeted checks are not a general proof that every possible generated statement is correct.

## Operations

The deploy uses immutable source/image candidates, offline tests and an idle-room gate. The active release is recorded on the VPS in `/opt/earthora/SUNPATH_VOICE_ACTIVE`; that release contains `ACTIVATED.json` and `ROLLBACK_PATH`. Runtime secrets stay in server-side environment files; they are excluded from source packages.

Public surface: `https://earthora.srv1915512.hstgr.cloud/`.

Phone surface: `wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo`.

Validation uses synthetic audio and a synthetic Smartflo socket. It does not dial a real phone, create an order, send a WhatsApp message or charge a payment. A passing transport test is not a real PSTN-call certification.

## Live evidence, 20 September 2026

Final runtime: `earthora-livekit-agent:sunpath-b79d68a65043`, image `sha256:843f242a9a40075a23a5cb64ae6087b82c955b743bc35c65ff8afae6c9468278`, activated at 16:02 UTC. Rollback directory: `/opt/earthora/backups/pre-sunpath-20260920T160209Z`. API image: `earthora-api:livekit-7e6c7675be30`.

All **205 runtime tests** passed in the isolated Linux candidate; **82 API tests** and API typechecking passed for the unchanged API release. The native integration probe then passed four independent English/Gujarati cases: real GPU Qwen generation after knowledge retrieval, and explicit conflict abstention without Qwen generation for the contradictory usage records. Cart and checkout state stayed unchanged. See [runtime tests](verification/sunpath/runtime-tests.txt) and [native integration results](verification/sunpath/sunpath-tools-final.json). These checks establish the integration and targeted guards; they are not human ratings of Gujarati fluency or complete semantic entailment.

After final activation, targeted English → Gujarati → interrupting English tests passed again on both browser and phone transport, with zero pipeline errors, valid phone clear/mark/close behavior and all test rooms cleaned up. First audible replies ranged 3.432–5.832 seconds; final medians were 4.387 seconds web and 4.185 seconds phone. API, control and worker health checks passed with zero container restarts. See [final acceptance](verification/sunpath/sunpath-final-smoke.json).

The complete transport run on `sunpath-12de25e2fac3` passed six turns each for browser WebRTC and the public Smartflo WebSocket: English → Hindi → Gujarati → Hinglish → English → interrupting English. All transcripts/replies matched the expected language; both transports had zero pipeline errors. Phone clear/mark frames and normal socket closure passed. Fixtures were known synthetic audio, so this is not an accuracy benchmark for varied real speakers, microphones or phone lines.

| Transport | Median first audible reply | Observed range |
| --- | ---: | ---: |
| Browser | 3.527 s | 2.998–7.239 s |
| Synthetic Smartflo | 4.135 s | 3.511–5.029 s |

Times start at the final paced input sample and end at the first audible reply frame. They include endpointing, recognition, Qwen and synthesis. They are observations, not latency guarantees. See [transport results](verification/sunpath/sunpath-live-smoke-12de25e2fac3.json).

The separate live lifecycle test passed named dispatch, silence prompt/grace, complete audible farewell, native call closure and automatic room cleanup. It ran on `sunpath-f97925ee3bf3`, before the subsequent STT and grounding corrections, with no lifecycle changes between them. See [lifecycle results](verification/sunpath/sunpath-lifecycle-sep20.json).

GPU TTS output recovery was separately corrected: a malformed/empty waveform receives at most one retry within the original budget; repeated invalid output fails that request without unloading the model. Fatal device errors and hard timeouts retain their existing worker recovery behavior. All 73 isolated Linux tests passed. Only `voice-tts` restarted; backup `/srv/ai/backups/voice-tts/waveform-20260920T154647Z.4Aq2BP`. See [change and validation](verification/sunpath/TTS-Waveform-Recovery.md) and [runtime patch](verification/sunpath/tts-waveform-recovery.patch).

After the full transport run, the RTX 5090 reported 16,192 MiB used of 32,607 MiB and 41°C. This snapshot and sequential synthetic tests do not establish a maximum concurrent-call capacity. Admission remains capped at two rooms; the existing GPU speech queue limits remain unchanged.
