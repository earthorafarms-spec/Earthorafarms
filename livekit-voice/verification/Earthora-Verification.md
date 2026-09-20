# Earthora voice verification — 20 September 2026

> Historical test evidence for the earlier deployment. See [SUNPATH-DEPLOYMENT.md](../SUNPATH-DEPLOYMENT.md) for the active SunPath service and its validation.

The corrected UniExl-derived runtime passed synthetic browser and public Smartflo WebSocket tests on runtime image `2ef95445…`, with the deployed Node language correction. All 66 Python checks also passed before activation.

The tests use four prerecorded Neha WAVs containing harmless English, Hindi, Gujarati and Hinglish utterances. No real phone was dialled and no purchase, order change or callback was requested. The frontend appearance and typed chat are outside this transport test.

## Measured response delay

Seconds from the last paced input sample to the first audible reply frame. These are observed runs, not latency guarantees. Reply text was checked against the expected script as well as language metadata; every reported final turn passed.

| Transport | Input | Transcript event | Reply text | First audible reply |
|---|---|---:|---:|---:|
| Public Smartflo WSS | English | 0.817 | 2.018 | 4.381 |
| Public Smartflo WSS | Hindi | 0.750 | 2.014 | 4.383 |
| Public Smartflo WSS | Gujarati | 1.660 | 3.520 | 7.206 |
| Public Smartflo WSS | Hinglish | 0.930 | 2.000 | 4.394 |
| Public Smartflo WSS | Back to English | 0.932 | 2.678 | 5.414 |
| Public Smartflo WSS | English interruption | 1.196 | 2.202 | 3.865 |
| Browser LiveKit | Gujarati | 0.952 | 2.234 | 3.540 |
| Browser LiveKit | Back to English | 1.045 | 2.496 | 4.002 |
| Browser LiveKit | English interruption | 1.238 | 2.342 | 3.926 |

Phone median was 4.389 seconds; the Gujarati phone case remained slower at 7.206 seconds. Browser final cases ranged from 3.540 to 4.002 seconds. The GPU still synthesizes completed phrases, so this is continuous media transport with batch model inference.

## Transport and interruption checks

- Phone connected through public TLS/nginx at `wss://earthora.srv1915512.hstgr.cloud/ws/voice/smartflo`.
- Synthetic inbound audio used Smartflo's 100 ms, 800-byte mu-law frames at 8 kHz. All outbound frames met the 160-byte minimum/multiple requirement.
- Mid-reply interruption was confirmed after 0.457 seconds on phone and 0.451 seconds on web from the VAD speaking event. Phone playback clear followed immediately.
- Phone received two clears, one acknowledged final playback mark, and a normal remote WebSocket close with code 1000. No reader error occurred.
- Both final tests received audible audio, recorded zero pipeline errors and removed their own test rooms.
- The phone test deliberately injected `call_end` into its own synthetic room to exercise playback drain, mark acknowledgement and closure. It did not place a PSTN call or test a real handset/carrier route.
- Browser admission used the application endpoint and the returned public LiveKit URL. An earlier independent laptop test also confirmed public HTTPS admission and WebRTC/ICE/audio, with English first audio at 4.016 seconds.

## Issues found and corrected before final acceptance

1. The control image lacked a WebSocket implementation. It now includes pinned `uvicorn[standard]` and `websockets`; the actual handshake and media path passed.
2. After Hindi/Gujarati history, English transcripts sometimes produced Hindi replies marked as English. The voice-only Node path now gives the current turn's language priority, validates output script, and bounds corrective generation. The final English switch checks passed.
3. The inherited completed-turn callback awaited full speech playback. LiveKit 1.3.12 waits for that callback before handling another completed utterance, producing a measured ~7.99-second queue stall in one split Gujarati input. Normal speech now schedules and returns; terminal speech waits in a tracked task with interruption/epoch protection. Final Gujarati transcript-event delay was 1.660 seconds on phone and 0.952 seconds on web.
4. Smoke acceptance was strengthened to reject fallback audio after pipeline errors, validate actual reply scripts, require a normal remote phone close, and keep separate timestamps when a WAV creates multiple VAD turns. Sixteen focused regressions cover these assertions and scheduling behavior.

## Evidence

- [Final public phone result](earthora-live-smoke-phone-public-final.json)
- [Final browser result](earthora-live-smoke-web-final.json)
- [Earlier failed strong phone result retained for comparison](earthora-live-smoke-phone-strong-first.json)
- [Earlier full browser language run](earthora-live-smoke-first.json)

Reusable opt-in runner: `livekit-voice/server/tests/live_smoke.py`. It is not auto-collected by pytest and does not log service credentials or join tokens. Final reports are also saved on the VPS under `/opt/earthora/uniexl-voice/tests-media/`.
