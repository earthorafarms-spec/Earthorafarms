"""
SchXl-Mntr LiveKit Agent.

Voice AI mentor agent with:
- Deepgram STT (nova-3)
- OpenAI GPT-4.1 LLM with dynamic tool calling
- Google Cloud TTS (en-IN Chirp3 HD voice)
- Ditto avatar video generation (optional, via avatar framework)
- Tool forwarding to frontend via RPC
- Text input support
"""

import asyncio
import aiohttp
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from google.cloud import texttospeech
from loguru import logger
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    StopResponse,
    cli,
    function_tool,
    get_job_context,
)
from livekit.agents.voice import RunContext
from livekit.agents.voice import room_io
from livekit.plugins import openai, deepgram, google, silero, noise_cancellation
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from services.ditto_avatar import DittoAvatarSession
from services.tavus_avatar import TavusAvatarSession
from services.hedra_avatar import BeyAvatarSession
from services.vision_service import get_vision_service
from services.camera_vision import get_camera_vision_service

_DIR = Path(__file__).parent
load_dotenv(dotenv_path=_DIR / ".env")

# Resolve Google credentials from env (relative paths resolved against agent dir)
_raw_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "google/symbolic-heaven-459106-v1-419c2e3dbb01.json")
_GOOGLE_CREDS = str((_DIR / _raw_creds).resolve()) if not os.path.isabs(_raw_creds) else _raw_creds

# Ditto defaults from env
_DITTO_API_URL = os.getenv("DITTO_API_URL", "https://2wahi9gm7dfpgg-8181.proxy.runpod.net")
_DITTO_AVATAR_ID = os.getenv("DITTO_AVATAR_ID", "imogen")
_DITTO_API_KEY = os.getenv("DITTO_API_KEY", "")

# BL-1 (2026-06-15) — child-safety gate. Every spoken turn is screened by the
# backend safety service (CrisisDetector + ContentSafetyService) BEFORE it
# reaches the LLM. Service-to-service via a shared secret (the agent has no user
# bearer token); user_id comes from the room metadata.
# POSTURE (see on_user_turn_completed): a clean backend verdict is honoured — a
# genuine block cancels the LLM reply. If the backend is UNREACHABLE (timeout /
# non-200 / non-JSON) the gate DEGRADES rather than bricking all voice: a local
# high-precision self-harm floor (EN/HI/GU) still blocks an unambiguous crisis
# utterance with a caring + Tele-MANAS 14416 message, but ordinary academic
# turns are allowed through. So the outage posture is fail-open-with-a-crisis-
# floor, NOT fail-closed. (The backend itself fails CLOSED on its own internal
# exception — see VoiceAssistantV2Controller::voiceSafetyCheck. Do NOT "restore"
# true fail-closed here: commit d7cc9072 removed it precisely because a backend
# 404 was blocking every turn and silencing all student voice.)
_SAFETY_BACKEND = os.getenv("BACKEND_URL", "https://core.schoolexl.in").rstrip("/")
_SAFETY_URL = f"{_SAFETY_BACKEND}/api/v2/internal/voice-safety-check"
_SAFETY_SECRET = os.getenv("VOICE_SAFETY_SECRET", "")
_SAFETY_FALLBACK = (
    "I can't help with that. If you're studying, try rephrasing your question — "
    "and if something is wrong, please talk to a trusted adult."
)

# Caring crisis message used when the local degraded-mode floor catches an
# unambiguous self-harm/crisis utterance (backend unreachable). Mirrors the
# backend's self-harm response so a child in crisis still gets help + a helpline
# even during a safety-backend outage.
_SAFETY_CRISIS_FALLBACK = (
    "I'm really glad you told me, and I care about how you're feeling. "
    "You're not alone, and you matter. Please talk to a trusted adult right "
    "now — a parent, your teacher, or your school counsellor — they want to "
    "help. You can also call India's free, confidential Tele-MANAS helpline "
    "any time on 14416 (or 1-800-891-4416). If you feel you might be in "
    "danger right now, please tell an adult near you immediately."
)

# Degraded-mode local crisis floor — high-precision self-harm/suicide phrases
# in English + Hindi + Gujarati (native script + common transliteration).
# ONLY consulted when the backend safety service is unreachable, so a backend
# blip never silences all voice while an unambiguous crisis utterance is still
# caught. Kept deliberately high-precision (multi-word phrases, not single
# ambiguous words like "die"/"kill") to avoid blocking academic content.
_LOCAL_CRISIS_KEYWORDS = (
    # English
    "kill myself", "kill my self", "killing myself", "end my life",
    "ending my life", "want to die", "wanna die", "suicide", "suicidal",
    "hurt myself", "harm myself", "cut myself", "cutting myself",
    "don't want to live", "do not want to live", "dont want to live",
    "no reason to live", "better off dead", "end it all",
    # Hindi — Devanagari
    "खुदकुशी", "आत्महत्या", "मरना चाहता", "मरना चाहती", "जीना नहीं चाहता",
    "जीना नहीं चाहती", "खुद को मार", "मर जाऊं", "मर जाऊँ",
    # Hindi — transliteration
    "khudkushi", "aatmahatya", "atmahatya", "marna chahta", "marna chahti",
    "jeena nahi chahta", "jeene ka man nahi",
    # Gujarati — script
    "આપઘાત", "આત્મહત્યા", "મરી જવું છે", "જીવવું નથી", "મરી જઉં",
    # Gujarati — transliteration
    "aapghat", "aatmaghat",
)


def _local_crisis_match(text: str) -> bool:
    """True only for an unambiguous self-harm/crisis utterance. Used as the
    degraded-mode floor when the backend safety service is unreachable."""
    low = (text or "").lower()
    return any(kw in low for kw in _LOCAL_CRISIS_KEYWORDS)


