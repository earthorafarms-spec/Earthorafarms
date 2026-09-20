# Earthora voice service

Earthora's current conversation worker follows the MyScanHub SunPath source at
`D:/MSH/sun/sunpath-voicebot`. See [SUNPATH-DEPLOYMENT.md](SUNPATH-DEPLOYMENT.md)
for the active architecture and [SUNPATH-PARITY.md](SUNPATH-PARITY.md) for the
adaptation map. `SOURCE-SUNPATH.json` records the exact reference subset.
The prior `upstream/` and `SOURCE.json` are retained historical provenance;
they do not define the current conversation loop. The old Render bot is not a
reference for this migration.

## Runtime

- `server/earthora_agent.py`: native SunPath-style LiveKit AgentSession, Qwen
  function tools, prewarmed Silero VAD, deterministic lifecycle and interruptions.
- `server/plymaxx.py`: local GPU speech adapters. Whisper Turbo detects each
  utterance's language; detected Gujarati is decoded again with IndicConformer
  when `AI_STT_REDECODE_GUJARATI=1`. Indic Parler uses speaker **Neha** in English,
  Hindi/Hinglish and Gujarati. There is no paid inference fallback.
- `server/sunpath_bridge.py`: authenticated context/tool/transcript access.
  Qwen runs directly inside AgentSession; no completed-turn LLM HTTP bridge is
  used. Earthora owns live catalogue, approved knowledge, durable cart and
  checkout validation. Typed chat keeps its existing provider configuration.
- `server/sunpath_runtime.py`: current-turn facts, language and business checks
  before generated text reaches TTS; bounded history and brief spoken replies.
- `server/earthora_control.py`: bounded room admission and short-lived room
  tokens, plus Tata Smartflo G.711/8 kHz WebSocket-to-LiveKit transport. Web and
  phone use the same agent and voice configuration.
- `browser/transport.ts`: LiveKit client bundle consumed by the existing widget.
  The storefront, chat markup, styling and typed-message flow remain unchanged.
  The microphone opens a continuous session; the existing control ends it.

The GPU STT and TTS APIs return completed utterances/phrases, not streaming model
tokens/audio. LiveKit supplies continuous transport, turn detection and
interruptions. Synthesizing the first phrase still takes time; this deployment
must not be described as zero-latency inference.

`VOICE_TTS_SPEED=1.20` applies the same pitch-preserving tempo adjustment to
Neha's completed audio on web and phone. The Earthora-only helper uses local
FFmpeg, keeps mono PCM16 at 44,100 Hz, and cancels processing when interrupted.
Values from `1.0` through `1.4` are accepted; `1.0` bypasses processing exactly.
The setting does not change the named voice, GPU generation defaults or model
streaming capability. Long pauses are retained to avoid cutting quiet speech.
Synthetic before/after clips and the reproducible CPU-only measurements are in
[verification/sunpath/pacing](verification/sunpath/pacing/README.md).

SunPath's streaming-word interruption threshold assumed interim STT results. Here it
is configurable and defaults to zero words with a 0.5-second VAD guard, allowing
barge-in before completed-utterance recognition finishes. Confirmed interruption
events clear the phone's playback buffer.

## Deployment

Earthora VPS: `187.52.121.146`.

- Active immutable voice release: read `/opt/earthora/SUNPATH_VOICE_ACTIVE`
- API release source: `/opt/earthora/releases/knowledge-api-625dc2a12bc8`
- Existing API compose/environment: `/opt/earthora/infra`
- Public signaling: `wss://earthora.srv1915512.hstgr.cloud/livekit`
- Public phone bridge: `wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo`
- SFU: LiveKit Server 1.9.12; Agents 1.3.12, RTC 1.0.23, API 1.1.0.

The SFU signaling service binds to loopback and the verified Docker gateway.
Nginx supplies TLS. ICE uses TCP 7881 and UDP 7882. The control service binds to
loopback port 7860 and the existing private Docker network. Agent health binds
to loopback 8081. This is a single-node, two-session deployment.

Secrets are generated or reused on the VPS, stored in mode-600 files and omitted
from the repository. The API and voice runtime share
`EARTHORA_VOICE_INTERNAL_KEY`. Model calls use the existing static `AI_API_KEY`.
Do not put either key or the LiveKit signing secret into the browser bundle.
The browser receives only a room-scoped, 20-minute join token.

Use `compose.earthora.yml` and `server/Dockerfile.earthora` for this adaptation.
The copied original `server/pyproject.toml`, lockfile and original entrypoints
describe the upstream application and its other providers; they are retained
for provenance, not the Earthora deployment command.

```sh
docker compose -f compose.earthora.yml build voice-control
docker compose -f compose.earthora.yml up -d
```

There are two provider-side speech slots and at most two active LiveKit sessions.
Admission limits prevent an unbounded GPU queue; they do not guarantee a
particular response time when another project is using the shared GPU.

## Checks

```sh
npm run typecheck -w @earthora/api
npm run test -w @earthora/api
npm run build -w @earthora/api
cd livekit-voice/browser && npm ci && npm run build
```

The image contains tests for the GPU adapters, authenticated bridge and phone
transport. `server/tests/live_smoke.py` exercises synthetic audio through the
deployed media path without dialing a person. Real PSTN testing is a separate
acceptance step; a synthetic Smartflo connection does not prove the carrier
routing or audio quality on a real handset.

## Rollback

Each immutable release contains `ROLLBACK_PATH`, pointing to a backup of the
prior runtime image IDs and compose configuration. That backup records
`PREVIOUS_DIRECTORY`. Restore only voice-control and agent from that directory
with the recorded image IDs, after active rooms finish. API compose backups
are separate under `/opt/earthora/backups/sunpath-api-<timestamp>`.
This migration does not change Nginx, the SFU or Tata's configured endpoint.

No database schema or storefront build migration is required.

## September 20 follow-up fixes

The current turn's language instruction is kept after conversation history,
and voice output is checked against that language before playback. This prevents
a prior Hindi/Gujarati exchange from keeping a later English response in the
wrong language. Conversational Hinglish remains supported.

Normal speech is scheduled without waiting for all playback inside LiveKit's
completed-turn callback. This allows the next completed utterance to interrupt
an earlier reply promptly. Terminal replies still finish before the call closes,
with interruption and stale-response checks retained.

Native voice context and search now carry the complete approved product records,
including product/category, question, version and effective dates. For the same
product and attribute these take precedence over copied website passages. This
preserves tablet strength and directions, while keeping conflicting active
approved records unresolved. The nine current tablet records were compared with
the legacy bot's configured Supabase source and matched exactly; the old Render
voice implementation was not restored.

Knowledge is selected for the current question before prompt budgeting. Language
changes receive a short acknowledgement; purchase intent asks for missing quantity
without becoming dosage advice. Unknown dispatch calendars are left unconfirmed.
Unsupported STT language results are decoded once more from the same audio using
the conversation language, then request repetition if still unusable. A recognition
miss remains recoverable so the next utterance can continue the session.
