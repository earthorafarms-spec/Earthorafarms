"""Backup TTS so a Google outage is never dead air (owner, 2026-07-14:
"if stt,tts fails, keep a fallback of device based - browserapi, edgetts").

WHAT THIS IS FOR
----------------
main.py already survives an LLM failure: session.on("error") speaks FALLBACK_LINE
and offers the customer care number. But that line is itself spoken THROUGH TTS.
If TTS is what broke, the apology never reaches the caller either, and the call
degrades to exactly the state the whole design forbids - silence. A caller who
hears nothing assumes the line dropped. This module is the floor under that.

WHY edge-tts AND NOT A BROWSER/DEVICE VOICE
-------------------------------------------
The owner asked for "device based - browserapi, edgetts". Those are two very
different things and only one of them can carry this:

  * Web Speech `speechSynthesis` runs in the CALLER's browser, not the worker.
    The pipeline here is server-side (LiveKit worker -> WebRTC audio track), so a
    browser voice cannot be a drop-in TTS: it would need a whole second transport
    (send text over a data channel, synthesize on the client, and accept that the
    audio never enters the room's audio track - no ambience mixing, no recording,
    nothing on the SIP leg when the trunk lands). It also cannot speak on a phone
    call at all, which is where this demo is heading.
  * edge-tts is a server-side HTTP/WSS voice with REAL Gujarati (verified:
    gu-IN-DhwaniNeural female, gu-IN-NiranjanNeural male). It drops straight into
    the same audio path, needs no credentials, and shares no failure domain with
    Google Cloud - which is the entire point of a fallback. If Google TTS is 429ing
    or the service account is broken, edge-tts is unaffected.

So: edge-tts is the backup. A browser voice stays unbuilt - see PROVIDERS.md
notes in the return, and the STT tradeoff below.

NO BROWSER STT EITHER (deliberate)
----------------------------------
Chrome speaks gu-IN Web Speech recognition, so a device-based STT fallback looks
tempting. It is not viable here: **iOS Safari does not implement gu-IN Web Speech
recognition**, and the design brief requires Safari iOS. A "fallback" that works
on the demo laptop and silently fails on half the phones is worse than no
fallback, because it hides the gap until a live call. STT redundancy, if it is
wanted, belongs in a second server-side recogniser (the SarvamSTT seam in
config.py already exists for that), not in the browser.

WHY THERE IS NO HAND-ROLLED WRAPPER IN THIS FILE
------------------------------------------------
livekit-agents ships `tts.FallbackAdapter` (v1.6.5, tts/fallback_adapter.py) and
it is strictly better than anything worth writing here. It already does:
  * try primary -> on exception, retry the SAME text on the next TTS;
  * mark a failed provider unavailable and probe it in a BACKGROUND task, so a
    recovered Google is picked back up mid-call without restarting the worker;
  * resample between providers automatically (`sample_rate=None` -> max of both);
  * refuse to double-speak: if the primary already emitted audio before dying, it
    logs and does NOT restart the sentence on the backup - the one behaviour a
    naive wrapper gets wrong, and it would be audible as a stutter mid-word;
  * wrap a non-streaming TTS in StreamAdapter on the streaming path by itself.
So build_fallback_tts() below is a thin, well-documented call into it, not a
reimplementation. See config.build_tts().

EdgeTTS IS NON-STREAMING ON PURPOSE
-----------------------------------
capabilities.streaming=False. edge-tts does stream MP3 over a websocket, but
implementing SynthesizeStream properly means owning segment/flush sentinel
semantics for a code path that, by definition, only ever runs when the primary is
already broken. FallbackAdapter wraps a non-streaming TTS in StreamAdapter (with
a sentence tokenizer) automatically, so the streaming pipeline still works - it
just synthesizes sentence-by-sentence instead of token-by-token. Slightly higher
latency on a path that exists to avoid silence, in exchange for far less surface
to get wrong. That is the right trade for a backup.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from livekit.agents import (
    APIConnectionError,
    APIConnectOptions,
    tts,
    utils,
)
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

if TYPE_CHECKING:  # pragma: no cover - typing only
    from livekit.agents.tts import AudioEmitter

logger = logging.getLogger("sunpath.tts_fallback")

# edge-tts's native output is `audio-24khz-48kbitrate-mono-mp3` (see
# edge_tts/communicate.py) - 24 kHz mono MP3. Declaring 24000 is therefore an
# honest declaration rather than a preference: it matches the wire format, and it
# matches the Chirp3-HD primary, so FallbackAdapter inserts no resampler between
# them. The AudioEmitter decodes and resamples via PyAV anyway if this is
# overridden, so nothing breaks if the pipeline rate changes - it just costs a
# resample.
EDGE_SAMPLE_RATE = int(os.environ.get("TTS_FALLBACK_SAMPLE_RATE", "24000"))
EDGE_NUM_CHANNELS = 1

# VERIFIED gu-IN edge-tts voices. Dhwani (female) mirrors the Chirp3-HD primary's
# register, so a mid-call switch is a change of voice, not a change of gender.
EDGE_VOICE_FEMALE = "gu-IN-DhwaniNeural"
EDGE_VOICE_MALE = "gu-IN-NiranjanNeural"
DEFAULT_EDGE_VOICE = os.environ.get("TTS_FALLBACK_VOICE", EDGE_VOICE_FEMALE).strip()

# edge-tts speaks MP3; the emitter maps this mime type to an mp3 decoder
# (agents/utils/codecs/decoder.py: "audio/mpeg" -> "mp3") and resamples to the
# sample_rate we pass to initialize().
_EDGE_MIME_TYPE = "audio/mpeg"


class EdgeTTS(tts.TTS):
    """Microsoft Edge (Azure consumer) TTS as a livekit-agents TTS.

    No API key, no service account - which is the point: it must not share a
    failure domain with the Google credentials that the primary depends on.

    Args:
        voice: an edge-tts voice short name. Defaults to gu-IN-DhwaniNeural.
        language: accepted and ignored - the voice already pins the locale. Kept
            in the signature so config.py can hand it the same LANGUAGE it hands
            every other provider, without special-casing this one.
        rate/volume/pitch: edge-tts prosody strings ("+0%", "-10%", "+0Hz").
        sample_rate: declared output rate. Defaults to edge-tts's native 24 kHz.
    """

    def __init__(
        self,
        *,
        voice: str = DEFAULT_EDGE_VOICE,
        language: str | None = None,
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz",
        sample_rate: int = EDGE_SAMPLE_RATE,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=EDGE_NUM_CHANNELS,
        )
        self._voice = voice or DEFAULT_EDGE_VOICE
        self._language = language
        self._rate = rate
        self._volume = volume
        self._pitch = pitch

    @property
    def model(self) -> str:
        return self._voice

    @property
    def provider(self) -> str:
        return "edge-tts"

    @property
    def voice(self) -> str:
        return self._voice

    def update_options(self, *, voice: str | None = None) -> None:
        if voice:
            self._voice = voice

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> _EdgeChunkedStream:
        return _EdgeChunkedStream(tts=self, input_text=text, conn_options=conn_options)


class _EdgeChunkedStream(tts.ChunkedStream):
    """One synthesize request. Pushes raw MP3 into the emitter, which decodes it."""

    def __init__(
        self, *, tts: EdgeTTS, input_text: str, conn_options: APIConnectOptions
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._edge_tts = tts

    async def _run(self, output_emitter: AudioEmitter) -> None:
        # Imported here, not at module scope: this module is imported by config.py
        # on every worker start, and a missing/renamed edge_tts must not be able to
        # take the PRIMARY path down with it. A backup that can crash the thing it
        # is backing up is not a backup.
        try:
            import edge_tts
        except Exception as exc:  # noqa: BLE001
            raise APIConnectionError(f"edge-tts is not installed: {exc}") from exc

        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=self._edge_tts.sample_rate,
            num_channels=self._edge_tts.num_channels,
            mime_type=_EDGE_MIME_TYPE,
        )

        # BOUND THE HANG. livekit does NOT enforce conn_options.timeout for us: it
        # calls `await self._run(output_emitter)` with no timeout wrapper
        # (agents/tts/tts.py _main_task), leaving the deadline to each plugin. So a
        # stalled edge-tts would hang this coroutine indefinitely - a backup that
        # produces the very silence it exists to prevent, and worse than an error
        # because FallbackAdapter never gets to mark it unavailable.
        #
        # Both timeouts are needed and they are not the same thing:
        #   connect_timeout - the WSS handshake never completes.
        #   receive_timeout - handshake fine, then the socket goes quiet mid-stream.
        #     edge-tts defaults this to 60s, which is six times our budget.
        # These bound STALLS, not total duration, so a long sentence that is still
        # streaming is never cut off - only one that has stopped progressing.
        timeout = max(1, int(self._conn_options.timeout or 10))

        pushed = False
        try:
            communicate = edge_tts.Communicate(
                self._input_text,
                voice=self._edge_tts.voice,
                rate=self._edge_tts._rate,
                volume=self._edge_tts._volume,
                pitch=self._edge_tts._pitch,
                connect_timeout=timeout,
                receive_timeout=timeout,
            )
            async for chunk in communicate.stream():
                # edge-tts interleaves {"type": "WordBoundary"} metadata with
                # {"type": "audio", "data": <mp3 bytes>}. Only audio is ours.
                if chunk.get("type") != "audio":
                    continue
                data = chunk.get("data")
                if not data:
                    continue
                output_emitter.push(data)
                pushed = True
        except Exception as exc:  # noqa: BLE001
            # Normalize to APIConnectionError so FallbackAdapter's retry/availability
            # bookkeeping treats it like any other provider failure.
            raise APIConnectionError(f"edge-tts synthesis failed: {exc}") from exc

        if not pushed:
            # A silent success is the worst outcome available: the emitter would
            # close with no audio and the caller hears nothing, with no error
            # anywhere. Fail loudly instead so the adapter can react.
            raise APIConnectionError("edge-tts returned no audio")

        output_emitter.flush()


def build_edge_tts(*, language: str | None = None, voice: str | None = None) -> EdgeTTS:
    """The backup voice, on its own so config.py stays declarative."""
    return EdgeTTS(voice=voice or DEFAULT_EDGE_VOICE, language=language)


def build_fallback_tts(primary: tts.TTS, backup: tts.TTS) -> tts.TTS:
    """primary -> backup, using livekit-agents' own FallbackAdapter.

    Deliberately NOT a hand-rolled try/except wrapper. See this module's docstring
    for what the built-in does that a hand-rolled one would not (background
    recovery probing, resampling, and the already-emitted-audio guard that stops
    a half-spoken sentence being restarted on the backup).

    `sample_rate=None` -> the adapter takes the max of the two and resamples the
    other. Both are 24 kHz today, so that is a no-op; it stays correct if either
    voice changes.

    max_retry_per_tts=0 (the adapter's own default is 2) means ONE attempt at
    Google, then straight to Edge. `max_retry=0` still makes one attempt - the
    retry loop is `e.retryable and max_retry > 0 and i < max_retry`
    (agents/tts/tts.py) - so this is "no retries", not "no tries".

    Why 0 and not 2, measured rather than guessed:
      * conn_options.timeout is 10s PER ATTEMPT. The worst case here is not an
        instant error, it is a HANG - and at the adapter's default of 2 retries a
        hung Chirp3-HD burns 10s + 10s + 10s = ~30s of dead air BEFORE Edge is
        even asked to speak. At 0 it is ~10s. On a phone call, 30s of silence is
        not a degraded call, it is a hung-up call.
      * The failures actually seen on this project (429 free-tier quota, a broken
        service account, Chirp withdrawn for a locale) are all sticky. Retrying
        the same call 100ms later just buys the same error twice.
      * A retry is not free insurance: it is dead air. Failing over is a change of
        voice, which is cheap, and the adapter's background recovery task probes
        Google and takes it back for the next sentence the moment it is healthy.
    Raise TTS_FALLBACK_MAX_RETRY if a future primary has genuinely transient blips.
    """
    return tts.FallbackAdapter(
        [primary, backup],
        max_retry_per_tts=int(os.environ.get("TTS_FALLBACK_MAX_RETRY", "0")),
        sample_rate=None,
    )
