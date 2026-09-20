"""Provider contract tests using real LiveKit 1.3.12; GPU HTTP is faked."""
import asyncio
import io
import json
import sys
import wave
from pathlib import Path

import numpy as np
import pytest
from livekit import rtc
from livekit.agents import APIConnectionError, APIStatusError, APITimeoutError, stt, tts
from livekit.agents.types import APIConnectOptions

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import plymaxx as p


@pytest.fixture(autouse=True)
def configuration(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "test-only-not-a-secret")
    monkeypatch.setenv("AI_BASE_URL", "https://speech.invalid/v1")
    monkeypatch.setenv("VOICE_STT_TIMEOUT_MS", "20000")
    monkeypatch.setenv("AI_TTS_COMPLETED_TIMEOUT_MS", "90000")
    monkeypatch.delenv("AI_STT_REDECODE_GUJARATI", raising=False)


def audio(*, sample_rate=16000, channels=1, seconds=.1, silent=False):
    count = int(sample_rate * seconds)
    data = np.zeros(count, dtype="<i2") if silent else (
        np.sin(np.arange(count) * 2 * np.pi * 440 / sample_rate) * 5000
    ).astype("<i2")
    return rtc.AudioFrame(data=np.repeat(data, channels).tobytes(), sample_rate=sample_rate,
                          num_channels=channels, samples_per_channel=count)


def wav_bytes(*, sample_rate=44100, channels=1, count=4410):
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x08\x00" * count * channels)
    return out.getvalue()


class Response:
    def __init__(self, body=b"", *, status=200, headers=None, blocker=None):
        self.body = body
        self.status = status
        self.headers = headers or {}
        self.blocker = blocker
        self.entered = asyncio.Event()
        self.closed = False

    async def __aenter__(self):
        self.entered.set()
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def read(self):
        if self.blocker is not None:
            await self.blocker.wait()
        return self.body


class Session:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        assert self.responses, "unexpected extra GPU request"
        return self.responses.pop(0)


def form_fields(call):
    return {str(name["name"]): value for name, headers, value in call[1]["data"]._fields}


@pytest.mark.parametrize("language,model", [
    ("en", p.WHISPER_MODEL), ("hi-IN", p.WHISPER_MODEL),
    ("gu", p.GUJARATI_MODEL), ("auto", p.WHISPER_MODEL),
])
@pytest.mark.asyncio
async def test_stt_routes_languages_and_uploads_mono_16k_wav(language, model):
    session = Session(Response(json.dumps({"text": "hello", "language": "en"}).encode()))
    provider = p.PlymaxxSTT(language=language, http_session=session)
    event = await provider.recognize(audio(sample_rate=48000, channels=2))
    assert event.type == stt.SpeechEventType.FINAL_TRANSCRIPT
    assert event.alternatives[0].text == "hello"
    assert event.alternatives[0].confidence == 0
    fields = form_fields(session.calls[0])
    assert fields["model"] == model
    assert fields["language"] == language.split("-")[0]
    assert fields["response_format"] == "verbose_json"
    with wave.open(io.BytesIO(fields["file"])) as wav:
        assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (1, 16000, 2)
        assert abs(wav.getnframes() / 16000 - .1) < .01


@pytest.mark.asyncio
async def test_stt_silence_skips_gpu_and_long_audio_is_rejected():
    session = Session()
    provider = p.PlymaxxSTT(http_session=session)
    assert (await provider.recognize(audio(silent=True))).alternatives == []
    with pytest.raises(ValueError, match="30 seconds"):
        await provider.recognize(audio(seconds=30.01))
    assert session.calls == []


@pytest.mark.asyncio
async def test_stt_preserves_repeated_digits_and_reports_confidence():
    session = Session(Response(json.dumps({
        "text": "zero zero zero zero zero zero zero zero zero zero zero zero",
        "language": "English", "segments": [{"avg_logprob": -0.2}],
    }).encode()))
    event = await p.PlymaxxSTT(http_session=session).recognize(audio())
    assert event.alternatives[0].text.count("zero") == 12
    assert event.alternatives[0].language == "en"
    assert .81 < event.alternatives[0].confidence < .82


