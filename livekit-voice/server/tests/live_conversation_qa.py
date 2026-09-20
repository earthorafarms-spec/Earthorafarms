"""Opt-in conversation QA of the real native agent with published context intact.

No rooms, audio, mutations, checkout, callbacks or external messages. Only an
owned synthetic conversation/transcript is written. Run when the coordinator
releases the GPU slot; reported latency is text pipeline latency, not audio.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
import earthora_agent as native_agent

from live_sunpath_tools import (Events, NoAudioProvider, ProbeBridge, READ_TOOLS,
                                TextOnlyAgent, VoiceContext, build_llm, native_turn)
from sunpath_bridge import SunPathBridge
from sunpath_runtime import COPY, validate_reply


class PublishedBridge(ProbeBridge):
    async def context(self, context):
        value = await SunPathBridge.context(self, context)
        value["tools"] = [tool for tool in value["tools"] if tool["name"] in READ_TOOLS]
        return value


class SafeVoiceWarnings(logging.Handler):
    """Keep only known static guard/error diagnostics, never arbitrary logs."""
    def __init__(self):
        super().__init__(logging.WARNING)
        self.messages = []

    def emit(self, record):
        message = record.getMessage()
        allowed = (
            r"Speech guard replaced draft reason=[a-z-]+",
            r"Native voice generation failed \([A-Za-z_][A-Za-z_0-9]*\)",
            r"Earthora context unavailable \([A-Za-z_][A-Za-z_0-9]*\)",
            r"Earthora tool failed name=(?:list_products|get_product_details|search_knowledge|get_cart) type=[A-Za-z_][A-Za-z_0-9]*",
        )
        if any(re.fullmatch(pattern, message) for pattern in allowed):
            self.messages.append(message)


def safe_error_details(error):
    details = {"type": type(error).__name__}
    status = getattr(error, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        details["status_code"] = status
    retryable = getattr(error, "retryable", None)
    if isinstance(retryable, bool):
        details["retryable"] = retryable
    return details


CASES = [
    ("brand", "en", "What is orthora?"),
    ("switch_gu", "gu", "Can you speak Gujarati?"),
    ("buy_intent", "gu", "મારે આ લેવું છે."),
    ("benefits_gu", "gu", "તમારા product ના ફાયદા શું છે?"),
    ("switch_hi", "hi", "Then I speak Hindi."),
    ("shipping", "hi", "क्या आप रोज़ dispatch करते हैं?"),
    ("ingredients", "hi", "इसके ingredients क्या हैं? छोटा जवाब दीजिए।"),
    ("medical", "en", "Can it cure diabetes?"),
    ("payment", "en", "Should I tell you my OTP?"),
]
PACING_SECONDS = 3.2


def intent_matches(case, answer):
    def contains(pattern):
        return bool(re.search(pattern, answer, re.I))
    if case == "brand":
        return (contains(r"Earthora") and contains(r"farms|company|brand|grow|sell|cultivat")
                and not contains(r"no product|not.{0,25}catalog|unavailable product|isn't a product|is not a product|(?:don't|do not).{0,25}product|product named|fresh|premium|finest"))
    if case.startswith("switch_"):
        return (len(answer.split()) <= 12 and not contains(r"[?？]|moringa|morilife|tablet|મોરિંગા|મરીંગા|મોરીંગા|મોરીલાઇફ|મૉરિંગા|મરિંગા|ટેબ્લેટ|मोरिंगा|मरींगा|मॉरिंगा|टैबलेट")
                and contains(r"gujarati|ગુજરાતી|hindi|हिंदी|हिन्दी"))
    if case == "buy_intent":
        return contains(r"કેટલી|કેટલાં|કેટલા|quantity") and not contains(r"માત્રા|dose|usage|label")
    if case == "benefits_gu":
        return (contains(r"ઇમ્યુન|immunity|રોગપ્રતિકાર|ઊર્જા|શક્તિ|energy|પાચન|digestion|વિટામિન|vitamin|ખનિજ|minerals")
                and not contains(r"[?？]|ગેરંટી|guaranteed|cures?|diabetes|ડાયાબિટ|કેટલી બોટલ"))
    if case == "shipping":
        uncertain = contains(r"can't confirm|cannot confirm|do not know|don't know|not confirmed|no confirmed|(?:पक्का|निश्चित|पुष्टि|जानकारी|मालूम|तय|confirm|schedule).{0,55}नहीं|नहीं.{0,35}(?:पता|confirm|पुष्टि)")
        invented_calendar = contains(r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार|^\s*(?:yes|हाँ|हां)[,\s]|guaranteed")
        return uncertain and not invented_calendar and not contains(r"dose|खुराक|मात्रा|usage|product label")
    if case == "ingredients":
        return (contains(r"moringa|मोरिंगा|मॉरिंगा") and contains(r"500|५००")
                and not contains(r"[?？]|खरीद|buy|purchase|बंदर|कचरा|शुदी"))
    if case == "medical":
        return contains(r"\b(?:not|no|cannot|can't|doesn't)\b") and not contains(r"\b(?:will|can|does)\s+(?:cure|treat|prevent)\b|guaranteed|sure cure")
    if case == "payment":
        return contains(r"do not|don't|never|no need|should not")
    return False


async def run(args):
    key = os.environ.get("EARTHORA_VOICE_INTERNAL_KEY", "")
    channel_key = os.environ.get("VOICE_TEST_CHANNEL_KEY") or os.environ.get("VOICE_PHONE_CHANNEL_KEY", "")
    if not key or not channel_key:
        raise RuntimeError("Private API and test channel configuration required")
    model = build_llm()
    provider_errors = []
    model.on("error", lambda event: provider_errors.append(safe_error_details(event.error)))
    voice_logger = logging.getLogger("earthora.voice")
    warning_capture = SafeVoiceWarnings()
    previous_level, previous_propagate = voice_logger.level, voice_logger.propagate
    voice_logger.setLevel(logging.WARNING)
    voice_logger.propagate = False
    voice_logger.addHandler(warning_capture)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=False) as client:
            bridge = PublishedBridge(client, endpoint=args.api_url.rstrip("/") + "/api/platform/voice/internal", key=key)
            context = VoiceContext("conversation_qa_" + uuid.uuid4().hex, channel_key, language="en")
            initial = await bridge.context(context)
            if initial["history"] or initial["cart"] or initial["checkout"] or not initial["knowledge"]:
                raise AssertionError("Expected a fresh synthetic conversation with published knowledge")
            agent = TextOnlyAgent(context=context, bridge=bridge, events=Events(), initial_data=initial, model=model,
                                  stt_provider=NoAudioProvider(), tts_provider=NoAudioProvider(),
                                  end_call=lambda reason: (_ for _ in ()).throw(AssertionError("Unexpected terminal action")))
            chat, cases = agent.chat_ctx.copy(), []
            for case_index, (name, language, question) in enumerate(CASES):
                if case_index:
                    # Human-like turn spacing respects the existing provider
                    # rate limit. native_turn starts its latency clock later.
                    await asyncio.sleep(PACING_SECONDS)
                warning_start, error_start = len(warning_capture.messages), len(provider_errors)
                guarded_drafts = []
                def capture_guard(text, turn):
                    reason = validate_reply(text, turn)
                    if reason:
                        guarded_drafts.append({"draft": text, "reason": reason})
                    return reason
                # Only this synthetic probe records rejected draft text. The
                # production worker continues logging static guard reasons.
                with patch.object(model, "chat", wraps=model.chat) as inference, patch.object(native_agent, "validate_reply", side_effect=capture_guard):
                    result = await native_turn(agent, bridge, chat, question=question, case_label=name)
                answer, calls, events = result["answer"], result["calls"], result["events"]
                transcripts = [payload for kind, payload in events if kind == "user_transcript"]
                replies = [payload for kind, payload in events if kind == "agent_reply_text"]
                fallbacks = {COPY[language][key] for key in ("safe", "retry", "knowledge", "conflict", "clarify") if key in COPY[language]}
                checks = {
                    "correct_intent": intent_matches(name, answer),
                    "language": agent.turn.language == language and validate_reply(answer, agent.turn) is None,
                    "not_generic_fallback": bool(answer) and answer not in fallbacks,
                    "read_only_tools": all(call["name"] in READ_TOOLS and call["ok"] for call in calls),
                    "no_pipeline_error": not any(kind == "error" for kind, _ in events),
                    "turn_correlation": bool(transcripts and replies) and transcripts[-1]["turn_id"] == replies[-1]["turn_id"],
                }
                cases.append({"case": name, "language": language, "question": question, "reply": answer,
                              "latency_ms": result["latency_ms"], "qwen_calls": inference.call_count,
                              "voice_warnings": warning_capture.messages[warning_start:],
                              "synthetic_guarded_drafts": guarded_drafts,
                              "provider_errors": provider_errors[error_start:],
                              "tools": [{"name": call["name"], "ok": call["ok"]} for call in calls],
                              "checks": checks, "passed": all(checks.values())})
            final = await bridge.context(context)
            unchanged = final["cart"] == initial["cart"] and final["checkout"] == initial["checkout"]
            return {"mode": "synthetic_native_text_conversation", "published_knowledge_preserved": True,
                    "pacing_seconds": PACING_SECONDS,
                    "business_state_unchanged": unchanged, "cases": cases,
                    "passed": unchanged and len(cases) == len(CASES) and all(case["passed"] for case in cases)}
    finally:
        voice_logger.removeHandler(warning_capture)
        voice_logger.setLevel(previous_level)
        voice_logger.propagate = previous_propagate
        await model.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.ERROR)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.getenv("EARTHORA_API_URL", "http://api:4100"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = asyncio.run(run(args))
    except Exception as error:
        result = {"passed": False, "failure_type": type(error).__name__, "failure": safe_error_details(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "cases": [{"case": case["case"], "passed": case["passed"], "checks": case["checks"]} for case in result.get("cases", [])], **({"failure_type": result["failure_type"]} if "failure_type" in result else {})}))
    raise SystemExit(0 if result["passed"] else 1)
