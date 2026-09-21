"""Plymaxx GPU speech providers for the pinned LiveKit Agents 1.3.12 runtime.

These are completed-utterance/completed-phrase APIs. LiveKit's VAD STT adapter
and sentence TTS adapter provide the real-time session plumbing. No request
can fall back to a paid provider. The SDK owns the shared HTTP session.
"""
from __future__ import annotations

import asyncio
import io
import json
import math
import os
import re
import time
import uuid
import unicodedata
import wave
import weakref
from dataclasses import replace
from typing import Callable

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import APIConnectionError, APIStatusError, APITimeoutError, stt, tts, utils
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, APIConnectOptions, NotGivenOr,
)
from speech_pacing import SpeechPacingError, configured_speed, pace_pcm

WHISPER_MODEL = "whisper-large-v3-turbo"
GUJARATI_MODEL = "indic-conformer-600m-multilingual"
TTS_MODEL = "indic-parler-tts"
TTS_SAMPLE_RATE = 44_100
MAX_UTTERANCE_SECONDS = 30
MAX_RESPONSE_BYTES = 24 * 1024 * 1024


def _language(value: str, *, auto: bool = False) -> str:
    code = value.strip().lower().replace("_", "-").split("-")[0]
    code = {"english": "en", "hindi": "hi", "gujarati": "gu"}.get(code, code)
    if code not in ({"en", "hi", "gu", "auto"} if auto else {"en", "hi", "gu"}):
        raise ValueError("Supported speech languages are en, hi and gu" + (", or auto for STT" if auto else ""))
    return code


class _GpuGate:
    """One active plus one waiting request per worker, across STT and TTS."""
    def __init__(self) -> None:
        self.semaphore = asyncio.Semaphore(1)
        self.admitted = 0


_GPU_GATES: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _gpu_gate() -> _GpuGate:
    loop = asyncio.get_running_loop()
    if loop not in _GPU_GATES:
        _GPU_GATES[loop] = _GpuGate()
    return _GPU_GATES[loop]


class _PlymaxxHTTP:
    def __init__(self, http_session: aiohttp.ClientSession | None = None) -> None:
        self.base_url = (os.getenv("AI_BASE_URL") or "https://ai.plymaxx.com/v1").rstrip("/")
        self.api_key = (os.getenv("AI_API_KEY") or "").strip()
        if not self.api_key:
            raise ValueError("AI_API_KEY is required for the self-hosted speech service")
        self.session = http_session

    async def request(
        self, path: str, body: Callable[[], dict], *, timeout: float,
    ) -> bytes:
        gate = _gpu_gate()
        if gate.admitted >= 2:
            raise APIStatusError("Plymaxx speech queue is full", status_code=429, retryable=False)
        gate.admitted += 1
        try:
            # Includes local queueing, the complete response, and retry delay.
            async with asyncio.timeout(timeout):
                async with gate.semaphore:
                    session = self.session or utils.http_context.http_session()
                    for attempt in range(2):
                        retry_delay = None
                        async with session.post(
                            self.base_url + path,
                            headers={"Authorization": "Bearer " + self.api_key},
                            timeout=aiohttp.ClientTimeout(total=timeout),
                            **body(),
                        ) as response:
                            if response.status == 429 and attempt == 0:
                                try:
                                    retry_delay = float(response.headers.get("Retry-After", "0.4"))
                                except ValueError:
                                    retry_delay = 0.4
                                retry_delay = min(1.5, max(0.2, retry_delay))
                            elif response.status >= 400:
                                # Do not put response bodies, transcripts, or keys in errors.
                                raise APIStatusError(
                                    "Plymaxx speech request failed",
                                    status_code=response.status, retryable=False,
                                )
                            else:
                                data = await response.read()
                                if len(data) > MAX_RESPONSE_BYTES:
                                    raise APIConnectionError("Plymaxx speech response exceeds the size limit", retryable=False)
                                return data
                        if retry_delay is not None:
                            await asyncio.sleep(retry_delay)
        except TimeoutError as exc:
            raise APITimeoutError("Plymaxx speech request timed out", retryable=False) from exc
        except aiohttp.ClientError as exc:
            raise APIConnectionError("Plymaxx speech connection failed", retryable=False) from exc
        finally:
            gate.admitted -= 1
        raise APIConnectionError("Plymaxx speech request failed", retryable=False)