@pytest.mark.asyncio
async def test_stt_auto_gujarati_has_no_extra_decode_by_default():
    session = Session(Response(json.dumps({"text": "નમસ્તે", "language": "gu"}).encode()))
    provider = p.PlymaxxSTT(http_session=session)
    event = await provider.recognize(audio())
    assert event.alternatives[0].language == "gu"
    assert len(session.calls) == 1


@pytest.mark.asyncio
async def test_stt_gujarati_redetection_is_one_explicit_extra_call():
    session = Session(Response(b'{"text":"first","language":"gu"}'),
                      Response(json.dumps({"text": "નમસ્તે"}).encode()))
    provider = p.PlymaxxSTT(http_session=session, redetect_gujarati=True)
    assert (await provider.recognize(audio())).alternatives[0].text == "નમસ્તે"
    assert [form_fields(call)["model"] for call in session.calls] == [p.WHISPER_MODEL, p.GUJARATI_MODEL]


@pytest.mark.asyncio
async def test_stt_update_options_changes_next_model():
    session = Session(Response(json.dumps({"text": "નમસ્તે"}).encode()))
    provider = p.PlymaxxSTT(http_session=session)
    provider.update_options(language="gu-IN")
    event = await provider.recognize(audio())
    assert provider.model == p.GUJARATI_MODEL
    assert event.alternatives[0].language == "gu"
    assert form_fields(session.calls[0])["language"] == "gu"


@pytest.mark.parametrize("payload", [b"not json", b"[]", b'{"text":null}'])
@pytest.mark.asyncio
async def test_stt_rejects_invalid_provider_response_without_sdk_retry(payload):
    session = Session(Response(payload))
    with pytest.raises(APIConnectionError):
        await p.PlymaxxSTT(http_session=session).recognize(audio(), conn_options=APIConnectOptions(max_retry=8))
    assert len(session.calls) == 1


@pytest.mark.parametrize("language", ["en", "hi", "gu"])
@pytest.mark.asyncio
async def test_tts_same_neha_voice_all_languages_and_correct_audio(language):
    session = Session(Response(wav_bytes()))
    provider = p.PlymaxxTTS(language=language, http_session=session)
    assert provider.capabilities.streaming is False
    async with provider.synthesize("A short answer.") as stream:
        frames = [event.frame async for event in stream]
    assert frames
    assert sum(f.samples_per_channel for f in frames) == 4410
    assert all(f.sample_rate == 44100 and f.num_channels == 1 for f in frames)
    payload = session.calls[0][1]["json"]
    assert payload == {"model": "indic-parler-tts", "voice": "Neha", "language": language,
                       "input": "A short answer.", "response_format": "wav"}


@pytest.mark.asyncio
async def test_tts_stream_adapter_uses_provider_and_language_is_captured_per_speech():
    session = Session(Response(wav_bytes()), Response(wav_bytes()))
    provider = p.PlymaxxTTS(http_session=session)
    adapter = tts.StreamAdapter(tts=provider)
    async with adapter.stream() as stream:
        stream.push_text("First sentence.")
        stream.end_input()
        frames = [event.frame async for event in stream]
    assert frames
    provider.update_options(language="hi")
    speech = provider.synthesize("नमस्ते।")
    provider.update_options(language="gu")
    async with speech:
        assert [event async for event in speech]
    assert [call[1]["json"]["language"] for call in session.calls] == ["en", "hi"]
    await adapter.aclose()
    await provider.aclose()


