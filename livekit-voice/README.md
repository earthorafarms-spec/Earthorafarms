# Earthora voice service

This is the UniExl voice-addon server copied at commit
`4660ed296b3152884aa72fd86ec4e4ced172b8c4`, adapted to Earthora's GPU and business
API. `upstream/` is the unmodified reference; `SOURCE.json` records every file's
hash. The original SchoolExl/UniExl deployments are not used at runtime.

## Runtime

- `server/earthora_agent.py`: UniExl LiveKit AgentServer/AgentSession, prewarmed
  Silero VAD, multilingual turn detection, speech filtering and interruptions.
- `server/plymaxx.py`: local GPU speech adapters. Whisper Turbo detects each
  utterance's language; detected Gujarati is decoded again with IndicConformer
  when `AI_STT_REDECODE_GUJARATI=1`. Indic Parler uses speaker **Neha** in English,
  Hindi/Hinglish and Gujarati. There is no paid inference fallback.
- `server/earthora_bridge.py`: completed utterances go to Earthora's authenticated
  `/api/platform/voice/internal/turn`. The existing application owns catalogue,
  approved knowledge, prices, conversation state and checkout validation. Qwen
  3.5 9B is selected only within voice requests; typed chat keeps its existing
  provider configuration. Only validated replies are spoken.
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

UniExl's three-word interruption threshold assumed interim STT results. Here it
is configurable and defaults to zero words with a 0.5-second VAD guard, allowing
barge-in before completed-utterance recognition finishes. Confirmed interruption
events clear the phone's playback buffer.

## Deployment

Earthora VPS: `187.52.121.146`.

- Voice source/runtime: `/opt/earthora/uniexl-voice`
- API release source: `/opt/earthora/releases/livekit-api-1f13f6bd24e5`
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

Before activation, the deployment stores the former API environment, compose
override, nginx virtual host and image ID under
`/opt/earthora/backups/pre-livekit-<timestamp>`. The location is recorded in
`/opt/earthora/uniexl-voice/ROLLBACK_PATH`. Restore those exact files and recreate
only the API service, then validate/reload nginx. The previous worker and legacy
voice container remain available. If Tata was switched, restore its former
endpoint separately; rolling back nginx does not change the carrier dashboard.

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