# Google Chirp3 HD voice map: BCP-47 language code → {gender: (voice_name, lang_code)}
# Female voices: Aoede, Callirrhoe, Despina, Erinome, Kore, Laomedeia, Leda,
#   Puck, Pulcherrima, Sulafat, Vindemiatrix, Zephyr, Autonoe, Gacrux (varies by lang)
# Male voices: Achernar, Achird, Algenib, Algieba, Alnilam, Charon, Enceladus,
#   Fenrir, Iapetus, Orus, Rasalgethi, Sadachbia, Sadaltager, Schedar, Umbriel
_CHIRP3_VOICES: dict[str, dict[str, tuple[str, str]]] = {
    "en":    {"female": ("en-IN-Chirp3-HD-Despina",      "en-IN"),  "male": ("en-IN-Chirp3-HD-Charon",       "en-IN")},
    "en-IN": {"female": ("en-IN-Chirp3-HD-Despina",      "en-IN"),  "male": ("en-IN-Chirp3-HD-Charon",       "en-IN")},
    "en-US": {"female": ("en-US-Chirp3-HD-Puck",         "en-US"),  "male": ("en-US-Chirp3-HD-Fenrir",       "en-US")},
    "en-GB": {"female": ("en-GB-Chirp3-HD-Aoede",        "en-GB"),  "male": ("en-GB-Chirp3-HD-Charon",       "en-GB")},
    "en-AU": {"female": ("en-AU-Chirp3-HD-Zephyr",       "en-AU"),  "male": ("en-AU-Chirp3-HD-Fenrir",       "en-AU")},
    "hi":    {"female": ("hi-IN-Chirp3-HD-Leda",         "hi-IN"),  "male": ("hi-IN-Chirp3-HD-Orus",         "hi-IN")},
    "hi-IN": {"female": ("hi-IN-Chirp3-HD-Leda",         "hi-IN"),  "male": ("hi-IN-Chirp3-HD-Orus",         "hi-IN")},
    "fr":    {"female": ("fr-FR-Chirp3-HD-Kore",         "fr-FR"),  "male": ("fr-FR-Chirp3-HD-Orus",         "fr-FR")},
    "fr-FR": {"female": ("fr-FR-Chirp3-HD-Kore",         "fr-FR"),  "male": ("fr-FR-Chirp3-HD-Orus",         "fr-FR")},
    "fr-CA": {"female": ("fr-CA-Chirp3-HD-Aoede",        "fr-CA"),  "male": ("fr-CA-Chirp3-HD-Charon",       "fr-CA")},
    "de":    {"female": ("de-DE-Chirp3-HD-Aoede",        "de-DE"),  "male": ("de-DE-Chirp3-HD-Orus",         "de-DE")},
    "de-DE": {"female": ("de-DE-Chirp3-HD-Aoede",        "de-DE"),  "male": ("de-DE-Chirp3-HD-Orus",         "de-DE")},
    "es":    {"female": ("es-ES-Chirp3-HD-Zephyr",       "es-ES"),  "male": ("es-ES-Chirp3-HD-Fenrir",       "es-ES")},
    "es-ES": {"female": ("es-ES-Chirp3-HD-Zephyr",       "es-ES"),  "male": ("es-ES-Chirp3-HD-Fenrir",       "es-ES")},
    "es-US": {"female": ("es-US-Chirp3-HD-Leda",         "es-US"),  "male": ("es-US-Chirp3-HD-Fenrir",       "es-US")},
    "pt":    {"female": ("pt-BR-Chirp3-HD-Aoede",        "pt-BR"),  "male": ("pt-BR-Chirp3-HD-Orus",         "pt-BR")},
    "pt-BR": {"female": ("pt-BR-Chirp3-HD-Aoede",        "pt-BR"),  "male": ("pt-BR-Chirp3-HD-Orus",         "pt-BR")},
    "pt-PT": {"female": ("pt-PT-Chirp3-HD-Leda",         "pt-PT"),  "male": ("pt-PT-Chirp3-HD-Charon",       "pt-PT")},
    "ar":    {"female": ("ar-XA-Chirp3-HD-Zephyr",       "ar-XA"),  "male": ("ar-XA-Chirp3-HD-Rasalgethi",  "ar-XA")},
    "ar-XA": {"female": ("ar-XA-Chirp3-HD-Zephyr",       "ar-XA"),  "male": ("ar-XA-Chirp3-HD-Rasalgethi",  "ar-XA")},
    "ja":    {"female": ("ja-JP-Chirp3-HD-Autonoe",      "ja-JP"),  "male": ("ja-JP-Chirp3-HD-Fenrir",       "ja-JP")},
    "ja-JP": {"female": ("ja-JP-Chirp3-HD-Autonoe",      "ja-JP"),  "male": ("ja-JP-Chirp3-HD-Fenrir",       "ja-JP")},
    "ko":    {"female": ("ko-KR-Chirp3-HD-Aoede",        "ko-KR"),  "male": ("ko-KR-Chirp3-HD-Iapetus",      "ko-KR")},
    "ko-KR": {"female": ("ko-KR-Chirp3-HD-Aoede",        "ko-KR"),  "male": ("ko-KR-Chirp3-HD-Iapetus",      "ko-KR")},
    "zh":    {"female": ("cmn-CN-Chirp3-HD-Aoede",       "cmn-CN"), "male": ("cmn-CN-Chirp3-HD-Gacrux",      "cmn-CN")},
    "zh-CN": {"female": ("cmn-CN-Chirp3-HD-Aoede",       "cmn-CN"), "male": ("cmn-CN-Chirp3-HD-Gacrux",      "cmn-CN")},
    "zh-TW": {"female": ("cmn-TW-Chirp3-HD-Leda",        "cmn-TW"), "male": ("cmn-TW-Chirp3-HD-Umbriel",     "cmn-TW")},
    "it":    {"female": ("it-IT-Chirp3-HD-Aoede",        "it-IT"),  "male": ("it-IT-Chirp3-HD-Orus",         "it-IT")},
    "it-IT": {"female": ("it-IT-Chirp3-HD-Aoede",        "it-IT"),  "male": ("it-IT-Chirp3-HD-Orus",         "it-IT")},
    "nl":    {"female": ("nl-NL-Chirp3-HD-Aoede",        "nl-NL"),  "male": ("nl-NL-Chirp3-HD-Charon",       "nl-NL")},
    "nl-NL": {"female": ("nl-NL-Chirp3-HD-Aoede",        "nl-NL"),  "male": ("nl-NL-Chirp3-HD-Charon",       "nl-NL")},
    "nl-BE": {"female": ("nl-BE-Chirp3-HD-Laomedeia",    "nl-BE"),  "male": ("nl-BE-Chirp3-HD-Fenrir",       "nl-BE")},
    "pl":    {"female": ("pl-PL-Chirp3-HD-Erinome",      "pl-PL"),  "male": ("pl-PL-Chirp3-HD-Orus",         "pl-PL")},
    "pl-PL": {"female": ("pl-PL-Chirp3-HD-Erinome",      "pl-PL"),  "male": ("pl-PL-Chirp3-HD-Orus",         "pl-PL")},
    "ru":    {"female": ("ru-RU-Chirp3-HD-Callirrhoe",   "ru-RU"),  "male": ("ru-RU-Chirp3-HD-Fenrir",       "ru-RU")},
    "ru-RU": {"female": ("ru-RU-Chirp3-HD-Callirrhoe",   "ru-RU"),  "male": ("ru-RU-Chirp3-HD-Fenrir",       "ru-RU")},
    "tr":    {"female": ("tr-TR-Chirp3-HD-Aoede",        "tr-TR"),  "male": ("tr-TR-Chirp3-HD-Achird",       "tr-TR")},
    "tr-TR": {"female": ("tr-TR-Chirp3-HD-Aoede",        "tr-TR"),  "male": ("tr-TR-Chirp3-HD-Achird",       "tr-TR")},
    "sv":    {"female": ("sv-SE-Chirp3-HD-Aoede",        "sv-SE"),  "male": ("sv-SE-Chirp3-HD-Charon",       "sv-SE")},
    "sv-SE": {"female": ("sv-SE-Chirp3-HD-Aoede",        "sv-SE"),  "male": ("sv-SE-Chirp3-HD-Charon",       "sv-SE")},
    "da":    {"female": ("da-DK-Chirp3-HD-Aoede",        "da-DK"),  "male": ("da-DK-Chirp3-HD-Orus",         "da-DK")},
    "da-DK": {"female": ("da-DK-Chirp3-HD-Aoede",        "da-DK"),  "male": ("da-DK-Chirp3-HD-Orus",         "da-DK")},
    "fi":    {"female": ("fi-FI-Chirp3-HD-Aoede",        "fi-FI"),  "male": ("fi-FI-Chirp3-HD-Charon",       "fi-FI")},
    "fi-FI": {"female": ("fi-FI-Chirp3-HD-Aoede",        "fi-FI"),  "male": ("fi-FI-Chirp3-HD-Charon",       "fi-FI")},
    "cs":    {"female": ("cs-CZ-Chirp3-HD-Aoede",        "cs-CZ"),  "male": ("cs-CZ-Chirp3-HD-Algenib",      "cs-CZ")},
    "cs-CZ": {"female": ("cs-CZ-Chirp3-HD-Aoede",        "cs-CZ"),  "male": ("cs-CZ-Chirp3-HD-Algenib",      "cs-CZ")},
    "bg":    {"female": ("bg-BG-Chirp3-HD-Aoede",        "bg-BG"),  "male": ("bg-BG-Chirp3-HD-Enceladus",    "bg-BG")},
    "bg-BG": {"female": ("bg-BG-Chirp3-HD-Aoede",        "bg-BG"),  "male": ("bg-BG-Chirp3-HD-Enceladus",    "bg-BG")},
    "et":    {"female": ("et-EE-Chirp3-HD-Aoede",        "et-EE"),  "male": ("et-EE-Chirp3-HD-Charon",       "et-EE")},
    "et-EE": {"female": ("et-EE-Chirp3-HD-Aoede",        "et-EE"),  "male": ("et-EE-Chirp3-HD-Charon",       "et-EE")},
    "hr":    {"female": ("hr-HR-Chirp3-HD-Aoede",        "hr-HR"),  "male": ("hr-HR-Chirp3-HD-Fenrir",       "hr-HR")},
    "hr-HR": {"female": ("hr-HR-Chirp3-HD-Aoede",        "hr-HR"),  "male": ("hr-HR-Chirp3-HD-Fenrir",       "hr-HR")},
    "id":    {"female": ("id-ID-Chirp3-HD-Aoede",        "id-ID"),  "male": ("id-ID-Chirp3-HD-Orus",         "id-ID")},
    "id-ID": {"female": ("id-ID-Chirp3-HD-Aoede",        "id-ID"),  "male": ("id-ID-Chirp3-HD-Orus",         "id-ID")},
    "ms":    {"female": ("ms-MY-Chirp3-HD-Aoede",        "ms-MY"),  "male": ("ms-MY-Chirp3-HD-Fenrir",       "ms-MY")},
    "ms-MY": {"female": ("ms-MY-Chirp3-HD-Aoede",        "ms-MY"),  "male": ("ms-MY-Chirp3-HD-Fenrir",       "ms-MY")},
    "th":    {"female": ("th-TH-Chirp3-HD-Aoede",        "th-TH"),  "male": ("th-TH-Chirp3-HD-Orus",         "th-TH")},
    "th-TH": {"female": ("th-TH-Chirp3-HD-Aoede",        "th-TH"),  "male": ("th-TH-Chirp3-HD-Orus",         "th-TH")},
    "vi":    {"female": ("vi-VN-Chirp3-HD-Aoede",        "vi-VN"),  "male": ("vi-VN-Chirp3-HD-Fenrir",       "vi-VN")},
    "vi-VN": {"female": ("vi-VN-Chirp3-HD-Aoede",        "vi-VN"),  "male": ("vi-VN-Chirp3-HD-Fenrir",       "vi-VN")},
    "uk":    {"female": ("uk-UA-Chirp3-HD-Aoede",        "uk-UA"),  "male": ("uk-UA-Chirp3-HD-Charon",       "uk-UA")},
    "uk-UA": {"female": ("uk-UA-Chirp3-HD-Aoede",        "uk-UA"),  "male": ("uk-UA-Chirp3-HD-Charon",       "uk-UA")},
    "bn":    {"female": ("bn-IN-Chirp3-HD-Aoede",        "bn-IN"),  "male": ("bn-IN-Chirp3-HD-Orus",         "bn-IN")},
    "bn-IN": {"female": ("bn-IN-Chirp3-HD-Aoede",        "bn-IN"),  "male": ("bn-IN-Chirp3-HD-Orus",         "bn-IN")},
    "ta":    {"female": ("ta-IN-Chirp3-HD-Aoede",        "ta-IN"),  "male": ("ta-IN-Chirp3-HD-Orus",         "ta-IN")},
    "ta-IN": {"female": ("ta-IN-Chirp3-HD-Aoede",        "ta-IN"),  "male": ("ta-IN-Chirp3-HD-Orus",         "ta-IN")},
    "te":    {"female": ("te-IN-Chirp3-HD-Aoede",        "te-IN"),  "male": ("te-IN-Chirp3-HD-Orus",         "te-IN")},
    "te-IN": {"female": ("te-IN-Chirp3-HD-Aoede",        "te-IN"),  "male": ("te-IN-Chirp3-HD-Orus",         "te-IN")},
    "mr":    {"female": ("mr-IN-Chirp3-HD-Aoede",        "mr-IN"),  "male": ("mr-IN-Chirp3-HD-Iapetus",      "mr-IN")},
    "mr-IN": {"female": ("mr-IN-Chirp3-HD-Aoede",        "mr-IN"),  "male": ("mr-IN-Chirp3-HD-Iapetus",      "mr-IN")},
    "gu":    {"female": ("gu-IN-Chirp3-HD-Aoede",        "gu-IN"),  "male": ("gu-IN-Chirp3-HD-Orus",         "gu-IN")},
    "gu-IN": {"female": ("gu-IN-Chirp3-HD-Aoede",        "gu-IN"),  "male": ("gu-IN-Chirp3-HD-Orus",         "gu-IN")},
    "kn":    {"female": ("kn-IN-Chirp3-HD-Aoede",        "kn-IN"),  "male": ("kn-IN-Chirp3-HD-Rasalgethi",  "kn-IN")},
    "kn-IN": {"female": ("kn-IN-Chirp3-HD-Aoede",        "kn-IN"),  "male": ("kn-IN-Chirp3-HD-Rasalgethi",  "kn-IN")},
    "ml":    {"female": ("ml-IN-Chirp3-HD-Aoede",        "ml-IN"),  "male": ("ml-IN-Chirp3-HD-Charon",       "ml-IN")},
    "ml-IN": {"female": ("ml-IN-Chirp3-HD-Aoede",        "ml-IN"),  "male": ("ml-IN-Chirp3-HD-Charon",       "ml-IN")},
    "pa":    {"female": ("pa-IN-Chirp3-HD-Leda",         "pa-IN"),  "male": ("pa-IN-Chirp3-HD-Orus",         "pa-IN")},
    "pa-IN": {"female": ("pa-IN-Chirp3-HD-Leda",         "pa-IN"),  "male": ("pa-IN-Chirp3-HD-Orus",         "pa-IN")},
    "ur":    {"female": ("ur-IN-Chirp3-HD-Aoede",        "ur-IN"),  "male": ("ur-IN-Chirp3-HD-Charon",       "ur-IN")},
    "ur-IN": {"female": ("ur-IN-Chirp3-HD-Aoede",        "ur-IN"),  "male": ("ur-IN-Chirp3-HD-Charon",       "ur-IN")},
    "yue":    {"female": ("yue-HK-Chirp3-HD-Aoede",      "yue-HK"), "male": ("yue-HK-Chirp3-HD-Orus",        "yue-HK")},
    "yue-HK": {"female": ("yue-HK-Chirp3-HD-Aoede",      "yue-HK"), "male": ("yue-HK-Chirp3-HD-Orus",        "yue-HK")},
}

