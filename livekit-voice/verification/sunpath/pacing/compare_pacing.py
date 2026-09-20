"""Reproduce the synthetic Neha tempo comparison on CPU; no provider calls."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import time
import wave

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))
from speech_pacing import pace_pcm

TEXTS = {
    "en": "Hello. I can help you check your order status.",
    "hi": "नमस्ते। मैं आपके ऑर्डर की जानकारी दे सकती हूँ।",
    "gu": "નમસ્તે. હું તમારા ઓર્ડરની માહિતી આપી શકું છું.",
    "hinglish": "नमस्ते! मैं आपका order status check कर सकती हूँ।",
}


async def run(args):
    report = {"synthetic_only": True, "no_gpu_or_network": True, "filter": "atempo",
              "speed": args.speed, "silence_trimming": False, "sample_rate": 44100,
              "channels": 1, "sample_width": 2, "clips": []}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for language, text in TEXTS.items():
        source = HERE / f"neha-{language}-before.wav"
        with wave.open(str(source), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (44100, 1, 2):
                raise ValueError("Comparison requires the original 44100 Hz mono PCM16 fixture")
            pcm = wav.readframes(wav.getnframes())
        started = time.perf_counter()
        result = await pace_pcm(pcm, speed=args.speed, executable=args.ffmpeg)
        elapsed = time.perf_counter() - started
        target = args.output_dir / f"neha-{language}-tempo{round(args.speed * 100)}.wav"
        with wave.open(str(target), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            wav.writeframes(result)
        original_seconds, output_seconds = len(pcm) / 88200, len(result) / 88200
        words = len(text.split())
        report["clips"].append({
            "language": language, "synthetic_text": text, "words": words,
            "before_file": source.name, "before_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "after_file": target.name, "after_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "before_seconds": round(original_seconds, 3), "after_seconds": round(output_seconds, 3),
            "before_words_per_min": round(words * 60 / original_seconds, 1),
            "after_words_per_min": round(words * 60 / output_seconds, 1),
            "cpu_processing_ms": round(elapsed * 1000, 1),
        })
    (args.output_dir / "pacing-measurements.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"clips": len(report["clips"]), "speed": args.speed, "output_dir": str(args.output_dir)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--speed", type=float, default=1.2)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--output-dir", type=Path, default=HERE / "reproduced")
    asyncio.run(run(parser.parse_args()))
