# Gujarati automatic recognition verification — 2026-09-21

Three serial recognition requests used two existing, synthetic Neha WAVs. All inference ran on the self-hosted GPU through the authenticated model API; no paid/cloud inference, real phone call or notification was used. No private customer transcript or credential is included here.

| Synthetic utterance | Recognition | Observation |
|---|---|---|
| `મારે આ લેવું છે.` | Whisper auto | Reported Gujarati and returned mixed Latin/Gujarati text; the existing Gujarati recovery condition already applies. |
| `હા, હું તમારી મદદ કરી શકું છું. તમને કયો product જોઈએ છે?` | Whisper auto | Reported Hindi: `हाँ, हुँ तमारी मदद करी शकूछू, तमने कायो प्रदक जोईये छे?` |
| Same second WAV | Indic Conformer, Gujarati | Returned `હા હું તમારી મદદ કરી શકું છું તમને કયો પ્રડક્ટ જોઈએ છે` in Gujarati script. |

The runtime already enables Gujarati recovery and keeps STT in automatic mode across turns. The full second Whisper result already triggers recovery through `तमारी/तमने` plus `छे`; it must not be described as a failed end-to-end fixture. Its shorter first clause exposes the fused `शकूछू` gap. Static cases also exposed missing short `मारे`/`तमे` forms.

The adapter now recognizes these whole-word cues. Ambiguous first-person `हूँ` additionally requires a Gujarati clause cue or a complete fused Gujarati verb; ordinary Hindi, isolated cues and substring lookalikes remain guarded. Recovery re-recognizes the **original audio** with Indic at most once within the existing deadline. It accepts actual Gujarati-script output and never translates or manufactures a transcript. The opt-in/default behavior and capacity limits remain unchanged.

**100 adapter tests passed** against the deployed Linux LiveKit SDK, including recovery bounds, original-audio identity, positive phonetic cases and Hindi/substring exclusions. These tests and two synthetic source utterances do not prove flawless detection of every short phrase, microphone or accent, nor subjective voice naturalness.

Local diagnostic artifacts are under `outputs/earthora-audio-diagnosis-20260921/earthora-language-diagnose/`: `recognition.json`, `customer-gu.wav`, and `neha-gu-conversational.wav`. This note records adapter verification; the parent deployment process separately validates the combined runtime.