def _audio_wav(buffer: utils.AudioBuffer) -> tuple[bytes, float, bool]:
    frame = utils.merge_frames(buffer)
    duration = frame.samples_per_channel / frame.sample_rate
    if duration > MAX_UTTERANCE_SECONDS:
        raise ValueError("Speech utterances must be at most 30 seconds")
    samples = np.frombuffer(frame.data, dtype="<i2")
    if frame.num_channels > 1:
        samples = samples.reshape(-1, frame.num_channels).mean(axis=1).astype("<i2")
    # Only reject digital silence, not softly spoken words, PINs or numbers.
    silent = samples.size == 0 or bool(np.max(np.abs(samples.astype(np.int32))) <= 2)
    mono = rtc.AudioFrame(
        data=samples.astype("<i2", copy=False).tobytes(), sample_rate=frame.sample_rate,
        num_channels=1, samples_per_channel=len(samples),
    )
    if frame.sample_rate == 16_000 or silent:
        pcm = mono.data.tobytes()
        rate = frame.sample_rate
    else:
        resampler = rtc.AudioResampler(frame.sample_rate, 16_000, num_channels=1)
        frames = [*resampler.push(mono), *resampler.flush()]
        pcm = b"".join(part.data.tobytes() for part in frames)
        rate = 16_000
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return output.getvalue(), duration, silent


def _reported_language(payload: dict, text: str, fallback: str) -> str:
    reported = payload.get("language") or payload.get("detected_language")
    if isinstance(reported, str):
        try:
            return _language(reported)
        except ValueError:
            pass
    if re.search(r"[\u0a80-\u0aff]", text):
        return "gu"
    if re.search(r"[\u0900-\u097f]", text):
        return "hi"
    return fallback if fallback != "auto" else "en"


class UnrecognizedSpeech(APIConnectionError):
    """Recognition stayed outside this application's languages after recovery."""


def _unsupported_recognition(payload: dict, text: str) -> bool:
    if any(character.isalpha() and not unicodedata.name(character, "").startswith(
            ("LATIN", "DEVANAGARI", "GUJARATI")) for character in text):
        return True
    # Direct supported-script evidence wins over a contradictory language label.
    if _DEVANAGARI_LETTERS.search(text) or _GUJARATI_LETTERS.search(text):
        return False
    reported = payload.get("language") or payload.get("detected_language")
    if isinstance(reported, str) and reported.strip():
        try:
            _language(reported)
        except ValueError:
            return True
    return False


_GUJARATI_LETTERS = re.compile(r"[\u0a85-\u0ab9\u0ad0\u0ae0-\u0ae1]")
_DEVANAGARI_LETTERS = re.compile(r"[\u0904-\u0939\u0958-\u0961]")
_GUJARATI_PRONOUN_CUES = frozenset({
    "तमारा", "तमारी", "तमारु", "तमारूँ", "तमारूं", "तमने", "मने",
    "tamara", "tamari", "tamaru", "tamne", "mane",
})
_GUJARATI_VERB_CUES = frozenset({
    "छे", "छूँ", "छूं", "छुं", "छु", "छो", "शकूँ", "शकूं", "शकुं", "शकु",
    "chhe", "che", "chhu", "chhun", "shaku", "shakun",
})


def _gujarati_phonetic_cues(text: str) -> bool:
    """Detect multiple Gujarati grammar cues mistranscribed as Hindi.

    This is only a reason to re-recognize the ORIGINAL AUDIO with Indic. It
    never transliterates, translates or fabricates a Gujarati transcript.
    Whole words and both categories are required: e.g. Hindi 'छू', 'छः', a
    company called Tamara, or a single 'छे' are not sufficient evidence.
    """
    words = set(re.findall(r"[a-z]+|[\u0900-\u0963\u0971-\u097f]+", text.lower()))
    return bool(words & _GUJARATI_PRONOUN_CUES) and bool(words & _GUJARATI_VERB_CUES)


def _confidence(payload: dict) -> float:
    segments = payload.get("segments")
    if not isinstance(segments, list):
        return 0.0  # Unknown is not manufactured certainty.
    scores = [float(s["avg_logprob"]) for s in segments
              if isinstance(s, dict) and isinstance(s.get("avg_logprob"), (int, float))
              and math.isfinite(s["avg_logprob"])]
    return math.exp(min(0.0, sum(scores) / len(scores))) if scores else 0.0


