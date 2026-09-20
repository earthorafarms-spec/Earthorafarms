"""Earthora-only pitch-preserving tempo for completed Neha PCM clips.

The GPU's named speaker, generation defaults and billing path are unchanged.
Input and output are mono PCM16 little-endian at 44,100 Hz. FFmpeg runs locally
with pipes, no shell or temporary files. Quiet speech and pauses are retained:
an energy threshold alone cannot safely distinguish a pause from a phoneme.
"""
from __future__ import annotations

import asyncio
import contextlib
import math
import os

SAMPLE_RATE = 44_100
MAX_PCM_BYTES = SAMPLE_RATE * 2 * 60
DEFAULT_SPEED = 1.20
MIN_SPEED = 1.0
MAX_SPEED = 1.4
DEFAULT_TIMEOUT_SECONDS = 5.0


class SpeechPacingError(RuntimeError):
    """Static diagnostic only; never includes audio, text or subprocess output."""


def _validated_speed(value: float) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        raise ValueError("VOICE_TTS_SPEED must be a finite number between 1.0 and 1.4") from None
    if isinstance(value, bool) or not math.isfinite(speed) or not MIN_SPEED <= speed <= MAX_SPEED:
        raise ValueError("VOICE_TTS_SPEED must be a finite number between 1.0 and 1.4")
    return speed


def configured_speed() -> float:
    """Read once at provider construction; invalid configuration fails clearly."""
    return _validated_speed(os.getenv("VOICE_TTS_SPEED", str(DEFAULT_SPEED)))


async def _kill_and_reap(process, communication: asyncio.Task | None) -> None:
    if process.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
    # communicate remains alive behind shield while the caller is cancelled,
    # so stdout keeps draining and a full pipe cannot deadlock process.wait().
    if communication is None:
        communication = asyncio.create_task(process.communicate())
    try:
        await asyncio.wait_for(asyncio.shield(communication), timeout=1.0)
    except Exception:
        communication.cancel()
        await asyncio.gather(communication, return_exceptions=True)
        raise SpeechPacingError("Speech tempo subprocess could not be reaped") from None


async def pace_pcm(
    pcm: bytes, *, speed: float | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS, executable: str = "ffmpeg",
) -> bytes:
    """Return tempo-adjusted PCM without changing sample rate or pitch.

    At speed=1.0 return the exact input, without spawning a process. Other
    speeds require FFmpeg's atempo filter. Errors are explicit; callers choose
    their normal failure handling rather than silently speaking at another rate.
    ``executable`` supports an explicitly selected binary in offline tests.
    """
    speed = configured_speed() if speed is None else _validated_speed(speed)
    if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > MAX_PCM_BYTES:
        raise ValueError("Speech pacing requires complete PCM16 for at most 60 seconds")
    if not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 30:
        raise ValueError("Speech pacing timeout must be positive and at most 30 seconds")
    if speed == 1.0:
        return pcm
    process = None
    communication = None
    try:
        async with asyncio.timeout(timeout_seconds):
            process = await asyncio.create_subprocess_exec(
                executable, "-nostdin", "-hide_banner", "-loglevel", "error",
                "-threads", "1", "-filter_threads", "1",
                "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0",
                "-af", f"atempo={speed:.8g}", "-c:a", "pcm_s16le",
                "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            communication = asyncio.create_task(process.communicate(pcm))
            output, _ = await asyncio.shield(communication)
        if process.returncode != 0:
            raise SpeechPacingError("Speech tempo processing failed")
        # atempo can differ slightly around the boundaries; it cannot validly
        # produce more than the bounded original clip plus a small filter tail.
        if not output or len(output) % 2 or len(output) > len(pcm) + SAMPLE_RATE // 5:
            raise SpeechPacingError("Speech tempo returned invalid PCM")
        return output
    except asyncio.CancelledError:
        if process is not None:
            await _kill_and_reap(process, communication)
        raise
    except TimeoutError:
        if process is not None:
            await _kill_and_reap(process, communication)
        raise SpeechPacingError("Speech tempo processing timed out") from None
    except OSError:
        if process is not None:
            await _kill_and_reap(process, communication)
        raise SpeechPacingError("Speech tempo executable is unavailable") from None
