# TTS waveform rejection: deployed 20 September 2026

The live `/srv/ai/apps/voice/tts/backend.py` and `server.py` matched the original workspace files byte-for-byte before this change. Originals remain in `work/voice-speed/current`.

Observed failure: live backend line 237 raises `RuntimeError` when the generated waveform has unexpected dimensionality, is empty, or exceeds the configured sample limit. The worker-level exception handler sends `error` and closes the child. `ProcessBackend` marks the worker unavailable, so the current and queued requests fail and subsequent calls remain unavailable during cooldown/model reload. The existing diagnostic intentionally removes exception text. It cannot establish whether this particular request was empty, malformed, or too long.

The proposal changes only request-level output handling:

- Empty or malformed shape: at most one retry with the original text, voice, generation settings, deadline and cumulative decoder-step budget. A second invalid result returns request-only HTTP 502, keeping the worker ready.
- Overlength audio or exhausted token limit: existing length result and HTTP 422, no retry and no partial WAV.
- Nonfinite audio: request-only HTTP 502, no retry. Actual CUDA/model/CPU-conversion exceptions still take the existing fatal worker path.
- Wall-clock timeout: the existing child termination/recovery path remains. GPU memory limits, queue capacity and generation limits are unchanged.
- Diagnostics add only a fixed rejection category and numerical attempt/dimension/sample/limit counters. No input text, samples, credentials or exception bodies are emitted.

Files prepared:

- `work/voice-tts/backend.py`
- `work/voice-tts/server.py`
- `work/voice-tts/test_backend.py` (new CPU-only generation/worker-loop regressions)
- `work/voice-tts/test_server.py`
- `work/voice-tts/requirements-test.txt` (NumPy 1.26.4, matching the existing runtime lock)

`tts-waveform-recovery.patch` contains the runtime-only diff against the exact live baseline. The existing voice description, BF16 eager attention, Neha selection, model files and sampling configuration are unchanged.

Validation: 72 CPU tests passed locally and Python compilation passed. The complete **73-test suite passed in 2.41 seconds** in a disposable Linux container using `earthora-livekit-agent:sunpath-f97925ee3bf3`, with networking disabled and only the four proposal/test files mounted. No production environment or GPU was supplied. This includes the real subprocess timeout regression that Windows permissions prevented locally. The log is `tts-waveform-linux-tests.txt`.

Tests exercise one bounded same-budget retry, whole-waveform rejection, no retry on nonfinite/overlength output, exception propagation, parent readiness and HTTP admission cleanup, and the actual `_worker` loop accepting a subsequent valid request with one model load. Torch/model/tokenizers are mocked, so these tests perform no GPU inference.

Deployment used `work/deploy-tts-waveform.sh` and `work/deploy-tts-waveform.py` at 15:46:47 UTC. The helper verified pinned proposal hashes, exact original source hashes, idle readiness, backups and Python compilation. Only `voice-tts` restarted; authenticated readiness returned after 9.01 seconds. The first preflight made no changes because its health URL was incorrect; inspection of systemd established the actual private endpoint `172.18.0.1:8502`, and the corrected preflight passed.

Backup: `/srv/ai/backups/voice-tts/waveform-20260920T154647Z.4Aq2BP`.

Deployed SHA-256: `backend.py` = `dc0408e0ed2bea40827fcd51d389a7cc975aee9885d05d01883c266a4bc6ec69`; `server.py` = `a9569a2011292572e7633aafb592003f4e475154891ba6284f1188aa5627855f`.

The deployment readiness check performed no inference. Subsequent coordinated Earthora synthetic acceptance exercises the live GPU. The invalid-waveform branch is verified by deterministic mocked CPU tests, not by deliberately causing a production GPU fault.