class PlymaxxSTT(stt.STT):
    def __init__(
        self, language: str = "auto", *, http_session: aiohttp.ClientSession | None = None,
        redetect_gujarati: bool | None = None,
    ) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._language = _language(language, auto=True)
        self._language_hint = self._language if self._language != "auto" else "en"
        self._http = _PlymaxxHTTP(http_session)
        self._timeout = float(os.getenv("VOICE_STT_TIMEOUT_MS", "20000")) / 1000
        self._redetect_gujarati = (os.getenv("AI_STT_REDECODE_GUJARATI", "0") == "1"
                                  if redetect_gujarati is None else redetect_gujarati)

    @property
    def model(self) -> str:
        return GUJARATI_MODEL if self._language == "gu" else WHISPER_MODEL

    @property
    def provider(self) -> str:
        return "Plymaxx"

    def update_options(self, *, language: str, language_hint: str | None = None) -> None:
        self._language = _language(language, auto=True)
        if language_hint is not None:
            self._language_hint = _language(language_hint)
        elif self._language != "auto":
            self._language_hint = self._language

    async def recognize(
        self, buffer: utils.AudioBuffer, *, language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.SpeechEvent:
        # The HTTP layer alone retries 429 once. SDK retries would multiply load.
        try:
            # Language recovery shares the original request deadline.
            async with asyncio.timeout(self._timeout):
                return await super().recognize(buffer, language=language,
                                               conn_options=replace(conn_options, max_retry=0))
        except TimeoutError as exc:
            raise APITimeoutError("Speech recognition timed out", retryable=False) from exc

    async def _transcribe(self, audio: bytes, language: str) -> dict:
        def body() -> dict:
            form = aiohttp.FormData()
            form.add_field("model", GUJARATI_MODEL if language == "gu" else WHISPER_MODEL)
            form.add_field("language", language)
            form.add_field("response_format", "verbose_json")
            form.add_field("file", audio, filename="utterance.wav", content_type="audio/wav")
            return {"data": form}
        data = await self._http.request("/audio/transcriptions", body, timeout=self._timeout)
        try:
            payload = json.loads(data)
        except (ValueError, UnicodeDecodeError) as exc:
            raise APIConnectionError("Plymaxx returned invalid transcription JSON", retryable=False) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
            raise APIConnectionError("Plymaxx returned an invalid transcription", retryable=False)
        return payload

    async def _recognize_impl(
        self, buffer: utils.AudioBuffer, *, language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        selected = _language(language, auto=True) if isinstance(language, str) else self._language
        audio, duration, silent = _audio_wav(buffer)
        if silent:
            return stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT, alternatives=[])
        payload = await self._transcribe(audio, selected)
        text = payload["text"].strip()
        recovered_language = False
        if selected == "auto" and text and _unsupported_recognition(payload, text):
            # Unrestricted auto detection mistook actual short calls for German
            # and Russian. Re-recognize the SAME audio with the conversation's
            # supported language; never translate or rewrite a guessed transcript.
            payload = await self._transcribe(audio, self._language_hint)
            text = payload["text"].strip()
            recovered_language = True
            invalid_gujarati = self._language_hint == "gu" and (not _GUJARATI_LETTERS.search(text) or bool(_DEVANAGARI_LETTERS.search(text)))
            if not text or _unsupported_recognition(payload, text) or invalid_gujarati:
                # A final recognition miss is recoverable at the conversation
                # level, not an STT transport failure. Raising here would make
                # SDK 1.3.12 close AgentSession and kill the VAD adapter loop.
                self.emit("error", stt.STTError(
                    timestamp=time.time(), label=self._label, recoverable=True,
                    error=UnrecognizedSpeech("Please repeat that in English, Hindi or Gujarati.", retryable=False),
                ))
                return stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT, alternatives=[])
        detected = _reported_language(payload, text, selected)
        # Known Gujarati never pays for Whisper first. Auto re-decode is an
        # explicit opt-in, at most once, because it doubles GPU recognition work.
        if self._redetect_gujarati and selected == "auto" and not recovered_language:
            gujarati_script = bool(_GUJARATI_LETTERS.search(text))
            suspect_gujarati = detected == "gu" or gujarati_script or (detected == "hi" and _gujarati_phonetic_cues(text))
            if suspect_gujarati:
                corrected = await self._transcribe(audio, "gu")
                corrected_text = corrected["text"].strip()
                # A model/language label alone cannot turn empty, English or
                # Hindi output into Gujarati. Retain the usable first decode
                # unless Indic actually returns Gujarati speech text.
                if _GUJARATI_LETTERS.search(corrected_text) and not _DEVANAGARI_LETTERS.search(corrected_text):
                    payload, text, detected = corrected, corrected_text, "gu"
                elif gujarati_script:
                    # Direct script evidence is stronger than a contradictory
                    # Whisper language label; no transcript rewriting occurs.
                    detected = "gu"
        if text and detected in {"en", "hi", "gu"}:
            self._language_hint = detected
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT, request_id=uuid.uuid4().hex,
            alternatives=[stt.SpeechData(text=text, language=detected, end_time=duration,
                                         confidence=_confidence(payload))],
        )