_DEFAULT_TTS = {"female": ("en-IN-Chirp3-HD-Despina", "en-IN"), "male": ("en-IN-Chirp3-HD-Charon", "en-IN")}


# Human-readable language names for LLM instructions
_LANG_NAMES: dict[str, str] = {
    "en": "English", "en-IN": "English", "en-US": "English", "en-GB": "English", "en-AU": "English",
    "hi": "Hindi", "hi-IN": "Hindi",
    "te": "Telugu", "te-IN": "Telugu",
    "ta": "Tamil", "ta-IN": "Tamil",
    "ml": "Malayalam", "ml-IN": "Malayalam",
    "kn": "Kannada", "kn-IN": "Kannada",
    "gu": "Gujarati", "gu-IN": "Gujarati",
    "mr": "Marathi", "mr-IN": "Marathi",
    "bn": "Bengali", "bn-IN": "Bengali",
    "pa": "Punjabi", "pa-IN": "Punjabi",
    "ur": "Urdu", "ur-IN": "Urdu",
    "fr": "French", "fr-FR": "French", "fr-CA": "French",
    "de": "German", "de-DE": "German",
    "es": "Spanish", "es-ES": "Spanish", "es-US": "Spanish",
    "pt": "Portuguese", "pt-BR": "Portuguese", "pt-PT": "Portuguese",
    "ar": "Arabic", "ar-XA": "Arabic",
    "ja": "Japanese", "ja-JP": "Japanese",
    "ko": "Korean", "ko-KR": "Korean",
    "zh": "Chinese", "zh-CN": "Chinese", "zh-TW": "Chinese",
    "it": "Italian", "it-IT": "Italian",
    "nl": "Dutch", "nl-NL": "Dutch",
    "ru": "Russian", "ru-RU": "Russian",
    "tr": "Turkish", "tr-TR": "Turkish",
    "vi": "Vietnamese", "vi-VN": "Vietnamese",
    "th": "Thai", "th-TH": "Thai",
    "id": "Indonesian", "id-ID": "Indonesian",
    "ms": "Malay", "ms-MY": "Malay",
    "uk": "Ukrainian", "uk-UA": "Ukrainian",
    "pl": "Polish", "pl-PL": "Polish",
    "sv": "Swedish", "sv-SE": "Swedish",
    "da": "Danish", "da-DK": "Danish",
    "fi": "Finnish", "fi-FI": "Finnish",
    "cs": "Czech", "cs-CZ": "Czech",
    "bg": "Bulgarian", "bg-BG": "Bulgarian",
    "hr": "Croatian", "hr-HR": "Croatian",
    "et": "Estonian", "et-EE": "Estonian",
}


def _get_lang_name(language: str | None) -> str:
    """Return human-readable language name from a BCP-47 code."""
    if not language:
        return "English"
    lang = language.strip()
    if lang in _LANG_NAMES:
        return _LANG_NAMES[lang]
    base = lang.split("-")[0]
    return _LANG_NAMES.get(base, "English")


# MIRROR MODE (2026-08-01) — which language did the student just use?
#
# Deliberately deterministic, not a model call: it runs on EVERY user turn and
# must be free and instant. Script dominance settles Devanagari outright; the
# hard case is ROMANISED Hindi ("mujhe samajh nahi aaya"), which is Latin script
# and so indistinguishable from English by script alone — hence the function-word
# list. Those words are function words on purpose: they appear in ordinary Hindi
# speech and essentially never inside an English sentence about schoolwork.
_DEVANAGARI = (0x0900, 0x097F)
_HINDI_ROMAN_MARKERS = {
    "hai", "hain", "nahi", "nahin", "kya", "kyun", "kyu", "mujhe", "mera", "meri",
    "aap", "aapko", "tum", "hum", "karo", "karna", "kaise", "kaisa", "batao",
    "bata", "samajh", "samjha", "acha", "accha", "thik", "theek", "matlab",
    "lekin", "phir", "abhi", "bohot", "bahut", "thoda", "sab", "yeh", "woh",
}


def _detect_turn_language(text: str) -> str | None:
    """Return 'hi', 'en', or None when the turn is too short to judge.

    None is important: a two-word turn must NOT move the session. The caller
    applies hysteresis on top of this.
    """
    if not text:
        return None
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 4:
        return None
    dev = sum(1 for c in letters if _DEVANAGARI[0] <= ord(c) <= _DEVANAGARI[1])
    # A single Devanagari word inside an English sentence should not flip the
    # session; require real dominance.
    if dev / len(letters) > 0.30:
        return "hi"
    words = [w.strip(".,!?;:\u0964").lower() for w in text.split()]
    if len(words) < 3:
        return None
    hits = sum(1 for w in words if w in _HINDI_ROMAN_MARKERS)
    if hits >= 2 or (hits == 1 and len(words) <= 6):
        return "hi"
    if dev == 0:
        return "en"
    return None


def _resolve_tts_voice(language: str | None, gender: str = "female") -> tuple[str, str]:
    """Return (voice_name, lang_code) for the given BCP-47 language tag and gender.

    Tries exact match first, then base language, then falls back to default.

    Supports direct voice override via ``voice:<voice_name>`` in *gender*,
    e.g. ``gender="voice:en-IN-Chirp3-HD-Aoede"`` bypasses the lookup.
    """
    # Direct voice override: "voice:en-IN-Chirp3-HD-Aoede" → use as-is
    if gender.startswith("voice:"):
        voice_name = gender[6:]  # strip "voice:" prefix
        # Extract lang code from voice name (e.g. en-IN from en-IN-Chirp3-HD-Aoede)
        parts = voice_name.split("-")
        lang_code = f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else "en-IN"
        return (voice_name, lang_code)

    g = gender if gender in ("female", "male") else "female"
    if not language:
        return _DEFAULT_TTS[g]
    lang = language.strip()
    if lang in _CHIRP3_VOICES:
        return _CHIRP3_VOICES[lang][g]
    # Try base language (e.g. "en" from "en-US")
    base = lang.split("-")[0]
    if base in _CHIRP3_VOICES:
        return _CHIRP3_VOICES[base][g]
    logger.warning(f"No Chirp3 HD voice for language '{language}', using default")
    return _DEFAULT_TTS[g]


from lecture_driver import extract_lecture, run_lecture


# Per-tool RPC response timeouts (seconds). `ask_analytics` (the AI
# Commander bridge, ADR 0077) runs a full NL->SQL turn on the app side —
# generate <=30s + execute <=8s + narrate <=30s — so 30s would kill every
# long answer mid-query. Every other tool keeps the 30s default; this map
# only ever WIDENS a named tool, never narrows the rest, so the mentor and
# navigator surfaces are byte-identical to before.
_TOOL_RPC_TIMEOUTS: dict[str, float] = {"ask_analytics": 90.0}


def _make_rpc_forwarder(tool_name: str):
    """Create an RPC-forwarding handler for a frontend-defined tool."""

    async def _rpc_handler(raw_arguments: dict[str, object], context: RunContext):
        room = get_job_context().room
        participants = room.remote_participants
        if not participants:
            return json.dumps({"error": "No frontend participant connected"})

        participant = next(iter(participants.values()))
        logger.info(f"Forwarding tool call '{tool_name}' to {participant.identity}")

        try:
            result = await room.local_participant.perform_rpc(
                destination_identity=participant.identity,
                method="tool.call",
                payload=json.dumps({
                    "name": tool_name,
                    "arguments": raw_arguments,
                }),
                response_timeout=_TOOL_RPC_TIMEOUTS.get(tool_name, 30.0),
            )
            return result
        except Exception as e:
            logger.error(f"RPC tool call failed for '{tool_name}': {e}")
            return json.dumps({"error": f"Tool call failed: {str(e)}"})

    _rpc_handler.__name__ = tool_name
    return _rpc_handler


async def _request_screenshot_from_frontend() -> str | None:
    """Request a screenshot from the frontend via RPC."""
    room = get_job_context().room
    participants = room.remote_participants
    if not participants:
        logger.warning("No frontend participant connected for screenshot")
        return None

    participant = next(iter(participants.values()))
    try:
        result = await room.local_participant.perform_rpc(
            destination_identity=participant.identity,
            method="screen.capture",
            payload="{}",
            response_timeout=10.0,
        )
        data = json.loads(result)
        return data.get("image")
    except Exception as e:
        logger.error(f"Failed to get screenshot from frontend: {e}")
        return None


async def _perform_dom_rpc(method: str, payload: dict) -> dict:
    """Perform a DOM-related RPC call to the frontend."""
    room = get_job_context().room
    participants = room.remote_participants
    if not participants:
        raise RuntimeError("No frontend participant connected")

    participant = next(iter(participants.values()))
    try:
        result = await room.local_participant.perform_rpc(
            destination_identity=participant.identity,
            method=method,
            payload=json.dumps(payload),
            response_timeout=10.0,
        )
        return json.loads(result)
    except Exception as e:
        logger.error(f"DOM RPC '{method}' failed: {e}")
        raise


