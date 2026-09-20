# Earthora Neha pacing comparison

These are offline transformations of the existing synthetic Neha recordings. No GPU inference, provider request, live deployment or voice-identity change was performed.

The production helper uses FFmpeg `atempo=1.20`, retaining mono PCM16 at 44,100 Hz. `VOICE_TTS_SPEED` accepts 1.0–1.4; 1.0 returns the original bytes. Processing uses bounded asynchronous pipes, and timeout/cancellation kills and reaps FFmpeg. The Earthora Dockerfile now includes FFmpeg; the root agent owns runtime integration and deployment.

| Clip | Original seconds | 1.20× seconds | Original words/minute | 1.20× words/minute |
|---|---:|---:|---:|---:|
| English | 4.075 | 3.407 | 132.5 | 158.5 |
| Hindi | 5.631 | 4.709 | 95.9 | 114.7 |
| Gujarati | 5.817 | 4.852 | 82.5 | 98.9 |
| Hinglish | 6.908 | 5.760 | 78.2 | 93.8 |

Word counts use the known input text and whitespace boundaries; they are descriptive measurements, not a cross-language naturalness score. Warm local processing took 42–55 ms; the first cold invocation took 246 ms. Deployment-host timing may differ.

Listen to the matching `neha-<language>-before.wav` and `neha-<language>-tempo120.wav` files. Numeric pace and pitch tests cannot establish subjective pronunciation or naturalness; these clips are prepared for listening comparison.

The 1.56-second internal pause in the original Hinglish clip is **not trimmed**. Its PCM16 RMS is 21.32 and peak 170, with no continuous half-second window whose peak stays at or below 32. Classifying it as digital silence would require a threshold high enough to risk cutting quiet speech. A future pause treatment needs stronger speech/pause evidence. Consequently Gujarati is approximately 99 words/minute and Hinglish remains approximately 94 after the conservative 1.20× change.

All 19 offline tests pass with real FFmpeg 7.1: tempo/duration at 1.1, 1.2 and 1.4; retained 220 Hz pitch; very quiet 330 Hz voiced audio; retained digital silence; exact 1.0 bypass; input/configuration bounds; missing binary; and timeout/cancellation with actual FFmpeg child reaping. The dedicated helper is `livekit-voice/server/speech_pacing.py`; regression tests are `livekit-voice/server/tests/test_speech_pacing.py`.

Reproduce from the repository root with an installed FFmpeg binary:

```sh
python livekit-voice/verification/sunpath/pacing/compare_pacing.py --speed 1.20
```

Use `--ffmpeg /path/to/ffmpeg` when the binary is outside PATH. The script reads the supplied `*-before.wav` synthetic fixtures, calls the production pacing helper, and writes new audio plus SHA-256 fingerprints and measurements under `reproduced/` (or `--output-dir`). It makes no network or GPU calls and does not modify the reference fixtures. Different FFmpeg versions can produce slightly different output samples.