def _split_speech(text: str) -> list[str]:
    """Keep the first completed phrase short, and every GPU request bounded."""
    chunks: list[str] = []
    for sentence in re.split(r"(?<=[.!?\u0964])\s+", text.strip()):
        rest = sentence.strip()
        while rest:
            limit = 200 if not chunks else 400
            if len(rest) <= limit:
                chunks.append(rest)
                break
            cut = rest.rfind(" ", 0, limit + 1)
            if cut < limit // 2:
                cut = limit
            chunks.append(rest[:cut].strip())
            rest = rest[cut:].strip()
    return chunks


def _wav_pcm(data: bytes) -> bytes:
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, TTS_SAMPLE_RATE, "NONE"):
                raise ValueError("unexpected WAV format")
            pcm = wav.readframes(wav.getnframes())
            if not pcm or len(pcm) != wav.getnframes() * 2:
                raise ValueError("empty or incomplete WAV")
            return pcm
    except (wave.Error, EOFError, ValueError) as exc:
        raise APIConnectionError("Plymaxx TTS must return complete mono PCM16 WAV at 44100 Hz", retryable=False) from exc


class PlymaxxTTS(tts.TTS):
    def __init__(
        self, language: str = "en", voice: str = "Neha", *,
        http_session: aiohttp.ClientSession | None = None,
    ) -> None:
        super().__init__(capabilities=tts.TTSCapabilities(streaming=False),
                         sample_rate=TTS_SAMPLE_RATE, num_channels=1)
        self._language = _language(language)
        self._voice = voice
        self._speed = configured_speed()
        self._profile = os.getenv("VOICE_TTS_PROFILE", "default")
        if self._profile not in {"default", "conversational"}:
            raise ValueError("VOICE_TTS_PROFILE must be default or conversational")
        self._http = _PlymaxxHTTP(http_session)
        self._timeout = float(os.getenv("AI_TTS_COMPLETED_TIMEOUT_MS", "90000")) / 1000
        self._streams: weakref.WeakSet = weakref.WeakSet()

    @property
    def model(self) -> str:
        return TTS_MODEL

    @property
    def provider(self) -> str:
        return "Plymaxx"

    def update_options(self, *, language: str) -> None:
        self._language = _language(language)

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        stream = _PlymaxxSpeech(tts=self, text=text, language=self._language, voice=self._voice,
                                conn_options=replace(conn_options, max_retry=0))
        self._streams.add(stream)
        return stream

    async def aclose(self) -> None:
        await asyncio.gather(*(stream.aclose() for stream in list(self._streams)))
        # HTTP is shared with STT and owned by the SDK job (or injected caller).


class _PlymaxxSpeech(tts.ChunkedStream):
    def __init__(self, *, tts: PlymaxxTTS, text: str, language: str, voice: str,
                 conn_options: APIConnectOptions) -> None:
        self._provider = tts
        self._language = language
        self._voice = voice
        super().__init__(tts=tts, input_text=text, conn_options=conn_options)

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        output_emitter.initialize(request_id=uuid.uuid4().hex, sample_rate=TTS_SAMPLE_RATE,
                                  num_channels=1, mime_type="audio/pcm", stream=False)
        chunks = _split_speech(self.input_text)
        for index, chunk in enumerate(chunks):
            payload = {"model": TTS_MODEL, "voice": self._voice, "language": self._language,
                       "input": chunk, "response_format": "wav"}
            if self._provider._profile != "default":
                payload["profile"] = self._provider._profile
            data = await self._provider._http.request(
                "/audio/speech", lambda: {"json": payload}, timeout=self._provider._timeout,
            )
            try:
                pcm = await pace_pcm(_wav_pcm(data), speed=self._provider._speed)
            except SpeechPacingError as exc:
                raise APIConnectionError("Speech pacing failed", retryable=False) from exc
            output_emitter.push(pcm)
            if index < len(chunks) - 1:
                output_emitter.flush()
            # Cancellation propagates into the HTTP context; no background
            # request, synthesis prefetch or retry continues after barge-in.