def test_speech_chunk_limits_do_not_truncate_long_replies():
    text = " ".join(["English Hindi Gujarati"] * 80)
    chunks = p._split_speech(text)
    assert len(chunks[0]) <= 200
    assert all(len(chunk) <= 400 for chunk in chunks)
    assert " ".join(chunks) == text
    assert p._split_speech("नमस्ते। તમે કેમ છો? Hello.") == ["नमस्ते।", "તમે કેમ છો?", "Hello."]


@pytest.mark.parametrize("data", [b"", b"not wav", wav_bytes(sample_rate=22050), wav_bytes(channels=2)],
                         ids=["empty", "not-wav", "wrong-rate", "stereo"])
@pytest.mark.asyncio
async def test_tts_rejects_invalid_wav_without_paid_or_sdk_retry(data):
    session = Session(Response(data))
    provider = p.PlymaxxTTS(http_session=session)
    with pytest.raises(APIConnectionError):
        async with provider.synthesize("Hello", conn_options=APIConnectOptions(max_retry=8)) as stream:
            async for _ in stream:
                pass
    assert len(session.calls) == 1


@pytest.mark.asyncio
async def test_429_retry_is_bounded_and_form_is_rebuilt():
    session = Session(Response(status=429, headers={"Retry-After": "0"}),
                      Response(b'{"text":"hello","language":"en"}'))
    provider = p.PlymaxxSTT(http_session=session)
    assert (await provider.recognize(audio())).alternatives[0].text == "hello"
    assert len(session.calls) == 2
    assert session.calls[0][1]["data"] is not session.calls[1][1]["data"]
    overloaded = Session(Response(status=429), Response(status=429))
    with pytest.raises(APIStatusError) as error:
        await p.PlymaxxSTT(http_session=overloaded).recognize(audio())
    assert error.value.status_code == 429
    assert len(overloaded.calls) == 2


@pytest.mark.asyncio
async def test_gpu_queue_is_serial_and_rejects_third_request():
    blocker = asyncio.Event()
    first = Response(b"one", blocker=blocker)
    second = Response(b"two")
    session = Session(first, second)
    client = p._PlymaxxHTTP(session)
    one = asyncio.create_task(client.request("/audio/speech", lambda: {"json": {}}, timeout=3))
    await first.entered.wait()
    two = asyncio.create_task(client.request("/audio/transcriptions", lambda: {"json": {}}, timeout=3))
    await asyncio.sleep(0)
    with pytest.raises(APIStatusError, match="queue is full"):
        await client.request("/audio/speech", lambda: {"json": {}}, timeout=3)
    assert len(session.calls) == 1
    blocker.set()
    assert await one == b"one"
    assert await two == b"two"
    assert p._gpu_gate().admitted == 0


@pytest.mark.asyncio
async def test_barge_in_cancels_http_without_requesting_later_chunks():
    pending = Response(wav_bytes(), blocker=asyncio.Event())
    session = Session(pending)
    provider = p.PlymaxxTTS(http_session=session)
    stream = provider.synthesize("First sentence. Second sentence.")
    await asyncio.wait_for(pending.entered.wait(), timeout=2)
    await stream.aclose()
    assert pending.closed
    assert len(session.calls) == 1
    assert p._gpu_gate().admitted == 0


@pytest.mark.asyncio
async def test_deadline_includes_response_body_and_releases_queue():
    pending = Response(blocker=asyncio.Event())
    session = Session(pending)
    with pytest.raises(APITimeoutError):
        await p._PlymaxxHTTP(session).request("/audio/speech", lambda: {"json": {}}, timeout=.02)
    assert pending.closed
    assert p._gpu_gate().admitted == 0


def test_configuration_and_language_rejections(monkeypatch):
    with pytest.raises(ValueError, match="Supported"):
        p.PlymaxxSTT(language="fr")
    with pytest.raises(ValueError, match="Supported"):
        p.PlymaxxTTS(language="auto")
    monkeypatch.delenv("AI_API_KEY")
    with pytest.raises(ValueError, match="AI_API_KEY"):
        p.PlymaxxTTS()