def build_dom_tools():
    """Create built-in DOM tools for lightweight page understanding and control."""

    async def get_page_context(
        context: RunContext,
    ) -> str:
        """
        Get the current page content and interactive elements.

        Returns a semantic markdown representation of the page (optimized for LLM understanding)
        plus a list of all interactive elements with their accessible names and selectors.

        Use this tool when:
        - You need to understand what's on the page
        - You want to find buttons, links, or form fields to interact with
        - You need to verify the current state of the UI
        """
        logger.info("[DOM] Getting page context")
        try:
            result = await _perform_dom_rpc("dom.getContext", {})
            if "error" in result:
                return json.dumps({"error": result["error"]})
            return json.dumps({
                "success": True,
                "context": result.get("context", ""),
                "elements": result.get("elements", []),
            })
        except Exception as e:
            logger.warning(f"[DOM] get_page_context failed: {e}")
            return json.dumps({"error": f"Failed to get page context: {str(e)}"})

    async def click_element(
        element_name: str,
        context: RunContext,
    ) -> str:
        """
        Click an element on the page by its name or description.

        Use this tool when:
        - You need to click a button (e.g., "Submit", "Next", "Cancel")
        - You need to click a link
        - You need to interact with a checkbox or toggle

        Args:
            element_name: The accessible name of the element to click.
                         Examples: "Submit", "Next Step", "I agree checkbox"
        """
        logger.info(f"[DOM] Clicking element: {element_name}")
        try:
            result = await _perform_dom_rpc("dom.click", {"name": element_name})
            if result.get("success"):
                return json.dumps({"success": True, "message": f"Clicked '{element_name}'"})
            else:
                error = result.get("error", "Click failed")
                return json.dumps({"success": False, "error": error})
        except Exception as e:
            logger.warning(f"[DOM] click_element failed: {e}")
            return json.dumps({"success": False, "error": f"Click failed: {str(e)}"})

    async def type_in_field(
        field_name: str,
        text: str,
        context: RunContext,
    ) -> str:
        """
        Type text into a form field.

        Use this tool when:
        - You need to fill out an input field
        - You need to enter text in a textarea
        - You need to update a search box

        Args:
            field_name: The accessible name of the input field.
                       Examples: "Email", "Password", "Search", "Enter your name"
            text: The text to type into the field.
        """
        logger.info(f"[DOM] Typing into field: {field_name}")
        try:
            result = await _perform_dom_rpc("dom.type", {"name": field_name, "text": text})
            if result.get("success"):
                return json.dumps({"success": True, "message": f"Typed into '{field_name}'"})
            else:
                error = result.get("error", "Type failed")
                return json.dumps({"success": False, "error": error})
        except Exception as e:
            logger.warning(f"[DOM] type_in_field failed: {e}")
            return json.dumps({"success": False, "error": f"Type failed: {str(e)}"})

    async def get_react_state(
        component_name: str,
        context: RunContext,
    ) -> str:
        """
        Get the state and props of a React component.

        Use this tool when:
        - You need to understand the internal state of a specific component
        - You want to debug or inspect component behavior
        - You need to access component-specific data not visible in the DOM

        Args:
            component_name: The name of the React component (e.g., "ChatPanel", "UserForm")
        """
        logger.info(f"[DOM] Getting React state for: {component_name}")
        try:
            result = await _perform_dom_rpc("dom.getComponentState", {"componentName": component_name})
            if "error" in result:
                return json.dumps({"error": result["error"]})
            return json.dumps({
                "success": True,
                "state": result.get("state"),
            })
        except Exception as e:
            logger.warning(f"[DOM] get_react_state failed: {e}")
            return json.dumps({"error": f"Failed to get component state: {str(e)}"})

    async def scroll_element(
        direction: str,
        element_name: str = "",
        amount: int = 300,
        context: RunContext = None,
    ) -> str:
        """
        Scroll an element or the page in a given direction.

        Use this tool when:
        - You need to scroll down to see more content
        - You need to scroll a list, panel, or sidebar
        - Content is cut off and you need to reveal it

        Args:
            direction: One of "up", "down", "left", "right"
            element_name: The accessible name of the element to scroll.
                         Leave empty to scroll the page itself.
            amount: Number of pixels to scroll (default 300)
        """
        logger.info(f"[DOM] Scrolling {direction} by {amount}px, element: {element_name or 'page'}")
        try:
            payload: dict = {"direction": direction, "amount": amount}
            if element_name:
                payload["name"] = element_name
            result = await _perform_dom_rpc("dom.scroll", payload)
            if result.get("success"):
                return json.dumps({"success": True, "message": f"Scrolled {direction}"})
            else:
                error = result.get("error", "Scroll failed")
                return json.dumps({"success": False, "error": error})
        except Exception as e:
            logger.warning(f"[DOM] scroll_element failed: {e}")
            return json.dumps({"success": False, "error": f"Scroll failed: {str(e)}"})

    async def press_key(
        key: str,
        element_name: str = "",
        context: RunContext = None,
    ) -> str:
        """
        Press a keyboard key on the currently focused element or a named element.

        Use this tool when:
        - You need to press Enter to submit a search or form
        - You need to press Escape to close a modal or dropdown
        - You need to press Tab to move to the next field
        - You need to use arrow keys to navigate a dropdown

        Args:
            key: The key to press. Examples: "Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"
            element_name: The accessible name of the element to press the key on.
                         Leave empty to press on the currently focused element.
        """
        logger.info(f"[DOM] Pressing key '{key}' on element: {element_name or 'focused'}")
        try:
            payload: dict = {"key": key}
            if element_name:
                payload["name"] = element_name
            result = await _perform_dom_rpc("dom.pressKey", payload)
            if result.get("success"):
                return json.dumps({"success": True, "message": f"Pressed '{key}'"})
            else:
                error = result.get("error", "Key press failed")
                return json.dumps({"success": False, "error": error})
        except Exception as e:
            logger.warning(f"[DOM] press_key failed: {e}")
            return json.dumps({"success": False, "error": f"Key press failed: {str(e)}"})

    return [
        function_tool(get_page_context),
        function_tool(click_element),
        function_tool(type_in_field),
        function_tool(get_react_state),
        function_tool(scroll_element),
        function_tool(press_key),
    ]


def build_vision_tool():
    """Create the built-in analyze_screen tool for vision capabilities."""

    async def analyze_screen(
        question: str,
        context: RunContext,
    ) -> str:
        """
        Analyze what's on the user's screen to help guide them.

        Use this tool when:
        - The user asks about what's on their screen
        - You need to help them find a button or UI element
        - The user is stuck and you need to see their current state
        - You need to verify if the user completed an action

        Args:
            question: What to look for or analyze on the screen.
                     Examples: "find the submit button", "what do you see",
                     "is the form filled out correctly"
        """
        logger.info(f"[Vision] Analyzing screen: {question}")

        # Request screenshot from frontend
        image_b64 = await _request_screenshot_from_frontend()
        if not image_b64:
            return json.dumps({
                "error": "Could not capture screenshot. Make sure screen sharing is enabled."
            })

        # Analyze using vision service
        try:
            vision = get_vision_service()
            result = await vision.analyze_image(image_b64, question)

            if result.get("success"):
                return json.dumps({
                    "success": True,
                    "description": result.get("description", ""),
                    "type": result.get("type"),
                    "found": result.get("found"),
                    "coordinates": result.get("coordinates"),
                })
            else:
                return json.dumps({
                    "error": result.get("error", "Vision analysis failed")
                })
        except Exception as e:
            logger.error(f"[Vision] Analysis error: {e}")
            return json.dumps({"error": f"Vision analysis failed: {str(e)}"})

    return function_tool(analyze_screen)


def build_camera_tools(agent: "MentorAgent") -> list:
    """Create camera vision tools for analyzing the user through their webcam."""

    async def look_at_user(
        question: str,
        context: RunContext,
    ) -> str:
        """
        Look at the user through their camera and answer a question about what you see.

        Use this tool when:
        - You want to see the user's environment or surroundings
        - You need to observe the user's expressions or gestures
        - The user asks you to look at something they're showing
        - You want to understand the user's current situation visually

        Args:
            question: What to look for or analyze in the camera view.
                     Examples: "What is the user holding?", "Describe the user's environment",
                     "What expression is the user making?"
        """
        logger.info(f"[Camera] Looking at user: {question}")

        if agent._latest_camera_frame is None:
            return json.dumps({
                "error": "Camera not available. The user may not have enabled their camera."
            })

        try:
            service = get_camera_vision_service()
            result = await service.analyze_frame(agent._latest_camera_frame, question)

            if result.get("success"):
                return json.dumps({
                    "success": True,
                    "observation": result.get("response", ""),
                })
            else:
                return json.dumps({
                    "success": False,
                    "error": result.get("error", "Vision analysis failed"),
                })
        except Exception as e:
            logger.error(f"[Camera] Vision error: {e}")
            return json.dumps({"error": f"Failed to analyze camera: {str(e)}"})

    return [function_tool(look_at_user)]


def build_dynamic_tools(tools_schema: list[dict]) -> list:
    """Build function_tool instances from OpenAI-format tool schemas."""
    dynamic_tools = []
    for tool_def in tools_schema:
        if tool_def.get("type") != "function":
            continue
        func_def = tool_def["function"]
        func_name = func_def["name"]
        handler = _make_rpc_forwarder(func_name)
        tool = function_tool(handler, raw_schema=func_def)
        dynamic_tools.append(tool)
        logger.info(f"Registered dynamic tool: {func_name}")
    return dynamic_tools



# LIVE-TEACHER-OPENING (2026-07-27) — opt-in opening override.
#
# The agent's first turn has always been a hard-coded "Greet the user briefly
# and ask how you can help." That is right for a reactive tutor (doubt solver,
# mentors, LC voice) but WRONG for an auto-delivering surface like the Learning
# Center's Live Teacher, whose whole premise is to start teaching unprompted.
# Its system prompt says "Begin immediately", so turn 1 carried two
# contradictory orders and the opening became a coin flip.
#
# A surface can now carry its own opening instruction inside the system prompt
# it already controls end-to-end (client -> /api/start system_prompt -> room
# metadata -> here), so NO token-server or client-package change is needed:
#
#     [[SX-OPENING]]<instruction for turn 1>[[/SX-OPENING]]<the real prompt>
#
# STRICTLY OPT-IN: without the marker this is a no-op and every existing voice
# surface keeps byte-identical behaviour. The marker is stripped before the
# prompt reaches the model so it never leaks into the persona.
#
# POSITION-INDEPENDENT ON PURPOSE. The entrypoint PREPENDS to system_prompt
# twice before ever constructing MentorAgent -- session_context (always) and
# lang_directive (non-English) -- so by the time we see the prompt the client's
# marker is buried mid-string. An earlier revision tested `startswith` here and
# was a silent no-op in production for exactly that reason: the greeting still
# fired AND the raw marker stayed in the persona. Scan the whole string; never
# reintroduce a position assumption.
_SX_OPENING_OPEN = "[[SX-OPENING]]"
_SX_OPENING_CLOSE = "[[/SX-OPENING]]"


