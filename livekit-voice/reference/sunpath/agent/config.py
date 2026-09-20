"""Provider selection for the Sun Pathology voicebot (brief section 5).

main.py NEVER imports a provider directly - it asks this module for built
plugin instances, so STT/TTS/LLM are swappable via .env alone.

VERIFIED AGAINST THE LIVE APIS 2026-07-14 (do not "fix" these back):

  * STT model is **chirp_2**, not chirp_3. chirp_3 is WITHDRAWN from general
    availability - it 403s identically for gu-IN, en-US and hi-IN:
        "Permission denied ... on model chirp_3 locale gu-IN.
         It is no longer generally available."
    This is not a Gujarati gap and no IAM role fixes it. The brief's own
    fallback ("fall back to chirp_2 streaming") is what we run.
  * chirp_2 + gu-IN + StreamingRecognize + inline PhraseSet adaptation were all
    confirmed working. chirp_2 is also the ONLY model serving gu-IN here -
    long / short / telephony all reject gu-IN in asia-southeast1.
  * Region MUST be asia-southeast1 (Chirp is not served from asia-south1), and
    regional locations require the regional endpoint - the plugin handles that
    from `location`.
  * TTS "Chirp3-HD" is a DIFFERENT product from STT "chirp_3" and works fine:
    30 gu-IN Chirp3-HD voices exist.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, List

from dotenv import load_dotenv

logger = logging.getLogger("sunpath.config")

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"

# MUST run before the module-level os.environ reads below - pm2 does NOT load
# .env files, so without this the worker starts with an empty environment and
# dies with "ws_url is required, or set LIVEKIT_URL environment variable".
# Explicit path: pm2's cwd is not guaranteed to be the project root.
load_dotenv(ROOT / ".env")

# --- env ------------------------------------------------------------------

STT_PROVIDER = os.environ.get("STT_PROVIDER", "google").strip().lower()
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "google").strip().lower()
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "google").strip().lower()

# Backup voice for when the primary TTS fails. edge|none, default edge - see
# build_tts(). Default-ON is deliberate: a fallback nobody remembered to enable is
# not a fallback, and the failure it covers (silence) is the worst state this
# demo has.
TTS_FALLBACK = os.environ.get("TTS_FALLBACK", "edge").strip().lower()

LANGUAGE = os.environ.get("LANGUAGE", "gu-IN").strip()
STT_MODEL = os.environ.get("STT_MODEL", "chirp_2").strip()
STT_LOCATION = os.environ.get("STT_LOCATION", "asia-southeast1").strip()
TTS_VOICE = os.environ.get("TTS_VOICE", "gu-IN-Chirp3-HD-Achernar").strip()
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-2.5-flash").strip()
LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.2"))

# Vertex ON by default - the AI-Studio key is free-tier and 429s mid-call (see
# build_llm). Set LLM_USE_VERTEX=0 only to debug.
LLM_USE_VERTEX = os.environ.get("LLM_USE_VERTEX", "1").strip().lower() in ("1", "true", "yes")
VERTEX_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip() or None
# asia-south1 = Mumbai, nearest to Ahmedabad; verified serving gemini-2.5-flash.
VERTEX_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "asia-south1").strip()

# 0 disables Gemini 2.5 "thinking" - worth 677ms/52% of TTFT here (see build_llm
# for the measurement). Set LLM_THINKING_BUDGET=-1 to leave Google's default
# (thinking ON) if a future task ever needs deliberation over speed.
_raw_think = os.environ.get("LLM_THINKING_BUDGET", "0").strip()
LLM_THINKING_BUDGET = None if _raw_think in ("", "-1", "default") else int(_raw_think)

GOOGLE_APPLICATION_CREDENTIALS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "").strip()

# Owner doc section 16 is a "strict Sun Pathology rule": quote MRP first, THEN the
# discounted price. The build brief section 3.1 said the opposite (discount only).
# The owner's own manual wins - it calls itself the single source of truth and the
# demo audience wrote it. Flip to "discount_only" here to follow the brief instead.
PRICE_QUOTE_STYLE = os.environ.get("PRICE_QUOTE_STYLE", "mrp_then_discount").strip()

BOOST = float(os.environ.get("STT_PHRASE_BOOST", "12"))
# Google caps inline adaptation; keep well under it. 316 tests + 61 packages
# ~= 377 short phrases, comfortably inside one request.
MAX_PHRASES = int(os.environ.get("STT_MAX_PHRASES", "1000"))


def _load(name: str) -> Any:
    p = KNOWLEDGE / name
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def phrase_hints() -> List[str]:
    """Every test + package name (+ alias surface forms) for speech adaptation.

    This is the accuracy core: without it, chirp_2 mis-hears Gujarati-accented
    English test names ("Widal", "HbA1c", "Torch Complex"). Deduped, longest
    first, capped at MAX_PHRASES.
    """
    out: List[str] = []
    for t in _load("tests.json"):
        if isinstance(t, dict) and t.get("name"):
            out.append(str(t["name"]))
    for p in _load("packages.json"):
        if isinstance(p, dict) and p.get("name"):
            out.append(str(p["name"]))
    aliases = _load("aliases.json")
    if isinstance(aliases, dict):
        for entry in aliases.get("aliases", []):
            for m in entry.get("match", []):
                # Roman/English surface forms help the recogniser; Gujarati-script
                # aliases are for text matching in lookup_item, not for boosting.
                if m and m.isascii() and len(m) > 2:
                    out.append(str(m))
    seen, uniq = set(), []
    for s in sorted(out, key=len, reverse=True):
        k = s.strip().lower()
        if k and k not in seen:
            seen.add(k)
            uniq.append(s.strip())
    return uniq[:MAX_PHRASES]


# --- builders -------------------------------------------------------------


def build_stt():
    if STT_PROVIDER == "google":
        from google.cloud.speech_v2.types import cloud_speech
        from livekit.plugins import google as lk_google

        adaptation = cloud_speech.SpeechAdaptation(
            phrase_sets=[
                cloud_speech.SpeechAdaptation.AdaptationPhraseSet(
                    inline_phrase_set=cloud_speech.PhraseSet(
                        phrases=[
                            cloud_speech.PhraseSet.Phrase(value=p, boost=BOOST)
                            for p in phrase_hints()
                        ]
                    )
                )
            ]
        )
        return lk_google.STT(
            languages=LANGUAGE,
            model=STT_MODEL,
            location=STT_LOCATION,
            adaptation=adaptation,
            credentials_file=GOOGLE_APPLICATION_CREDENTIALS or None,
            # Gujarati callers code-switch into English test names constantly;
            # leave detection on so "TSH" inside a Gujarati sentence still lands.
            detect_language=True,
            interim_results=True,
            punctuate=True,
        )
    if STT_PROVIDER == "sarvam":
        from .providers_sarvam import SarvamSTT  # thin adapter, brief section 5

        return SarvamSTT(language=LANGUAGE)
    raise ValueError(f"Unknown STT_PROVIDER={STT_PROVIDER!r} (expected google|sarvam)")


def _build_primary_tts():
    """The configured TTS, with no fallback wrapping. build_tts() is what main.py calls."""
    if TTS_PROVIDER == "google":
        from livekit.plugins import google as lk_google

        return lk_google.TTS(
            language=LANGUAGE,
            voice_name=TTS_VOICE,
            credentials_file=GOOGLE_APPLICATION_CREDENTIALS or None,
        )
    if TTS_PROVIDER == "sarvam":
        from .providers_sarvam import SarvamTTS

        return SarvamTTS(language=LANGUAGE)
    if TTS_PROVIDER == "edge":
        # edge-tts as the PRIMARY. Not the default - it is an unofficial consumer
        # endpoint with no SLA and no credentials - but it makes the demo runnable
        # with zero Google setup, which is worth having on a laptop.
        from .providers_fallback import build_edge_tts

        return build_edge_tts(language=LANGUAGE)
    raise ValueError(f"Unknown TTS_PROVIDER={TTS_PROVIDER!r} (expected google|sarvam|edge)")


def build_tts():
    """Primary TTS, wrapped in a fallback voice unless TTS_FALLBACK=none.

    Owner, 2026-07-14: "if stt,tts fails, keep a fallback of device based -
    browserapi, edgetts". A TTS failure is the one failure main.py's error handler
    cannot talk its way out of - FALLBACK_LINE is itself spoken through TTS - so
    without this a dead Chirp3-HD is a silent call, which reads to the caller as a
    dropped line.

    The wrapping is livekit-agents' own tts.FallbackAdapter (see
    providers_fallback for why it beats a hand-rolled try/except). main.py is
    unchanged and still just calls build_tts(): it does not know that a fallback
    exists, let alone who the vendors are.

    TTS_FALLBACK=edge (default) | none. `none` is the escape hatch for debugging a
    primary-only path - it means a TTS outage is silence, so do not ship it.
    """
    primary = _build_primary_tts()

    if TTS_FALLBACK == "none":
        logger.warning("TTS fallback DISABLED (TTS_FALLBACK=none) - a TTS outage will be silence")
        return primary

    if TTS_FALLBACK != "edge":
        raise ValueError(f"Unknown TTS_FALLBACK={TTS_FALLBACK!r} (expected edge|none)")

    # Pointless to fall back from edge to edge - same provider, same failure.
    if TTS_PROVIDER == "edge":
        return primary

    try:
        from .providers_fallback import build_edge_tts, build_fallback_tts

        backup = build_edge_tts(language=LANGUAGE)
    except Exception:  # noqa: BLE001
        # A broken BACKUP must never take down a working PRIMARY. Degrade to the
        # primary alone and say so loudly in the log.
        logger.exception("tts_fallback_build_failed - running PRIMARY ONLY, no backup voice")
        return primary

    logger.info("tts: primary=%s + fallback=%s", TTS_PROVIDER, backup.label)
    return build_fallback_tts(primary, backup)


def build_llm():
    """Gemini via VERTEX by default - this is not a preference, it is the fix.

    The AI-Studio api_key path is FREE TIER (~20 requests/day) and 429s mid-call:
        ClientError: 429 Too Many Requests
        APIConnectionError: failed to generate LLM completion after 4 attempts
    When that happens the model never returns, so the agent goes SILENT and the
    caller just watches "thinking" forever - which is exactly what happened on
    the first live test of this demo, and what previously hit the MyScanHub
    agent (its fix was the same: route to Vertex, commit 5e14c11).

    Vertex is billed with real quotas and authenticates with the SAME service
    account already used for STT/TTS. The two auth modes are mutually exclusive:
    when vertexai=True we MUST NOT pass api_key.

    Region note: Chirp STT has to run in asia-southeast1, but Vertex serves
    gemini-2.5-flash from asia-south1 (Mumbai) - verified - which is the closest
    region to Ahmedabad and shaves latency off the voice-to-voice budget.
    """
    if LLM_PROVIDER == "google":
        from livekit.plugins import google as lk_google

        if LLM_USE_VERTEX:
            kwargs: dict[str, Any] = {
                "model": LLM_MODEL,
                "temperature": LLM_TEMPERATURE,
                "vertexai": True,
                "location": VERTEX_LOCATION,
            }
            if VERTEX_PROJECT:
                kwargs["project"] = VERTEX_PROJECT
            if LLM_THINKING_BUDGET is not None:
                # THE latency lever. Gemini 2.5 Flash enables "thinking" by
                # DEFAULT, and on this workload it is dead air: measured on the
                # real system prompt + tools, asia-south1, 5 questions -
                #   thinking ON  : median 1290ms TTFT
                #   thinking OFF : median  613ms TTFT   -> 677ms / 52% faster
                # The model was spending ~0.7s reasoning about "what are your
                # timings?", which a caller experiences as the line going dead.
                # This job is read-a-fact + call-a-tool; it does not need
                # chain-of-thought, and temperature 0.2 + a strict prompt + a
                # tool-only pricing rule are what keep it correct - not thinking.
                # (For contrast: explicit prompt caching bought 0ms - it cuts
                # cost ~75%, not latency. See README.)
                from google.genai import types as genai_types

                kwargs["thinking_config"] = genai_types.ThinkingConfig(
                    thinking_budget=LLM_THINKING_BUDGET
                )
            return lk_google.LLM(**kwargs)

        # Escape hatch only. Expect 429s on a free-tier key.
        return lk_google.LLM(
            model=LLM_MODEL,
            api_key=GOOGLE_API_KEY or None,
            temperature=LLM_TEMPERATURE,
        )
    raise ValueError(f"Unknown LLM_PROVIDER={LLM_PROVIDER!r}")


def build_vad():
    from livekit.plugins import silero

    return silero.VAD.load()
