"""Offline CPU tests: duration, retained quiet speech, pitch and child cleanup."""
import asyncio
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import speech_pacing as pacing


@pytest.fixture(scope="module")
def ffmpeg():
    executable = os.getenv("VOICE_TEST_FFMPEG") or shutil.which("ffmpeg")
    if not executable:
        try:
            import imageio_ffmpeg
            executable = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            pytest.fail("Real FFmpeg is required for speech pacing acceptance")
    return executable


def tone(hz=220, seconds=3, amplitude=6000):
    samples = np.arange(round(seconds * pacing.SAMPLE_RATE))
    return np.rint(amplitude * np.sin(samples * 2 * np.pi * hz / pacing.SAMPLE_RATE)).astype("<i2").tobytes()


def dominant_frequency(pcm):
    data = np.frombuffer(pcm, dtype="<i2").astype(float)
    # Ignore the short crossfade at both boundaries.
    data = data[pacing.SAMPLE_RATE // 4:-pacing.SAMPLE_RATE // 4]
    power = np.abs(np.fft.rfft(data * np.hanning(len(data))))
    return np.fft.rfftfreq(len(data), 1 / pacing.SAMPLE_RATE)[power.argmax()]


@pytest.mark.parametrize("speed", [1.1, 1.2, 1.4])
def test_real_ffmpeg_changes_duration_without_shifting_pitch(ffmpeg, speed):
    pcm = tone()
    output = asyncio.run(pacing.pace_pcm(pcm, speed=speed, executable=ffmpeg))
    assert abs(len(output) / len(pcm) - 1 / speed) < 0.025
    assert abs(dominant_frequency(output) - 220) < 2
    assert len(output) % 2 == 0


def test_quiet_voiced_audio_is_preserved_at_its_original_pitch(ffmpeg):
    pcm = tone(hz=330, amplitude=24)
    output = asyncio.run(pacing.pace_pcm(pcm, speed=1.2, executable=ffmpeg))
    samples = np.frombuffer(output, dtype="<i2").astype(float)
    assert np.sqrt(np.mean(samples ** 2)) > 10
    assert abs(dominant_frequency(output) - 330) < 2
    assert abs(len(output) / len(pcm) - 1 / 1.2) < 0.025


def test_digital_silence_is_retained_and_only_tempo_changes_length(ffmpeg):
    pcm = b"\0\0" * (pacing.SAMPLE_RATE * 3)
    output = asyncio.run(pacing.pace_pcm(pcm, speed=1.2, executable=ffmpeg))
    assert not any(output)
    assert abs(len(output) / len(pcm) - 1 / 1.2) < 0.04


def test_speed_one_is_byte_identical_and_needs_no_binary():
    pcm = tone(seconds=0.2)
    assert asyncio.run(pacing.pace_pcm(pcm, speed=1, executable="missing-binary")) is pcm


@pytest.mark.parametrize("value", ["0.99", "1.41", "nan", "inf", "text", ""])
def test_invalid_environment_speed_fails_before_processing(monkeypatch, value):
    monkeypatch.setenv("VOICE_TTS_SPEED", value)
    with pytest.raises(ValueError, match="VOICE_TTS_SPEED"):
        pacing.configured_speed()


def test_default_speed_is_configurable(monkeypatch):
    monkeypatch.delenv("VOICE_TTS_SPEED", raising=False)
    assert pacing.configured_speed() == 1.2
    monkeypatch.setenv("VOICE_TTS_SPEED", "1.15")
    assert pacing.configured_speed() == 1.15


@pytest.mark.parametrize("pcm", [b"", b"\0", b"\0" * (pacing.MAX_PCM_BYTES + 2)], ids=["empty", "odd-byte", "over-limit"])
def test_invalid_or_excessive_pcm_is_rejected(pcm):
    with pytest.raises(ValueError, match="PCM16"):
        asyncio.run(pacing.pace_pcm(pcm))


def test_missing_executable_has_static_diagnostic():
    with pytest.raises(pacing.SpeechPacingError, match="executable is unavailable"):
        asyncio.run(pacing.pace_pcm(tone(), executable="earthora-nonexistent-ffmpeg"))


@pytest.mark.parametrize("cancel", [False, True])
def test_timeout_and_cancellation_reap_real_ffmpeg(monkeypatch, ffmpeg, cancel):
    real_spawn = asyncio.create_subprocess_exec
    processes = []

    async def run():
        ready = asyncio.Event()
        async def blocked_process(*args, **kwargs):
            # Force the real FFmpeg test process to consume this three-second
            # tone in real time. Production processing has no such throttle.
            args = list(args)
            args.insert(args.index("-i"), "-re")
            process = await real_spawn(*args, **kwargs)
            processes.append(process)
            ready.set()
            return process
        monkeypatch.setattr(pacing.asyncio, "create_subprocess_exec", blocked_process)
        started = time.monotonic()
        task = asyncio.create_task(pacing.pace_pcm(tone(), executable=ffmpeg, timeout_seconds=0.3 if not cancel else 5))
        await asyncio.wait_for(ready.wait(), timeout=3)
        if cancel:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(pacing.SpeechPacingError, match="timed out"):
                await task
        assert time.monotonic() - started < 2
        assert processes[0].returncode is not None
    asyncio.run(run())