# LIVE-TEACHER (2026-07-28) — self-closing surface directives, spliced out of
# the system prompt wherever they sit (never positional — L72):
# Values below are FORMAT ILLUSTRATIONS, not the shipped settings — Live Teacher
# currently emits AUTOCONTINUE=8 for v3 and TTS-RATE=0.82 (teachPrompt.ts).
#   [[SX-AUTOCONTINUE=5]]  → after N s of student silence, the agent continues
#                            the lesson by itself (Live Teacher auto-delivery).
#   [[SX-TTS-RATE=0.9]]    → TTS speaking_rate override (Chirp3-HD supports it;
#                            verified by live synth 2026-07-28). Clamped 0.5-1.5.
# Strictly opt-in: no marker → no behaviour change on any other surface.
_SX_AUTOCONTINUE_RE = re.compile(r"\[\[SX-AUTOCONTINUE=(\d{1,3})\]\]")
_SX_TTS_RATE_RE = re.compile(r"\[\[SX-TTS-RATE=([0-9.]{1,5})\]\]")
#   [[SX-LANG=mirror]]     → MIRROR MODE. Answer in whatever language the
#                            student just used, and follow them if they switch.
#                            Without it nothing changes: the session keeps
#                            today's pinned STT/TTS and today's lock directive.
#                            A surface that must stay in one language (a Hindi
#                            or Sanskrit LESSON, where the content language is
#                            the point) simply does not emit it.
_SX_LANG_MIRROR_RE = re.compile(r"\[\[SX-LANG=mirror\]\]")
# [[SX-BRIDGE=verbatim]] — the surface asks that every completed user turn be
# forwarded to the client's query_my_data handler with the caller's words
# VERBATIM and the returned message spoken, keeping this process's LLM out of
# the turn entirely (see MentorAgent.on_user_turn_completed). Navigator-only
# today; strictly opt-in, so every other surface is byte-identical.
_SX_BRIDGE_RE = re.compile(r"\[\[SX-BRIDGE=verbatim\]\]")


def _extract_directives(system_prompt: str):
    """Return (prompt_without_directives, {autocontinue: int|None, tts_rate: float|None})."""
    out = {"autocontinue": None, "tts_rate": None, "lang_mirror": False, "bridge_verbatim": False}
    if not system_prompt:
        return system_prompt, out
    m = _SX_AUTOCONTINUE_RE.search(system_prompt)
    if m:
        try:
            out["autocontinue"] = max(3, min(60, int(m.group(1))))
        except ValueError:
            pass
    m = _SX_TTS_RATE_RE.search(system_prompt)
    if m:
        try:
            out["tts_rate"] = max(0.5, min(1.5, float(m.group(1))))
        except ValueError:
            pass
    out["lang_mirror"] = bool(_SX_LANG_MIRROR_RE.search(system_prompt))
    out["bridge_verbatim"] = bool(_SX_BRIDGE_RE.search(system_prompt))
    cleaned = _SX_AUTOCONTINUE_RE.sub("", system_prompt)
    cleaned = _SX_TTS_RATE_RE.sub("", cleaned)
    cleaned = _SX_LANG_MIRROR_RE.sub("", cleaned)
    cleaned = _SX_BRIDGE_RE.sub("", cleaned)
    return cleaned, out


def _extract_opening(system_prompt: str):
    """Return (opening_instructions_or_None, prompt_without_marker).

    The marker may sit anywhere in the prompt. A prompt with no marker -- or a
    malformed one (open without close, or close before open) -- is returned
    completely untouched, so non-participating surfaces cannot be affected.
    """
    if not system_prompt:
        return None, system_prompt
    start = system_prompt.find(_SX_OPENING_OPEN)
    if start == -1:
        return None, system_prompt
    end = system_prompt.find(_SX_OPENING_CLOSE, start + len(_SX_OPENING_OPEN))
    if end == -1:
        return None, system_prompt
    text = system_prompt[start + len(_SX_OPENING_OPEN):end].strip()
    cleaned = (
        system_prompt[:start] + system_prompt[end + len(_SX_OPENING_CLOSE):]
    ).strip()
    return (text or None), cleaned


class MentorAgent(Agent):
    def __init__(
        self,
        system_prompt: str,
        tools_schema: list[dict] | None = None,
        agent_name: str = "Mentor",
        enable_vision: bool = False,
        mirror: bool = False,
        mirror_gender: str = "female",
        mirror_primary: str = "en",
        enable_dom: bool = True,
        enable_camera: bool = False,
        user_id: str = "",
        language: str = "en",
        lecture_mode: bool = False,
        bridge_verbatim: bool = False,
    ):
        # Camera state - must be set before building tools
        self._enable_camera = enable_camera
        self._latest_camera_frame: rtc.VideoFrame | None = None
        self._camera_stream: rtc.VideoStream | None = None
        self._camera_tasks: list[asyncio.Task] = []

        dynamic_tools = build_dynamic_tools(tools_schema or [])

        # Add built-in tools
        builtin_tools = []

        # DOM tools are lightweight and always useful - enable by default
        if enable_dom:
            builtin_tools.extend(build_dom_tools())
            logger.info("DOM tools enabled for this session")

        # Vision tool is heavier (requires screen share) - only if explicitly enabled
        if enable_vision:
            builtin_tools.append(build_vision_tool())
            logger.info("Vision tool enabled for this session (fallback for DOM)")

        # Camera vision tool - allows agent to see user through webcam
        if enable_camera:
            builtin_tools.extend(build_camera_tools(self))
            logger.info("Camera vision tools enabled for this session")

        # LIVE-TEACHER-OPENING — pull the opt-in turn-1 override out of the
        # prompt (no-op when the marker is absent) BEFORE the persona is set.
        self._opening_instructions, system_prompt = _extract_opening(system_prompt)
        super().__init__(
            instructions=system_prompt,
            tools=builtin_tools + dynamic_tools,
        )
        self._agent_name = agent_name
        # LECTURE-DRIVER — the driver speaks first (the authored opening);
        # an LLM greeting on top would double-open the lesson.
        self._lecture_mode = lecture_mode
        # VERBATIM BRIDGE state. Inert unless the surface sent
        # [[SX-BRIDGE=verbatim]] (navigator only today).
        self._bridge_verbatim = bridge_verbatim
        # MIRROR MODE state. All inert unless the surface sent [[SX-LANG=mirror]].
        self._mirror = mirror
        self._mirror_gender = mirror_gender or "female"
        self._mirror_lang = mirror_primary or "en"   # what the VOICE is speaking now
        self._mirror_streak = 0                      # consecutive turns in the other language
        self._mirror_pending = None
        # P3 — set by run_lecture. Receives (text, start_time) for each aligned
        # chunk. A TEE: transcription_node still yields everything downstream.
        self.timed_string_sink = None
        self._vision_enabled = enable_vision
        self._dom_enabled = enable_dom
        # BL-1 — context for the per-turn safety check.
        self._user_id = user_id
        self._language = language

    def _maybe_mirror_language(self, text: str) -> None:
        """Move the TTS voice to the language the student is actually using.

        HYSTERESIS is the whole point. A single detected turn must not flip the
        voice: students say "ok", "haan", "yes sir" constantly, and a voice that
        flips on every such token is worse than one that never flips. So a
        change needs either two consecutive turns in the new language, or one
        unambiguous turn of six or more words.

        Only the VOICE moves here. The reply language is the LLM's job (see the
        LANGUAGE block in the system prompt) and the STT is already `multi`, so
        transcription never depended on this.
        """
        detected = _detect_turn_language(text)
        if detected is None or detected == self._mirror_lang:
            self._mirror_streak = 0
            self._mirror_pending = None
            return

        if self._mirror_pending == detected:
            self._mirror_streak += 1
        else:
            self._mirror_pending = detected
            self._mirror_streak = 1

        decisive = self._mirror_streak >= 2 or len(text.split()) >= 6
        if not decisive:
            return

        target = "hi-IN" if detected == "hi" else "en-IN"
        voice_name, lang_code = _resolve_tts_voice(target, self._mirror_gender)
        tts = getattr(getattr(self, "session", None), "tts", None)
        if tts is None or not hasattr(tts, "update_options"):
            logger.warning("[mirror] session TTS not updatable — voice unchanged")
            return
        tts.update_options(voice_name=voice_name, language=lang_code)
        logger.info(
            f"[mirror] student switched to {detected} — voice now {voice_name} ({lang_code})"
        )
        self._mirror_lang = detected
        self._mirror_streak = 0
        self._mirror_pending = None

    async def on_user_turn_completed(self, turn_ctx, new_message):
        """BL-1 — child-safety gate. Screen every completed user turn through
        the backend safety service BEFORE the LLM responds.

        Posture (2026-06-15 hardening):
          • Backend reachable (HTTP 200 + JSON) → honor its verdict; a genuine
            block speaks the caring/refusal message + cancels the LLM reply.
          • Backend UNREACHABLE (timeout / connection error / non-200 / non-JSON)
            → do NOT block every turn (that bricks all voice on an infra blip,
            which is exactly what a dropped route once did). Run a local
            high-precision crisis floor: block only an unambiguous self-harm /
            crisis utterance (caring message + helpline); otherwise ALLOW the
            turn and log that safety is running DEGRADED.
        Disabled only if the secret is unset."""
        try:
            text = (getattr(new_message, "text_content", None) or "").strip()
        except Exception:
            text = ""

        # MIRROR MODE — follow the student's language. Deliberately placed
        # ABOVE the safety early-returns below: those return when the safety
        # secret is unset, and the language of the reply must not depend on
        # whether safety screening happens to be configured.
        if self._mirror and text and not self._lecture_mode:
            try:
                self._maybe_mirror_language(text)
            except Exception as e:
                # Never let a cosmetic voice swap break a turn.
                logger.warning(f"[mirror] swap skipped: {e}")

        if not text or not _SAFETY_SECRET:
            return

        blocked = False
        response = None
        degraded = False
        try:
            timeout = aiohttp.ClientTimeout(total=4)
            async with aiohttp.ClientSession(timeout=timeout) as http:
                async with http.post(
                    _SAFETY_URL,
                    headers={"X-Voice-Safety-Secret": _SAFETY_SECRET},
                    json={"text": text, "user_id": self._user_id, "language": self._language},
                ) as resp:
                    if resp.status == 200:
                        payload = await resp.json()
                        data = (payload or {}).get("data", {}) if isinstance(payload, dict) else {}
                        blocked = bool(data.get("blocked"))
                        response = data.get("response")
                    else:
                        # Reachable but no clean verdict (404/403/5xx) → infra
                        # failure, not a safety signal. Degrade, don't block all.
                        degraded = True
                        logger.error(
                            f"[safety] backend HTTP {resp.status} — running DEGRADED (local crisis floor only)"
                        )
        except Exception as e:
            degraded = True
            logger.error(f"[safety] backend unreachable ({e}) — running DEGRADED (local crisis floor only)")

        if degraded:
            # Availability-preserving floor: only an unambiguous crisis utterance
            # is blocked while the backend is down; normal turns flow.
            if _local_crisis_match(text):
                blocked = True
                response = _SAFETY_CRISIS_FALLBACK
                logger.error(
                    "[safety] DEGRADED local floor caught a crisis utterance — blocking with caring message"
                )
            else:
                blocked = False

        if blocked:
            try:
                await self.session.say(response or _SAFETY_FALLBACK)
            except Exception as e:
                logger.warning(f"[safety] say failed: {e}")
            raise StopResponse()

        # VERBATIM BRIDGE (2026-08-16) — navigator surface, opt-in via
        # [[SX-BRIDGE=verbatim]]. Live sessions kept proving the same thing:
        # this process's LLM decides "that turn needs no tool" and chats —
        # eleven of twelve user turns never reached the app's brain, and the
        # one it did forward arrived paraphrased. The wave-5 allowlist
        # removed the wrong-tool choice; this removes the no-tool choice.
        # Every completed user turn goes to the client's query_my_data
        # handler with the caller's words VERBATIM (the app's brain holds
        # the live [PAGE SNAPSHOT] and routes better than a voice model),
        # the returned message is spoken, and StopResponse keeps the local
        # LLM out of the turn entirely. On ANY failure fall through to the
        # LLM turn so voice never bricks on an RPC blip.
        if self._bridge_verbatim and text:
            try:
                room = get_job_context().room
                participants = room.remote_participants
                if participants:
                    participant = next(iter(participants.values()))
                    logger.info(
                        f"[bridge-verbatim] forwarding user turn to {participant.identity}"
                    )
                    result = await room.local_participant.perform_rpc(
                        destination_identity=participant.identity,
                        method="tool.call",
                        payload=json.dumps(
                            {"name": "query_my_data", "arguments": {"question": text}}
                        ),
                        # The brain's turn budget is 20s, but a page_task
                        # confirmation can hold the answer; the default 30s
                        # clipped long turns for ask_analytics before.
                        response_timeout=60.0,
                    )
                    message = None
                    try:
                        parsed = json.loads(result) if result else None
                        if isinstance(parsed, dict):
                            message = parsed.get("message") or parsed.get("answer")
                    except (TypeError, ValueError):
                        message = result if isinstance(result, str) else None
                    if message and str(message).strip():
                        await self.session.say(str(message).strip())
                        raise StopResponse()
                    logger.warning(
                        "[bridge-verbatim] empty bridge answer — falling back to LLM turn"
                    )
            except StopResponse:
                raise
            except Exception as e:
                logger.error(f"[bridge-verbatim] failed ({e}) — falling back to LLM turn")

    def _create_camera_stream(self, track: rtc.Track):
        """Create a video stream to capture frames from the user's camera."""
        # Close any existing stream (only want one at a time)
        if self._camera_stream is not None:
            self._camera_stream.close()

        self._camera_stream = rtc.VideoStream(track)
        logger.info("[Camera] Started video stream from user camera")

        async def read_frames():
            async for event in self._camera_stream:
                self._latest_camera_frame = event.frame

        task = asyncio.create_task(read_frames())
        task.add_done_callback(
            lambda t: self._camera_tasks.remove(t) if t in self._camera_tasks else None
        )
        self._camera_tasks.append(task)

    async def transcription_node(self, text, model_settings=None):
        """TEE the TTS-aligned transcript to the visual-board synchronizer.

        LIVE-VISUAL-BOARD-01 / P3. With use_tts_aligned_transcript the chunks
        arriving here are livekit.agents.types.TimedString — a str subclass
        carrying start_time/end_time as INSTANCE attributes (they do not appear
        on dir(TimedString), which is why a class-level probe reports them
        missing).

        Everything is yielded onward unchanged: this observes, never consumes.
        A sink failure is swallowed because the transcript must keep flowing
        even if the board cannot.
        """
        async for chunk in text:
            sink = getattr(self, "timed_string_sink", None)
            if sink is not None:
                try:
                    sink(str(chunk), getattr(chunk, "start_time", None))
                except Exception:  # pragma: no cover - board must not break voice
                    pass
            yield chunk

    async def on_enter(self):
        # Camera frame capture — video_input=True in RoomOptions causes the SDK to subscribe
        # to video tracks. We then hook track_subscribed to grab user-only frames directly.
        if self._enable_camera:
            room = get_job_context().room

            def _is_user_camera(track, publication, participant) -> bool:
                return (
                    track.kind == rtc.TrackKind.KIND_VIDEO
                    and publication.source == rtc.TrackSource.SOURCE_CAMERA
                    and participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
                )

            def _start_stream(track):
                stream = rtc.VideoStream(track, format=rtc.VideoBufferType.RGBA)

                async def _read():
                    async for event in stream:
                        self._latest_camera_frame = event.frame

                t = asyncio.create_task(_read())
                t.add_done_callback(
                    lambda t: self._camera_tasks.remove(t) if t in self._camera_tasks else None
                )
                self._camera_tasks.append(t)

            # Check already-subscribed tracks
            for participant in room.remote_participants.values():
                for pub in participant.track_publications.values():
                    if pub.track and _is_user_camera(pub.track, pub, participant):
                        _start_stream(pub.track)
                        logger.info(f"[Camera] Streaming from existing track: {participant.identity}")

            @room.on("track_subscribed")
            def on_track_subscribed(track, publication, participant):
                logger.info(f"[Camera] track_subscribed: {participant.identity} source={publication.source} agent={participant.kind}")
                if _is_user_camera(track, publication, participant):
                    _start_stream(track)
                    logger.info(f"[Camera] Streaming from: {participant.identity}")

        # LECTURE-DRIVER — narration is script-driven; the LLM stays silent
        # until the student gives it something to react to.
        if self._lecture_mode:
            return
        # Generate initial greeting. LIVE-TEACHER-OPENING: a surface may
        # override this for turn 1 (see _extract_opening); absent the marker
        # this is the exact string it has always been.
        self.session.generate_reply(
            instructions=(
                self._opening_instructions
                or "Greet the user briefly (1-2 short sentences max) and ask how you can help."
            ),
            allow_interruptions=True,
        )


