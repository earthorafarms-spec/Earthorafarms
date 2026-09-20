"""The TTS fallback must turn a dead primary into a different voice, never silence.

Owner, 2026-07-14: "if stt,tts fails, keep a fallback of device based -
browserapi, edgetts". The failure being covered is specific and nasty: main.py's
session error handler answers every other outage by SPEAKING an apology
(FALLBACK_LINE), but if TTS is what died the apology cannot be spoken either. The
caller hears nothing and assumes the line dropped. So the property under test is
not "the wrapper is wired up" - it is "audio still comes out when the primary
raises".

NO NETWORK. Every TTS here is a local fake emitting raw PCM; the one edge-tts
test stubs `edge_tts.Communicate`. These tests must pass on a laptop with no
Google credentials, no internet, and a firewalled CI box - a fallback whose test
needs the network is a test that goes red for the exact reason the fallback
exists.

Run:  python -m pytest eval/test_fallback_tts.py -v
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, List

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from livekit.agents import APIConnectionError, APIConnectOptions, tts  # noqa: E402
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS  # noqa: E402

from agent import providers_fallback as pf  # noqa: E402

# --- fakes ----------------------------------------------------------------

SAMPLE_RATE = 24000

# 100ms of s16 mono silence-ish PCM. Content is irrelevant; LENGTH is not - the
# emitter frames on duration, so a couple of bytes would produce zero frames and
# the test would "pass" while proving nothing.
_PCM_BYTES = b"\x01\x02" * (SAMPLE_RATE // 10)


class _FakeTTS(tts.TTS):
    """A local TTS that either emits PCM or raises. Records what it was asked to say."""

    def __init__(
        self,
        *,
        name: str,
        fail: bool = False,
        sample_rate: int = SAMPLE_RATE,
        fail_after_audio: bool = False,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self.name = name
        self.fail = fail
        self.fail_after_audio = fail_after_audio
        self.requests: List[str] = []  # every text this TTS was asked to synthesize

    @property
    def provider(self) -> str:
        return self.name

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "_FakeStream":
        return _FakeStream(tts=self, input_text=text, conn_options=conn_options)


class _FakeStream(tts.ChunkedStream):
    async def _run(self, output_emitter: Any) -> None:
        fake: _FakeTTS = self._tts  # type: ignore[assignment]
        fake.requests.append(self._input_text)

        if fake.fail and not fake.fail_after_audio:
            raise APIConnectionError(f"{fake.name} is down")

        output_emitter.initialize(
            request_id="fake",
            sample_rate=fake.sample_rate,
            num_channels=1,
            mime_type="audio/pcm",
        )
        output_emitter.push(_PCM_BYTES)

        if fake.fail_after_audio:
            # The nasty case: died PART WAY THROUGH a sentence.
            raise APIConnectionError(f"{fake.name} died mid-sentence")

        output_emitter.flush()


async def _synthesize(engine: tts.TTS, text: str) -> List[Any]:
    """Drive a TTS to completion and return its audio frames."""
    frames: List[Any] = []
    async with engine.synthesize(text) as stream:
        async for ev in stream:
            frames.append(ev.frame)
    return frames


def _audio_ms(frames: List[Any]) -> float:
    return sum(f.duration for f in frames) * 1000.0


# --- the point of the whole file -----------------------------------------

GUJARATI = "માફ કરશો, અત્યારે સિસ્ટમમાં થોડી તકલીફ છે."


def test_primary_fails_backup_speaks_the_same_text() -> None:
    """The load-bearing test: primary raises -> caller still hears the SAME sentence."""
    primary = _FakeTTS(name="primary", fail=True)
    backup = _FakeTTS(name="backup")
    engine = pf.build_fallback_tts(primary, backup)

    frames = asyncio.run(_synthesize(engine, GUJARATI))

    # Audio came out. This is the anti-silence assertion.
    assert frames, "primary failed and NOTHING was spoken - this is the silent-call bug"
    assert _audio_ms(frames) == pytest.approx(100, abs=25)

    # It was tried on the primary first, then retried VERBATIM on the backup.
    # Verbatim matters: a fallback that re-synthesizes a truncated or re-encoded
    # string would quote a different sentence than the one the guard approved.
    assert primary.requests, "primary was never tried"
    assert backup.requests == [GUJARATI]
    assert primary.requests[0] == backup.requests[0]


def test_primary_ok_backup_never_touched() -> None:
    """The fallback must be invisible when nothing is wrong - no double spend, no double voice."""
    primary = _FakeTTS(name="primary")
    backup = _FakeTTS(name="backup")
    engine = pf.build_fallback_tts(primary, backup)

    frames = asyncio.run(_synthesize(engine, GUJARATI))

    assert frames
    assert primary.requests == [GUJARATI]
    assert backup.requests == [], "backup spoke while the primary was healthy"


def test_both_fail_raises_rather_than_hanging() -> None:
    """Total TTS failure must surface as an error main.py can see, not a silent hang.

    session.on("error") is what closes the call politely; swallowing this would
    leave the caller on a dead line forever.
    """
    primary = _FakeTTS(name="primary", fail=True)
    backup = _FakeTTS(name="backup", fail=True)
    engine = pf.build_fallback_tts(primary, backup)

    with pytest.raises(APIConnectionError):
        asyncio.run(_synthesize(engine, GUJARATI))

    assert primary.requests and backup.requests, "both providers should have been tried"


def test_primary_dying_mid_sentence_does_not_stutter_the_caller() -> None:
    """A primary that pushes half a sentence and THEN dies must not produce a stutter.

    The danger is "માફ કરશો, અત્યા—" in Chirp3-HD immediately followed by the whole
    sentence again in Dhwani. VERIFIED behaviour of the two guards that prevent it:

      * ChunkedStream aborts a failed attempt with `output_emitter.aclose()`,
        commented in agents/tts/tts.py as settling the emitter "so no frames from
        this attempt are delivered" - partial audio from a failed attempt never
        reaches the caller at all;
      * FallbackAdapter additionally refuses to fail over once audio HAS been
        delivered (`if output_emitter.pushed_duration() > 0.0: ... return`).

    Net effect asserted here: the caller hears the sentence exactly ONCE, in the
    backup voice, with no fragment in front of it. Pinned because this is the
    behaviour a hand-rolled try/except wrapper gets wrong - it would happily
    deliver the fragment and then re-speak the whole line.
    """
    primary = _FakeTTS(name="primary", fail=True, fail_after_audio=True)
    backup = _FakeTTS(name="backup")
    engine = pf.build_fallback_tts(primary, backup)

    frames = asyncio.run(_synthesize(engine, GUJARATI))

    # NOT asserting a call count on the primary: once it fails, the adapter spawns
    # a background recovery probe that re-synthesizes the same text to see if the
    # provider is back. Whether that task lands before the loop closes is a race,
    # and pinning it would make this test flaky for no benefit.
    assert primary.requests, "primary was never tried"
    assert backup.requests == [GUJARATI], "the caller must still hear the sentence, exactly once"
    # Exactly one sentence of audio - the primary's discarded fragment must not be
    # prepended to the backup's full take.
    assert _audio_ms(frames) == pytest.approx(100, abs=25), (
        "got more audio than one take of the sentence - the primary's aborted "
        "fragment leaked through in front of the backup"
    )


def test_resamples_a_backup_that_disagrees_on_rate() -> None:
    """A 16k backup behind a 24k primary must still come out at the pipeline rate.

    Not hypothetical: the moment someone changes TTS_FALLBACK_SAMPLE_RATE or swaps
    a voice, these diverge. Mismatched rates played as-is are chipmunk audio.
    """
    primary = _FakeTTS(name="primary", fail=True, sample_rate=24000)
    backup = _FakeTTS(name="backup", sample_rate=16000)
    engine = pf.build_fallback_tts(primary, backup)

    assert engine.sample_rate == 24000  # max of the two

    frames = asyncio.run(_synthesize(engine, GUJARATI))
    assert frames
    assert all(f.sample_rate == 24000 for f in frames)


# --- the built-in adapter is what we actually use -------------------------


def test_wrapper_is_the_livekit_fallback_adapter_not_a_hand_roll() -> None:
    """Documents the choice: livekit-agents ships FallbackAdapter, so we use it.

    If a future edit swaps this for a bespoke wrapper, that edit should have to
    delete this test and justify losing background recovery, resampling and the
    already-emitted guard above.
    """
    engine = pf.build_fallback_tts(_FakeTTS(name="p"), _FakeTTS(name="b"))
    assert isinstance(engine, tts.FallbackAdapter)


# --- EdgeTTS itself (still no network) ------------------------------------


class _FakeCommunicate:
    """Stands in for edge_tts.Communicate. Never opens a socket."""

    last_kwargs: dict = {}

    def __init__(self, text: str, voice: str = "", **kwargs: Any) -> None:
        _FakeCommunicate.last_kwargs = {"text": text, "voice": voice, **kwargs}
        self._text = text

    async def stream(self):
        # Real edge-tts interleaves WordBoundary metadata with audio chunks; the
        # WordBoundary entries carry no "data" and must not be pushed as audio.
        yield {"type": "WordBoundary", "offset": 0, "duration": 100}
        yield {"type": "audio", "data": b"\xff\xfb\x90\x00fake-mp3-chunk-1"}
        yield {"type": "audio", "data": b"more-mp3-chunk-2"}


class _SilentCommunicate(_FakeCommunicate):
    async def stream(self):
        yield {"type": "WordBoundary", "offset": 0, "duration": 100}


class _RecordingEmitter:
    """Captures what EdgeTTS._run pushes, without decoding MP3."""

    def __init__(self) -> None:
        self.init_kwargs: dict = {}
        self.pushed: List[bytes] = []
        self.flushed = False

    def initialize(self, **kwargs: Any) -> None:
        self.init_kwargs = kwargs

    def push(self, data: bytes) -> None:
        self.pushed.append(data)

    def flush(self) -> None:
        self.flushed = True


def _run_edge(engine: pf.EdgeTTS, emitter: _RecordingEmitter, text: str = GUJARATI) -> None:
    """Drive EdgeTTS._run against a recording emitter.

    The stream is constructed INSIDE the loop: ChunkedStream.__init__ opens a
    channel and spawns its metrics task, so building one without a running loop
    dies with "no current event loop".
    """

    async def _go() -> None:
        stream = pf._EdgeChunkedStream(
            tts=engine, input_text=text, conn_options=DEFAULT_API_CONNECT_OPTIONS
        )
        try:
            await stream._run(emitter)
        finally:
            await stream.aclose()

    asyncio.run(_go())


def test_edge_tts_declares_a_gujarati_voice_at_the_pipeline_rate() -> None:
    engine = pf.build_edge_tts(language="gu-IN")
    assert engine.voice == "gu-IN-DhwaniNeural"  # VERIFIED to exist in edge-tts
    assert engine.sample_rate == 24000  # edge-tts native: audio-24khz-...-mono-mp3
    assert engine.num_channels == 1
    # Non-streaming on purpose - FallbackAdapter wraps it in StreamAdapter.
    assert engine.capabilities.streaming is False


def test_edge_tts_pushes_audio_and_skips_word_boundaries(monkeypatch: Any) -> None:
    import edge_tts

    monkeypatch.setattr(edge_tts, "Communicate", _FakeCommunicate)

    engine = pf.build_edge_tts(language="gu-IN")
    emitter = _RecordingEmitter()
    _run_edge(engine, emitter)

    assert emitter.pushed == [b"\xff\xfb\x90\x00fake-mp3-chunk-1", b"more-mp3-chunk-2"]
    assert emitter.flushed
    # MP3 in -> the emitter must be told so, or it would frame MP3 bytes as PCM
    # and emit noise.
    assert emitter.init_kwargs["mime_type"] == "audio/mpeg"
    assert emitter.init_kwargs["sample_rate"] == 24000
    # The Gujarati voice actually reached edge-tts, and the text went through
    # unmodified.
    assert _FakeCommunicate.last_kwargs["voice"] == "gu-IN-DhwaniNeural"
    assert _FakeCommunicate.last_kwargs["text"] == GUJARATI


def test_edge_tts_raises_when_it_returns_no_audio(monkeypatch: Any) -> None:
    """A silent success is worse than an error: the caller hears nothing and the
    adapter never learns to fail over."""
    import edge_tts

    monkeypatch.setattr(edge_tts, "Communicate", _SilentCommunicate)

    engine = pf.build_edge_tts(language="gu-IN")
    with pytest.raises(APIConnectionError):
        _run_edge(engine, _RecordingEmitter())


def test_edge_tts_bounds_its_own_hang(monkeypatch: Any) -> None:
    """livekit does NOT time out _run for us - agents/tts/tts.py awaits it bare - so
    EdgeTTS must pass its deadline down to edge-tts itself. Otherwise a stalled
    socket hangs the coroutine forever: silence, from the anti-silence path, and
    FallbackAdapter never even learns the backup is sick.

    Asserts the timeouts are actually handed to edge-tts rather than trusting the
    library's own 60s receive default, which is 6x the pipeline's 10s budget.
    """
    import edge_tts

    monkeypatch.setattr(edge_tts, "Communicate", _FakeCommunicate)

    engine = pf.build_edge_tts(language="gu-IN")
    _run_edge(engine, _RecordingEmitter())

    kwargs = _FakeCommunicate.last_kwargs
    # 10s = DEFAULT_API_CONNECT_OPTIONS.timeout, i.e. the pipeline's budget, not
    # edge-tts's default.
    assert kwargs["connect_timeout"] == 10, "a dead WSS handshake would hang the backup"
    assert kwargs["receive_timeout"] == 10, "a socket going quiet mid-stream would hang the backup"


def test_edge_tts_errors_normalize_to_api_connection_error(monkeypatch: Any) -> None:
    """FallbackAdapter's bookkeeping keys on exceptions; a raw socket error from a
    vendor lib must not leak through as something it does not expect."""
    import edge_tts

    class _Boom(_FakeCommunicate):
        async def stream(self):
            raise OSError("dns exploded")
            yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(edge_tts, "Communicate", _Boom)

    engine = pf.build_edge_tts(language="gu-IN")
    with pytest.raises(APIConnectionError):
        _run_edge(engine, _RecordingEmitter())


# --- config wiring --------------------------------------------------------
#
# agent/config.py reads env at MODULE level, so testing build_tts() under a
# different .env means reloading the module. That is a global mutation - the
# reloaded module object is shared with every other test file in the suite (and
# agent/tools.py imports it) - so the fixture below puts it back. Without that,
# running the full suite would leave config pinned at whatever the LAST wiring
# test set, and a later failure would look like a bug in someone else's file.

_CONFIG_ENV_KEYS = ("TTS_FALLBACK", "TTS_PROVIDER", "TTS_FALLBACK_MAX_RETRY")


@pytest.fixture(autouse=True)
def _restore_config_module():
    import importlib
    import os

    saved = {k: os.environ.get(k) for k in _CONFIG_ENV_KEYS}
    yield
    # Restore env explicitly rather than leaning on monkeypatch's teardown - the
    # reload has to happen AFTER the env is clean, and fixture finalizer ordering
    # is not something this test file should have to reason about.
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    import agent.config

    importlib.reload(agent.config)


def _reload_config(monkeypatch: Any, **env: str):
    import importlib

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import agent.config as cfg

    return importlib.reload(cfg)


def test_config_defaults_to_the_edge_fallback(monkeypatch: Any) -> None:
    """Default-ON. A fallback you have to remember to switch on is not a fallback."""
    monkeypatch.delenv("TTS_FALLBACK", raising=False)
    cfg = _reload_config(monkeypatch)
    assert cfg.TTS_FALLBACK == "edge"


def test_config_fallback_none_returns_the_bare_primary(monkeypatch: Any) -> None:
    cfg = _reload_config(monkeypatch, TTS_FALLBACK="none", TTS_PROVIDER="edge")
    engine = cfg.build_tts()
    assert isinstance(engine, pf.EdgeTTS)
    assert not isinstance(engine, tts.FallbackAdapter)


def test_config_rejects_an_unknown_fallback_rather_than_silently_disabling_it(
    monkeypatch: Any,
) -> None:
    """A typo in .env (TTS_FALLBACK=edgetts) must not quietly ship a bot with no
    backup voice. Fail at startup, where someone will see it."""
    cfg = _reload_config(monkeypatch, TTS_FALLBACK="edgetts", TTS_PROVIDER="edge")
    with pytest.raises(ValueError, match="TTS_FALLBACK"):
        cfg.build_tts()


def test_config_does_not_stack_edge_on_edge(monkeypatch: Any) -> None:
    """edge -> edge is not redundancy, it is the same failure twice."""
    cfg = _reload_config(monkeypatch, TTS_FALLBACK="edge", TTS_PROVIDER="edge")
    engine = cfg.build_tts()
    assert isinstance(engine, pf.EdgeTTS)


def test_config_wraps_a_non_edge_primary_with_the_edge_backup(monkeypatch: Any) -> None:
    """The real shipping path (google primary + edge backup), with the Google plugin
    stubbed so this runs with no credentials and no network."""
    cfg = _reload_config(monkeypatch, TTS_FALLBACK="edge", TTS_PROVIDER="google")
    monkeypatch.setattr(cfg, "_build_primary_tts", lambda: _FakeTTS(name="google"))

    engine = cfg.build_tts()

    assert isinstance(engine, tts.FallbackAdapter)
    assert engine.sample_rate == 24000
    # And it really does fall back, through the config-built object.
    frames = asyncio.run(_synthesize(engine, GUJARATI))
    assert frames


def test_a_broken_backup_never_takes_down_a_working_primary(monkeypatch: Any) -> None:
    """If building edge-tts throws (uninstalled, renamed API), the bot must still
    boot on Google alone. The backup exists to add safety, not to add a way to die."""
    cfg = _reload_config(monkeypatch, TTS_FALLBACK="edge", TTS_PROVIDER="google")
    primary = _FakeTTS(name="google")
    monkeypatch.setattr(cfg, "_build_primary_tts", lambda: primary)

    def _explode(**kwargs: Any):
        raise RuntimeError("edge_tts import blew up")

    monkeypatch.setattr(pf, "build_edge_tts", _explode)

    engine = cfg.build_tts()
    assert engine is primary, "a broken backup must degrade to primary-only, not raise"
