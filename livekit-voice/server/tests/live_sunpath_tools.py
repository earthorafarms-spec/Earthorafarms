"""Opt-in read-only native Qwen/tool proof, adapted from SunPath eval/qa_eval.py.

This is a text-only integration test, not an audio latency test. It uses the
production EarthoraAgent.on_user_turn_completed, llm_node and _make_tool with
the real GPU LLM plugin and authenticated API. Only read tools are advertised;
an independent bridge allowlist refuses all mutation tools. The sole database
writes are an owned synthetic conversation and its synthetic transcript.

No worker source/configuration is changed, no room is admitted, no audio is
synthesized, and no phone/message/checkout/callback is created. Run only after
the deployment coordinator releases the GPU test slot:

  python tests/live_sunpath_tools.py --output /tmp/voice-smoke/sunpath-tools.json
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from earthora_agent import EarthoraAgent, llm
from earthora_bridge import VoiceContext
from sunpath_bridge import SunPathBridge
from sunpath_config import build_llm
from sunpath_runtime import COPY, validate_reply
from source_fact_localizations import approved_fact_reply
from livekit.agents.types import APIConnectOptions

READ_TOOLS = frozenset({"list_products", "get_product_details", "search_knowledge", "get_cart"})
MIN_INFERENCE_GAP_SECONDS = 3.2
_last_inference_finished = 0.0
_NATIVE_DIGITS = str.maketrans("०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯", "01234567890123456789")


def canonical_metadata_valid(entry, product_id):
    if (entry.get("source") != "product_knowledge" or entry.get("status") != "approved"
            or entry.get("product_id") != product_id or not isinstance(entry.get("source_id"), str)
            or not entry["source_id"] or not isinstance(entry.get("version"), int)
            or isinstance(entry["version"], bool) or entry["version"] < 1
            or not isinstance(entry.get("locale"), str)):
        return False
    now = datetime.now(timezone.utc)
    for key in ("approved_at", "effective_from", "effective_until"):
        if key not in entry:
            return False
        if entry[key] is None:
            continue
        try:
            instant = datetime.fromisoformat(entry[key].replace("Z", "+00:00"))
            instant = instant.replace(tzinfo=timezone.utc) if instant.tzinfo is None else instant
        except (AttributeError, TypeError, ValueError):
            return False
        if (key == "effective_until" and instant <= now) or (key != "effective_until" and instant > now):
            return False
    return True


def usage_details(text):
    """Compare dose, frequency and meal timing across EN/HI/GU source/reply."""
    value = text.translate(_NATIVE_DIGITS).casefold().replace("–", "-").replace("—", "-")
    groups = {
        "once": ["एक बार", "એક વાર", "એકવાર"], "twice": ["दो बार", "બે વાર", "બેવાર"],
        "breakfast": ["नाश्ते", "नाश्ता", "નાસ્તા", "નાસ્તો"],
        "dinner": ["रात के खाने", "रात का खाना", "रात्रि भोजन", "રાત્રિના ભોજન", "રાત્રે ભોજન", "રાત્રિભોજન", "રાતના ભોજન", "રાત્રિ ભોજન"],
        "lunch": ["दोपहर के खाने", "दोपहर", "બપોરના ભોજન", "બપોરે"],
        "before": ["पहले", "પહેલાં", "પહેલા"], "after": ["बाद", "પછી"],
        "tablet": ["tablets", "गोलियाँ", "गोलियां", "गोली", "टैबलेट्स", "टैबलेट", "ગોળીઓ", "ગોળી", "ટેબ્લેટ્સ", "ટેબ્લેટ"],
        "1": ["one", "एक", "એક"], "2": ["two", "दो", "બે"],
    }
    for normalized, forms in groups.items():
        for form in forms:
            value = re.sub(r"(?<!\w)" + re.escape(form) + r"(?!\w)", normalized, value)
    quantity = r"(\d+)(?:\s*(?:-|to|or|या|અથવા|થી|से)\s*(\d+))?"
    doses = {tuple(sorted((int(low), int(high or low)))) for low, high in re.findall(quantity + r"\s*tablet\b", value)}
    frequency = set(re.findall(r"\b(?:once|twice)\b", value))
    for low, high in re.findall(quantity + r"\s*(?:times?|बार|વાર)(?!\w)", value):
        frequency.update({"1": "once", "2": "twice"}.get(number, number) for number in (low, high or low))
    return {"doses": sorted(doses), "frequency": sorted(frequency),
            "meals": sorted(set(re.findall(r"\b(?:breakfast|lunch|dinner)\b", value))),
            "timing": sorted(set(re.findall(r"\b(?:before|after)\b", value)))}


def ingredient_strength_matches(answer, evidence):
    def amounts(text):
        matches = re.findall(r"([\d,]+(?:\.\d+)?)\s*(milligrams?|mg|मिलीग्राम|मिलिग्राम|મિલિગ્રામ|मि\.?\s*ग्रा\.?|મિ\.?\s*ગ્રા\.?|grams?|g|ग्राम|ગ્રામ)(?!\w)", text.translate(_NATIVE_DIGITS), re.I)
        return {Decimal(number.replace(",", "")) * (1000 if unit.casefold() in {"g", "gram", "grams", "ग्राम", "ગ્રામ"} else 1) for number, unit in matches}
    source_amounts = set().union(*(amounts(entry["text"]) for entry in evidence)) if evidence else set()
    answer_amounts = amounts(answer)
    ingredient = bool(re.search(r"moringa|मोरिंगा|મોરિંગા|મોરીંગા", answer, re.I))
    leaf = bool(re.search(r"leaf|leaves|पत्त|પાન|પાંદ|પર્ણ", answer, re.I))
    return Decimal(500) in source_amounts and answer_amounts == {Decimal(500)} and ingredient and leaf


class ProbeBridge(SunPathBridge):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls = []
        self.case = ""

    async def context(self, context):
        value = await super().context(context)
        value["tools"] = [tool for tool in value["tools"] if tool["name"] in READ_TOOLS]
        # Exercise a retrieval cache miss only inside this probe. Production
        # correctly answers from already-loaded approved KB without a tool.
        # The real search_knowledge endpoint still reads the unmodified KB.
        value["knowledge"] = []
        return value

    async def tool(self, context, *, call_id, name, arguments):
        if name not in READ_TOOLS:
            raise AssertionError("A mutation tool was requested by the synthetic probe")
        started = time.monotonic()
        result = await super().tool(context, call_id=call_id, name=name, arguments=arguments)
        # These arguments are synthetic public-product searches, never a user's
        # personal data. Never serialize authentication, session or tool IDs.
        self.calls.append({"case": self.case, "name": name, "ok": result.get("ok") is True,
                           "duration_ms": round((time.monotonic() - started) * 1000),
                           "query": arguments.get("query") if name == "search_knowledge" else None,
                           "result": result})
        return result


class Events:
    def __init__(self):
        self.tasks = set()
        self.items = []

    async def send(self, kind, **payload):
        self.items.append((kind, payload))


class NoAudioProvider:
    def update_options(self, **options):
        pass


class TextOnlyAgent(EarthoraAgent):
    """Use the real default LLM node without starting a room/audio activity."""
    def __init__(self, *, model, **kwargs):
        session = SimpleNamespace(conn_options=SimpleNamespace(llm_conn_options=APIConnectOptions(max_retry=0, timeout=20)), current_speech=None)
        self.probe_activity = SimpleNamespace(llm=model, session=session)
        super().__init__(**kwargs)

    def _get_activity_or_raise(self):
        return self.probe_activity


async def native_turn(agent, bridge, chat, *, question, case_label):
    """Run the production native node/tools; shared by both opt-in probes."""
    global _last_inference_finished
    bridge.case = case_label
    pacing_started = time.monotonic()
    await asyncio.sleep(max(0.0, MIN_INFERENCE_GAP_SECONDS - (pacing_started - _last_inference_finished)))
    pacing_before_turn_ms = round((time.monotonic() - pacing_started) * 1000)
    events_start, calls_start = len(agent.events.items), len(bridge.calls)
    started = time.monotonic()
    await agent.on_user_turn_completed(None, SimpleNamespace(text_content=question))
    chat.add_message(role="user", content=question)
    tools = list(agent.tools)
    by_name = {tool.info.name: tool for tool in tools}
    answer = ""
    for rounds in range(1, 5):
        pending = []
        text_parts = []
        # Production node buffers, validates and records the response. We do
        # not duplicate its policy or call the LLM through a separate adapter.
        if rounds > 1:
            await asyncio.sleep(max(0.0, MIN_INFERENCE_GAP_SECONDS - (time.monotonic() - _last_inference_finished)))
        method = agent.probe_activity.llm.chat
        count_before = getattr(method, "call_count", None)
        async for chunk in agent.llm_node(chat, tools, None):
            if isinstance(chunk, str):
                text_parts.append(chunk)
            elif isinstance(chunk, llm.ChatChunk) and chunk.delta:
                if chunk.delta.content:
                    raise AssertionError("Unvalidated text escaped the production node")
                for call in chunk.delta.tool_calls:
                    if call.name not in READ_TOOLS or call.name not in by_name:
                        raise AssertionError("The model requested an unadvertised or mutation tool")
                    pending.append(llm.FunctionCall(call_id=call.call_id, name=call.name, arguments=call.arguments))
        count_after = getattr(method, "call_count", None)
        if count_before is None or count_after != count_before:
            _last_inference_finished = time.monotonic()
        if text_parts:
            answer = "".join(text_parts)
            chat.add_message(role="assistant", content=answer)
        if not pending:
            break
        if text_parts:
            raise AssertionError("A tool preamble was spoken before its facts were returned")
        chat.insert(pending)
        outputs = []
        for call in pending:
            args = json.loads(call.arguments or "{}")
            # The real raw-schema handler checks the model call ID against the
            # generating TurnState, validates arguments, then calls the API.
            result = await by_name[call.name](args, SimpleNamespace(function_call=call))
            output = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
            outputs.append(llm.FunctionCallOutput(call_id=call.call_id, name=call.name, output=output, is_error=False))
        chat.insert(outputs)
    else:
        raise AssertionError("Native tool conversation exceeded four read-only rounds")

    return {"answer": answer, "rounds": rounds, "calls": bridge.calls[calls_start:],
            "events": agent.events.items[events_start:], "latency_ms": round((time.monotonic() - started) * 1000),
            "pacing_before_turn_ms": pacing_before_turn_ms}


async def run_case(agent, bridge, chat, *, question, language, inference, expected_conflict=False, scenario="ingredients"):
    inference_start = inference.call_count
    result = await native_turn(agent, bridge, chat, question=question, case_label=language)
    answer, rounds, calls, events = result["answer"], result["rounds"], result["calls"], result["events"]
    searches = [call for call in calls if call["name"] == "search_knowledge"]
    knowledge = [entry for call in searches if call["ok"] for entry in call["result"].get("data", []) if isinstance(entry, dict)]
    product_id = agent.turn.data["catalog"][0]["id"]
    used = [entry for tool in agent.turn.tool_results if tool.get("name") == "search_knowledge" and tool.get("ok")
            for entry in tool.get("data", []) if isinstance(entry, dict)]
    canonical = [entry for entry in used if entry.get("source") == "product_knowledge"]
    categories = {"dosage", "directions"} if scenario == "usage" else {"ingredients"}
    attribute_evidence = [entry for entry in canonical if entry.get("category") in categories]
    expected_usage = usage_details(" ".join(entry["text"] for entry in attribute_evidence)) if scenario == "usage" else None
    spoken_usage = usage_details(answer) if scenario == "usage" else None
    direct_details = (bool(expected_usage["doses"]) and spoken_usage == expected_usage) if scenario == "usage" else ingredient_strength_matches(answer, attribute_evidence)
    query_english = bool(searches) and all(isinstance(call["query"], str) and re.search(r"[A-Za-z]", call["query"]) and not re.search(r"[\u0900-\u0aff]", call["query"]) for call in searches)
    transcripts = [payload for kind, payload in events if kind == "user_transcript"]
    replies = [payload for kind, payload in events if kind == "agent_reply_text"]
    inference_calls = inference.call_count - inference_start
    localized = approved_fact_reply(agent.turn)
    source_bound_localization_used = bool(localized and answer == localized and inference_calls == 0)
    checks = {
        "real_native_read_tool_invoked": bool(calls) and all(call["name"] in READ_TOOLS for call in calls),
        "knowledge_search_executed_this_turn": bool(searches),
        "all_tools_successful": bool(calls) and all(call["ok"] for call in calls),
        "search_queries_are_english": bool(query_english),
        "approved_knowledge_returned": bool(knowledge),
        "canonical_approved_effective_evidence_used": expected_conflict or (bool(attribute_evidence) and all(canonical_metadata_valid(entry, product_id) for entry in canonical)),
        "direct_attribute_details_match_evidence": expected_conflict or direct_details,
        "response_language": agent.turn.language == language and validate_reply(answer, agent.turn) is None,
        "expected_grounded_response": (answer == COPY[language]["conflict"]) if expected_conflict else (bool(answer) and answer not in COPY[language].values()),
        "expected_inference_path": inference_calls == 0 if expected_conflict else (inference_calls > 0 or source_bound_localization_used),
        "no_pipeline_error": not any(kind == "error" for kind, _ in events),
        "production_turn_event_correlation": bool(transcripts and replies) and transcripts[-1]["turn_id"] == replies[-1]["turn_id"],
    }
    # Store only public knowledge titles/fingerprints and the synthetic answer.
    evidence = [{"title": str(entry.get("title", "")), "text_sha256": hashlib.sha256(str(entry.get("text", "")).encode()).hexdigest(),
                 **{field: entry.get(field) for field in ("source", "category", "status", "locale", "version", "approved_at", "effective_from", "effective_until")},
                 "same_catalog_product": entry.get("product_id") == product_id} for entry in used]
    return {"language": language, "scenario": "usage_conflict" if expected_conflict else scenario, "question": question, "reply": answer, "rounds": rounds,
            "qwen_inference_calls": inference_calls, "deterministic_conflict_abstention": expected_conflict,
            "source_bound_localization_used": source_bound_localization_used,
            "latency_ms": result["latency_ms"],
            "rate_limit_wait_before_turn_ms": result["pacing_before_turn_ms"],
            "tools": [{key: value for key, value in call.items() if key not in {"result", "case"}} for call in calls],
            "evidence": evidence, "usage_details": {"approved": expected_usage, "spoken": spoken_usage} if scenario == "usage" else None,
            "checks": checks, "passed": all(checks.values())}


async def run(args):
    key = os.environ.get("EARTHORA_VOICE_INTERNAL_KEY", "")
    channel_key = os.environ.get("VOICE_TEST_CHANNEL_KEY") or os.environ.get("VOICE_PHONE_CHANNEL_KEY", "")
    if not key or not channel_key:
        raise RuntimeError("The private API key and a synthetic test channel key are required")
    endpoint = args.api_url.rstrip("/") + "/api/platform/voice/internal"
    model = build_llm()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=False) as client:
            bridge = ProbeBridge(client, endpoint=endpoint, key=key)
            cases = []
            for language, scenario in (("en", "ingredients"), ("gu", "ingredients"), ("en", "usage"), ("gu", "usage")):
                # Independent cases: a prior language's legitimate tool result
                # must not satisfy this deliberately forced retrieval cache miss.
                context = VoiceContext("sunpath_tools_" + uuid.uuid4().hex, channel_key, language=language)
                initial = await bridge.context(context)
                if not initial["catalog"] or initial["cart"] or initial["checkout"] or initial["history"]:
                    raise AssertionError("Expected a new empty synthetic conversation and a live catalogue")
                initial_business_state = json.dumps({"cart": initial["cart"], "checkout": initial["checkout"]}, sort_keys=True)
                agent = TextOnlyAgent(context=context, bridge=bridge, events=Events(), initial_data=initial, model=model,
                                      stt_provider=NoAudioProvider(), tts_provider=NoAudioProvider(),
                                      end_call=lambda reason: (_ for _ in ()).throw(AssertionError("Unexpected terminal action")))
                product = str(initial["catalog"][0]["name"])
                if scenario == "usage":
                    question = (f"Please search the approved knowledge for {product}'s usage directions and answer briefly in English."
                                if language == "en" else f"કૃપા કરીને {product} કેવી રીતે વાપરવું તેની મંજૂર માહિતી search કરીને શોધો અને ગુજરાતીમાં ટૂંકો જવાબ આપો.")
                else:
                    question = (f"What are the ingredients of {product}? Please search approved knowledge and answer briefly in English."
                                if language == "en" else f"{product} ના ઘટકો શું છે? મંજૂર માહિતી search કરીને ગુજરાતીમાં ટૂંકો જવાબ આપો.")
                with patch.object(model, "chat", wraps=model.chat) as inference:
                    case = await run_case(agent, bridge, agent.chat_ctx.copy(), question=question, language=language, inference=inference, scenario=scenario)
                final = await bridge.context(context)
                case["business_state_unchanged"] = initial_business_state == json.dumps({"cart": final["cart"], "checkout": final["checkout"]}, sort_keys=True)
                case["independent_fresh_conversation"] = True
                case["passed"] = case["passed"] and case["business_state_unchanged"]
                cases.append(case)
                if not case["passed"]:
                    break
            unchanged = bool(cases) and all(case["business_state_unchanged"] for case in cases)
            return {"mode": "synthetic_text_only_native_sdk", "model": os.getenv("AI_LLM_MODEL", "qwen3.5:9b"),
                    "static_knowledge_withheld_in_probe_only": True,
                    "minimum_inference_gap_seconds": MIN_INFERENCE_GAP_SECONDS,
                    "reported_latency_excludes_between_turn_wait": True,
                    "reported_latency_includes_within_turn_model_call_wait": True,
                    "independent_language_cases": True,
                    "read_only_tools": sorted(READ_TOOLS), "business_state_unchanged": unchanged,
                    "cases": cases, "passed": unchanged and len(cases) == 4 and all(case["passed"] for case in cases)}
    finally:
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
        # Provider bodies, keys and identifiers must not enter the report.
        result = {"passed": False, "failure_type": type(error).__name__}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "cases": [{"language": case["language"], "checks": case["checks"], "latency_ms": case["latency_ms"]} for case in result.get("cases", [])], **({"failure_type": result["failure_type"]} if "failure_type" in result else {})}))
    raise SystemExit(0 if result["passed"] else 1)