from livekit.agents import AgentServer

server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    # Connect to the room first so metadata is available
    await ctx.connect()

    # Read session config from room metadata (set by token_server)
    metadata_str = ctx.room.metadata or "{}"
    try:
        metadata = json.loads(metadata_str)
    except json.JSONDecodeError:
        logger.warning(f"Invalid room metadata: {metadata_str}")
        metadata = {}

    system_prompt = metadata.get("system_prompt", "You are a helpful AI mentor.")
    # LIVE-TEACHER (2026-07-28) — strip surface directives BEFORE any prepend
    # touches the prompt (position-independent regardless — see L72). Both are
    # strictly opt-in: absent the markers, behaviour is byte-identical.
    system_prompt, _sx_directives = _extract_directives(system_prompt)
    _lang_mirror = bool(_sx_directives.get("lang_mirror"))
    # LECTURE-DRIVER (2026-07-28) — [[SX-LECTURE]]{json}[[/SX-LECTURE]] carries a
    # v3 script for deterministic delivery (see lecture_driver.py). Extracted
    # here so the JSON never reaches the model; absent the marker this is a
    # byte-for-byte no-op for every other surface.
    system_prompt, _lecture = extract_lecture(system_prompt)
    _auto_continue_secs = _sx_directives.get("autocontinue")
    if _lecture:
        # The driver owns lesson progress; the silence timer would double-drive.
        _auto_continue_secs = None
    _tts_rate = _sx_directives.get("tts_rate")
    tools_schema = metadata.get("tools", [])
    agent_name = metadata.get("agent_name", "Mentor")
    vision_enabled = metadata.get("vision_mode", False)
    camera_enabled = metadata.get("camera_mode", False)

    # Language / TTS config
    language = metadata.get("language") or "en-IN"
    gender = metadata.get("gender") or "female"
    # TUTOR-PICKER (2026-08-05): the mentor package already transmits
    # voice_name in the connect payload; honour it as a direct TTS voice
    # override via the existing "voice:" backdoor in _resolve_tts_voice.
    # Only the PRIMARY voice resolution uses it — `gender` itself stays
    # male/female because mirror_gender and the persona gender block read
    # it, and the language-mirror path must keep per-language voices.
    _voice_override = str(metadata.get("voice_name") or "").strip()
    if _voice_override and "-" not in _voice_override:
        # The mentor package's contract sends the SHORT Chirp3 name
        # ("Despina") and documents composition as {lang}-Chirp3-HD-{name}.
        _voice_override = f"{(language or 'en-IN')}-Chirp3-HD-{_voice_override}"
    tts_gender = f"voice:{_voice_override}" if _voice_override else gender

    # Video mode config
    video_mode = metadata.get("video_mode", False)

    # Inject session context so the agent knows it's in a live video/audio call.
    # Always prepended so it can't be overridden by the caller's system prompt.
    session_lines = [
        "You are in a live real-time voice and video call with the user.",
        "You can hear the user speak (their microphone is active).",
    ]
    if video_mode:
        session_lines.append("You appear as a talking avatar — the user can see and hear you.")
    if camera_enabled:
        session_lines.append(
            "The user's camera is on and you can see them via the look_at_user tool. "
            "If the user asks whether you can see them, say yes and offer to look."
        )
    else:
        session_lines.append(
            "The user's camera is currently off. "
            "If asked whether you can see them, say their camera is off but they can turn it on."
        )
    session_lines += [
        "If the user asks 'can you hear me?' say yes.",
        # 2026-04-24 — hard rule. The LLM was emitting **bold** markdown
        # which the TTS reads aloud literally as "asterisk asterisk
        # respiration asterisk asterisk". Students found it jarring.
        "Output strictly plain text for speech. NEVER use markdown syntax: "
        "no asterisks (*, **), no underscores for emphasis (_word_, __word__), "
        "no backticks (`code`), no pound signs for headings (#), no dashes "
        "or stars for bullet lists. If you want to emphasise a word, just "
        "say it with natural voice emphasis. Keep answers conversational "
        "and short (1–3 sentences) — this is a spoken conversation, not a "
        "written document.",
    ]
    session_context = " ".join(session_lines)
    system_prompt = session_context + "\n\n" + system_prompt

    # Prepend language instruction so the LLM responds in the correct language
    lang_name = _get_lang_name(language)
    if _lang_mirror:
        # Replaces the lock. The lock was wrong in both directions: English
        # sessions got no language instruction at all, and non-English sessions
        # were told never to switch to English — the exact opposite of
        # answering a student in the language they used.
        system_prompt = (
            "LANGUAGE: Reply in the language the student used in their most recent message. "
            "If they wrote or spoke Hindi, reply in Hindi; if English, reply in English; "
            "if they mixed the two, mix them back at roughly their own ratio. "
            "If they change language mid-conversation, change with them on your very next reply. "
            "Never announce the change, never apologise for it, and never say you cannot speak a language. "
            "ALWAYS keep technical and curriculum terms in English (photosynthesis, denominator, "
            "polynomial, chapter names), and never translate a term the student themselves said in English.\n\n"
        ) + system_prompt
    elif lang_name != "English":
        lang_directive = f"IMPORTANT: Always respond in {lang_name}. Never switch to English unless the user explicitly asks you to.\n\n"
        system_prompt = lang_directive + system_prompt
    avatar_service = metadata.get("avatar_service", "ditto")
    avatar_id = metadata.get("avatar_id", _DITTO_AVATAR_ID)
    ditto_api_url = _DITTO_API_URL

    # DOM mode is enabled by default for lightweight page understanding
    dom_enabled = metadata.get("dom_mode", True)

    logger.info(
        f"Starting agent '{agent_name}' in room '{ctx.room.name}' "
        f"with {len(tools_schema)} tools, video_mode={video_mode}, "
        f"dom={dom_enabled}, vision={vision_enabled}, camera={camera_enabled}"
    )

    agent = MentorAgent(
        mirror=_lang_mirror,
        mirror_gender=(gender if gender in ("female", "male") else "female"),
        mirror_primary=("hi" if _get_lang_name(language) == "Hindi" else "en"),
        system_prompt=system_prompt,
        tools_schema=tools_schema,
        agent_name=agent_name,
        enable_vision=vision_enabled,
        enable_dom=dom_enabled,
        enable_camera=camera_enabled,
        # BL-1 — identity/language for the per-turn safety check.
        user_id=str(metadata.get("user_id", "")),
        language=str(metadata.get("language") or "en"),
        lecture_mode=bool(_lecture),
        bridge_verbatim=bool(_sx_directives.get("bridge_verbatim")),
    )

    # Always use Google TTS for audio generation
    tts_voice, tts_language = _resolve_tts_voice(language, tts_gender)
    logger.info(f"TTS: language={language} → voice={tts_voice}, lang_code={tts_language}")
    _tts_kwargs = {}
    if _tts_rate:
        # [[SX-TTS-RATE]] — surface-requested pace (Live Teacher asks 0.82 so a
        # lesson breathes; was 0.9 until the owner reported "pace is also very
        # fast" on 2026-07-29). Verified against Chirp3-HD with a live synth
        # before shipping; clamped 0.5-1.5 in _extract_directives.
        _tts_kwargs["speaking_rate"] = _tts_rate
        logger.info(f"TTS: speaking_rate={_tts_rate} (surface directive)")
    tts_plugin = google.TTS(
        voice_name=tts_voice,
        language=tts_language,
        model_name="chirp_3",
        credentials_file=_GOOGLE_CREDS,
        use_streaming=False,
        audio_encoding=texttospeech.AudioEncoding.LINEAR16,
        **_tts_kwargs,
    )

    # Idle timeout — seconds of silence before the agent auto-ends.
    # 2026-04-29: default lifted from 60s → 86400s (24h) so the away
    # event functionally never fires in production. The auto-close
    # branch in on_user_state_changed has been removed (see comment
    # block there) — this value is now only carried for back-compat
    # with the AgentSession constructor signature. Frontend no longer
    # benefits from per-consumer override since there's no behaviour
    # to tune; we keep `metadata.get(...)` so future surfaces can opt
    # back in to a tighter window without re-editing the agent.
    user_idle_timeout = metadata.get("user_idle_timeout", 86400.0)

    # Deepgram STT: map Google Chirp3 lang codes to Deepgram BCP-47 codes.
    #
    # VERIFIED 2026-08-01 against the LIVE Deepgram /v1/listen API with real
    # audio, one request per language — not from docs, and not from the
    # plugin's DeepgramLanguages Literal, which Python does not enforce at
    # runtime (every code below constructs fine; only the API can refuse it):
    #   nova-3 ACCEPTS  multi, en*, hi, mr, gu, bn, ta, te, kn, ur   → HTTP 200
    #   nova-3 REFUSES  pa (Punjabi), ml (Malayalam)                 → HTTP 400
    #                   "No such model/language/tier combination found"
    #   nova-2 is strictly WORSE, not a fallback: it refuses gu, mr AND pa.
    #
    # gu-IN was previously substituted with the HINDI model on the belief that
    # nova-3 had no Gujarati. It does. A Gujarati speaker was being transcribed
    # by a Hindi model for no reason — and on VIVA, GRADED on that
    # mistranscription. Gujarati now uses its own model.
    _NOVA3_LANG_MAP = {
        "en-IN": "en-IN", "en-US": "en-US", "en-GB": "en-GB", "en-AU": "en-AU",
        "hi-IN": "hi", "fr-FR": "fr", "fr-CA": "fr", "de-DE": "de",
        "es-ES": "es", "es-US": "es", "pt-BR": "pt-BR", "pt-PT": "pt",
        "ar-XA": "ar", "ja-JP": "ja", "ko-KR": "ko",
        "cmn-CN": "zh-CN", "cmn-TW": "zh-TW", "yue-HK": "zh-CN",
        "it-IT": "it", "nl-NL": "nl", "nl-BE": "nl-BE", "pl-PL": "pl",
        "ru-RU": "ru", "tr-TR": "tr", "sv-SE": "sv", "da-DK": "da",
        "fi-FI": "fi", "cs-CZ": "cs", "bg-BG": "bg", "uk-UA": "uk",
        "id-ID": "id", "ms-MY": "ms", "th-TH": "th", "vi-VN": "vi",
        "bn-IN": "bn", "mr-IN": "mr", "kn-IN": "kn", "gu-IN": "gu",
        "ta-IN": "ta", "te-IN": "te", "ur-IN": "ur",
        "et-EE": "et", "hr-HR": "hr",
    }
    # No Deepgram STT at ANY tier. The Chirp3 TTS voice for these IS real, so
    # the tutor SPEAKS the language correctly but LISTENS through Hindi — the
    # closest available model. nova-3 rather than nova-2 because nova-3 is the
    # better model and accepts hi. The substitution is logged, never silent.
    _NO_STT_LISTEN_VIA_HI = {"pa-IN", "ml-IN"}
    _, tts_lang_code = _resolve_tts_voice(language, tts_gender)
    # MIRROR MODE — nova-3 `multi` is the only setting that transcribes a
    # student who code-switches mid-sentence. Verified accepted by the live
    # Deepgram API 2026-08-01 (HTTP 200). Scoped to English/Hindi sessions:
    # every other language stays on its own pinned model, because `multi` does
    # not cover them and a wrong-language transcript is worse than a pinned one.
    if _lang_mirror and tts_lang_code in ("en-IN", "en-US", "en-GB", "en-AU", "hi-IN"):
        logger.info(f"STT: mirror mode → nova-3 multi (session primary {tts_lang_code})")
        stt_plugin = deepgram.STT(model="nova-3", language="multi")
    elif tts_lang_code in _NOVA3_LANG_MAP:
        stt_plugin = deepgram.STT(model="nova-3", language=_NOVA3_LANG_MAP[tts_lang_code])
    elif tts_lang_code in _NO_STT_LISTEN_VIA_HI:
        logger.warning(
            f"STT: {tts_lang_code} has no Deepgram model at any tier — listening via hi (nova-3). "
            f"Speech OUTPUT is still {tts_lang_code}; comprehension of the student is degraded."
        )
        stt_plugin = deepgram.STT(model="nova-3", language="hi")
    else:
        stt_plugin = deepgram.STT(model="nova-3", language="en-US")

    session = AgentSession(
        # LIVE-VISUAL-BOARD-01 / P3 — real sentence timing for the visual board.
        # Scoped to a driven lecture so every other surface keeps today's
        # transcript behaviour byte for byte. Verified present on
        # AgentSession.__init__ in the deployed livekit-agents 1.3.12.
        use_tts_aligned_transcript=bool(_lecture),
        stt=stt_plugin,
        # VOICE-LLM-DIAL — model is env-switchable so the gpt-4.1-mini cost
        # trial (~4x cheaper per turn) can be flipped per box without a code
        # deploy, and rolled back the same way. Default stays gpt-4.1 — the
        # tool-calling baseline, and the safe value if the var is ever unset,
        # so a blank env cannot silently downgrade the model. Watch tool
        # success in the turn logs after flipping: this agent dispatches tool
        # calls to the browser, which is where mini is likeliest to regress.
        #
        # Ported from SchoolExl's agent.py (2026-08-11, upstream). The copy
        # this branch was taken from predates it and hardcoded the model, so
        # VOICE_LLM_MODEL was dead here — we carried their .env value across,
        # read gpt-4.1-mini in it, and ran gpt-4.1 anyway.
        llm=openai.LLM(model=os.environ.get("VOICE_LLM_MODEL", "gpt-4.1")),
        tts=tts_plugin,
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        user_away_timeout=user_idle_timeout,
        resume_false_interruption=False,  # required for DataStream avatar (Ditto)
        # VOICE-INTERRUPT-WORDS-01 (2026-05-13) — was hardcoded 1. Android
        # mentor sessions had a runaway echo loop: phone speaker→mic (no
        # OS-level AEC on Android) → Deepgram transcribed 1 syllable of
        # the agent's own TTS → min_interruption_words=1 satisfied → agent
        # interrupted itself + treated the echo as fresh user input →
        # loop. Browser-side half-duplex (mute mic during agent speech)
        # ships in d1fae0ff but has ~150ms React-effect lag, which is
        # exactly long enough for 1-word echo to leak through. Raising
        # the threshold to 3 makes the loop physically impossible to
        # trigger from a 150ms speaker echo (rarely transcribes 3 confident
        # words). Real user barge-in via "stop talking please" / "wait a
        # moment" still works — short single-word barge-ins do not.
        # ROLLBACK: set VOICE_MIN_INTERRUPT_WORDS=1 in /opt/schoolexl-voice/.env
        # and `docker compose restart schoolexl-agent` on the voice host —
        # no redeploy needed. Or `git revert` this commit.
        min_interruption_words=int(os.getenv("VOICE_MIN_INTERRUPT_WORDS", "3")),
        # 2026-04-24 — explicit list of TTS text transforms. Default is
        # "all built-in filters" but LLM output still leaked `**bold**`
        # to TTS on some turns; pinning the exact filter list removes
        # ambiguity. `filter_markdown` strips asterisks, underscores,
        # headings, bullets, backticks before TTS. `filter_emoji`
        # strips emoji characters Google Chirp3-HD would otherwise read
        # as "colon D" / "smiling face".
        tts_text_transforms=["filter_markdown", "filter_emoji"],
    )

    # 2026-04-29 — Auto-disconnect on idle DISABLED per product directive.
    #
    # Prior behaviour: after `user_idle_timeout` seconds of silence
    # LiveKit flipped user_state → "away" and the agent closed the
    # session with a goodbye line. That broke realistic navigation
    # flows: when the agent successfully opens a topic / video /
    # whiteboard via tool call, the user naturally falls silent to
    # read the page — and 60 s later the session would auto-close,
    # cutting them off from follow-up voice commands. Verified from
    # live agent logs at 04:47 today on a "whiteboard for hot and
    # cold" navigation: the away-state handler fired ~60 s after the
    # successful tool call, then session closed. Reasonable for an
    # always-listening assistant to NOT enforce idle disconnect —
    # the surface keeps the LiveKit room alive and the wake-word /
    # capsule UX handles teardown explicitly.
    #
    # We keep the state-changed listener as a debug breadcrumb (logs
    # away/listening/speaking transitions) so we can still observe
    # the state machine in production logs, but the auto-close branch
    # is removed. Session ends only on:
    #   1. explicit `session_close` tool call (user said "stop"/"bye")
    #   2. client-side LiveKit room.disconnect() (tab close, surface
    #      handoff via voiceConsumerStore, soft-X grace expiry)
    #   3. `max_turns_per_session` cap (still active — bounds runaway
    #      forgotten-tab scenarios)

    @session.on("user_state_changed")
    def on_user_state_changed(ev):
        new_state = getattr(ev, "new_state", None) or (ev if isinstance(ev, str) else None)
        logger.info(f"[idle] user_state_changed → {new_state}")
        # Intentionally no auto-close. State transitions are observed
        # only — see the comment block above.

    # 2026-04-27 (Wave 0f) — Per-session turn cap.
    # Hard guard against runaway sessions: a forgotten browser tab could
    # otherwise hold a LiveKit room and burn LLM tokens indefinitely. The
    # cap fires gracefully (one farewell line + aclose) so the user knows
    # what happened.
    #
    # Resolution order (highest precedence first):
    #   1. metadata["max_turns_per_session"] — per-consumer override
    #      (server-side VoiceSessionService can set a different cap per
    #      persona; e.g. coding studio long-form might want 80)
    #   2. VOICE_MAX_TURNS_PER_SESSION env var on the voice server
    #   3. Default 50 — comfortable for a 30+ minute fluid dialog,
    #      narrow enough to bound runaway behaviour
    #
    # Counter lives in a mutable dict so the closure can rebind. We
    # count finalised user transcripts only (interim STT chunks emit
    # the same event with is_final=False on some lib versions).
    try:
        _max_turns = int(metadata.get("max_turns_per_session")
                         or os.getenv("VOICE_MAX_TURNS_PER_SESSION", "50"))
    except (TypeError, ValueError):
        _max_turns = 50
    _max_turns = max(1, _max_turns)  # don't accept 0 or negatives
    _turn_state = {"count": 0, "fired": False}

    # LIVE-TEACHER-AUTOCONTINUE (2026-07-28) — [[SX-AUTOCONTINUE=N]] surfaces.
    # A lesson agent otherwise stalls at every turn boundary: it speaks a
    # paragraph, the session flips to "listening", and nothing happens until
    # the student talks. The model cannot perceive time, so silence-handling
    # MUST live here: N seconds after the agent stops speaking with no student
    # speech, nudge it to continue the lesson. Strictly opt-in via the marker
    # (only Live Teacher sends it today); every other surface keeps its
    # wait-for-the-user behaviour byte-for-byte.
    if _auto_continue_secs:
        _AC_MAX_FIRES = 120  # bounds a fully hands-off lesson end-to-end
        _ac_state = {"task": None, "fires": 0}

        def _ac_cancel():
            t = _ac_state["task"]
            if t and not t.done():
                t.cancel()
            _ac_state["task"] = None

        async def _ac_fire():
            try:
                await asyncio.sleep(_auto_continue_secs)
                if _turn_state["fired"]:
                    return  # turn-cap goodbye said — do not reanimate
                _ac_state["fires"] += 1
                if _ac_state["fires"] > _AC_MAX_FIRES:
                    logger.info("[auto-continue] fire cap reached — going quiet")
                    return
                logger.info(
                    f"[auto-continue] {_auto_continue_secs}s of silence — continuing the lesson "
                    f"({_ac_state['fires']}/{_AC_MAX_FIRES})"
                )
                session.generate_reply(
                    instructions=(
                        "(The student stayed silent.) If you just asked a question, follow your "
                        "on-silent guidance in ONE short warm line, then move on. Otherwise simply "
                        "CONTINUE the lesson from exactly where you left off — do not greet again, "
                        "do not recap, do not ask if they are there. If the lesson is already "
                        "finished and you have said goodbye, say nothing."
                    ),
                    allow_interruptions=True,
                )
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.warning(f"[auto-continue] failed: {e}")

        @session.on("agent_state_changed")
        def _ac_on_agent_state(ev):
            st = getattr(ev, "new_state", None)
            _ac_cancel()
            # Arm only when the agent has finished talking and is waiting.
            if str(st) == "listening":
                _ac_state["task"] = asyncio.create_task(_ac_fire())

        @session.on("user_state_changed")
        def _ac_on_user_state(ev):
            # The student began speaking — their turn; stand down instantly.
            if str(getattr(ev, "new_state", "")) == "speaking":
                _ac_cancel()

        @session.on("user_input_transcribed")
        def _ac_on_user_speech(ev):
            _ac_cancel()

    @session.on("user_input_transcribed")
    def on_user_input_transcribed(ev):
        # Only count finalised transcripts. Some lib versions emit
        # interim chunks via the same event; .is_final defaults to True
        # if the field is absent (single-shot final-only mode).
        if not getattr(ev, "is_final", True):
            return
        if _turn_state["fired"]:
            return  # already at cap, ignore further turns
        _turn_state["count"] += 1
        logger.info(f"[turn-cap] user turn {_turn_state['count']}/{_max_turns}")
        if _turn_state["count"] >= _max_turns:
            _turn_state["fired"] = True
            logger.info(f"[turn-cap] cap reached ({_max_turns}) — closing session gracefully")
            try:
                session.say(
                    "We've covered a lot in this session. Let me wrap up here — "
                    "you can always pick up where we left off. See you next time!",
                    allow_interruptions=False,
                )
            except Exception as e:
                logger.warning(f"[turn-cap] session.say failed: {e}")
            # BUGFIX 2026-07-07: was `_asyncio.create_task` — NameError (only
            # `asyncio` is imported), so the cap said its goodbye line but the
            # session never actually closed.
            asyncio.create_task(session.aclose())

    # If video mode, set up the avatar pipeline BEFORE starting the session.
    # Avatar service joins as separate participant, publishes its own A/V tracks.
    # DataStreamAudioOutput routes TTS audio to the avatar participant.
    if video_mode:
        if avatar_service == "tavus":
            logger.info("Video mode ON — Tavus avatar")
            avatar_session = TavusAvatarSession()
            await avatar_session.start(session, room=ctx.room)
        elif avatar_service == "bey":
            logger.info("Video mode ON — Beyond Presence avatar")
            avatar_session = BeyAvatarSession()
            await avatar_session.start(session, room=ctx.room)
        elif ditto_api_url:
            logger.info(f"Video mode ON — Ditto API: {ditto_api_url}, avatar: {avatar_id}")
            avatar_session = DittoAvatarSession(
                api_key=_DITTO_API_KEY,
                ditto_api_url=ditto_api_url,
                avatar_id=avatar_id,
                video_fps=25,
            )
            await avatar_session.start(session, room=ctx.room)
        else:
            logger.warning("Video mode requested but no avatar service configured")
    else:
        logger.info("Audio-only mode (no video)")

    # Enable video_input so the framework subscribes to the user's camera track
    # (without this, track_subscribed never fires for video tracks)
    room_opts = room_io.RoomOptions(video_input=camera_enabled)

    # PAGE-TASK VOICE LOOP (ADR 0076 follow-up, 2026-08-16) — the browser
    # runner streams a finished page task's outcome on this topic; the agent
    # SPEAKS it and hands the turn back ("...what next?"), closing the
    # guided loop the silent toast never could. Topic-gated: every surface
    # that never sends the topic is byte-identical to before.
    def _on_task_result(reader, participant_identity):
        async def _consume():
            try:
                text = (await reader.read_all() or "").strip()
            except Exception:
                return
            if not text:
                return
            session.generate_reply(
                instructions=(
                    "The on-page action the user asked for has just finished. "
                    f"Outcome: {text} "
                    "Tell the user this outcome in ONE short plain sentence, "
                    "then ask what they would like to do next."
                ),
                allow_interruptions=True,
            )

        asyncio.create_task(_consume())

    ctx.room.register_text_stream_handler("uniexl.task_result", _on_task_result)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_opts,
        # VOICE-ECHO-BVC-01 (2026-05-16) — server-side echo / background-voice
        # cancellation on the agent's mic INPUT. Root cause of the Android
        # speaker->mic echo loop: NO noise/echo cancellation was wired at all.
        # min_interruption_words (VIW01) only gates mid-speech barge-in; the
        # dominant loop is the agent's own TTS, echoed by the phone speaker,
        # transcribed and FINALIZED as full user turns (interruption threshold
        # irrelevant). BVC (Krisp) strips the echoed agent/background voice
        # from the inbound track server-side, so it is device-independent and
        # works regardless of the browser's (absent) AEC. Model is bundled
        # with livekit-plugins-noise-cancellation (verified present in the
        # image — no runtime download, no crash risk). Does not touch
        # room_options (camera/video) or the avatar output path.
        # ROLLBACK: delete this room_input_options kwarg +
        # `docker compose restart schoolexl-agent` (no redeploy).
        room_input_options=room_io.RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    # LECTURE-DRIVER — script-driven narration takes over from here; the LLM
    # sits behind it for reactions only. Spawned (not awaited): the entrypoint
    # must fall through to the framework's normal lifecycle handling.
    if _lecture:
        # LIVE-VISUAL-BOARD-01 / P3 — real playout facts for cue scheduling and
        # for resume. Verified on the deployed runtime: AudioOutput is an
        # EventEmitter exposing playback_started / playback_finished, and
        # PlaybackFinishedEvent carries playback_position + interrupted.
        # getattr-guarded because a missing audio output must leave the board
        # unmeasured, never crash the lecture.
        def _wire_playback(driver):
            audio_out = getattr(getattr(session, "output", None), "audio", None)
            on = getattr(audio_out, "on", None)
            if not callable(on):
                logger.warning("[lecture] no audio output events — cues will settle at unit boundaries")
                return
            try:
                on("playback_started", lambda _ev=None: driver.on_playback_started())
                on(
                    "playback_finished",
                    lambda ev=None: driver.on_playback_finished(
                        getattr(ev, "playback_position", 0.0),
                        getattr(ev, "interrupted", False),
                    ),
                )
            except Exception as e:
                logger.warning(f"[lecture] could not subscribe playback events (non-fatal): {e}")

        asyncio.create_task(
            run_lecture(session, ctx.room, _lecture, agent=agent, on_driver=_wire_playback)
        )


if __name__ == "__main__":
    cli.run_app(server)
