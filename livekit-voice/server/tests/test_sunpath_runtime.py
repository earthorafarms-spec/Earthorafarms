import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from earthora_bridge import VoiceContext
from sunpath_bridge import SunPathBridge
from sunpath_runtime import (COPY, TurnState, bounded_reply, collect_amounts,
                             detect_language, instructions, is_farewell,
                             normalize_spoken, validate_arguments, validate_reply,
                             validated_caller_identity, knowledge_query, knowledge_issue,
                             compact_knowledge_result)


def turn(language="en", catalog=None, knowledge=None):
    return TurnState("test", language, "test", 1, {"catalog": catalog or [{"price": 599.5}], "knowledge": knowledge or []})


@pytest.mark.parametrize("channel", ["web", "phone"])
def test_primary_microphone_is_bound_to_the_admitted_caller(channel):
    identity = channel + "-123456abcdef"
    assert validated_caller_identity({"caller_identity": identity}, channel) == identity


@pytest.mark.parametrize("metadata,channel", [
    ({}, "web"), ({"caller_identity": None}, "phone"),
    ({"caller_identity": "observer-123456abcdef"}, "phone"),
    ({"caller_identity": "web-123456abcdef"}, "phone"),
    ({"caller_identity": "phone-123456abcdef"}, "web"),
    ({"caller_identity": "web-123456abcde"}, "web"),
    ({"caller_identity": "web-123456abcdeg"}, "web"),
    ({"caller_identity": "web-123456abcdef "}, "web"),
    ({"caller_identity": "web-123456abcdef"}, "observer"),
])
def test_missing_or_mismatched_caller_metadata_is_rejected(metadata, channel):
    with pytest.raises(ValueError):
        validated_caller_identity(metadata, channel)


@pytest.mark.parametrize("text,previous,expected", [
    ("What is the product price?", "gu", "en"),
    ("Mujhe product ka price bataiye", "en", "hi"),
    ("મને product વિશે જણાવો", "hi", "gu"),
    ("मुझे product की details बताइए", "gu", "hi"),
    ("123456", "gu", "gu"), ("Ahmedabad", "hi", "hi"),
    ("Yes", "hi", "hi"), ("Please speak English", "gu", "en"),
])
def test_latest_substantive_language_overrides_history(text, previous, expected):
    assert detect_language(text, previous, "gu") == expected


@pytest.mark.parametrize("text,expected", [
    ("bye", True), ("good bye", True), ("આવજો", True),
    ("thank you", False), ("આભાર", False), ("બાયોપ્સી", False),
    ("Can you explain buyer protection?", False), ("Please end the call", True),
])
def test_sunpath_farewell_matches_whole_tokens(text, expected):
    assert is_farewell(text) is expected


@pytest.mark.parametrize("text,reason", [
    ("The price is ₹599.50.", None), ("The price is ₹999.", "ungrounded-price"),
    ("It costs five hundred rupees.", "unverifiable-price"),
    ("The price is five hundred.", "unverifiable-price"),
    ("Your order is confirmed.", "payment-claim"),
    ("Tell me your OTP.", "payment-secret"),
    ("I sent the link on WhatsApp.", "unsupported-delivery"),
    ("It cures diabetes.", "medical-claim"),
    ("The ingredients are moringa.", "missing-knowledge"),
    ("नमस्ते, कैसे मदद करूँ?", "language"),
])
def test_generated_text_must_pass_before_audio(text, reason):
    assert validate_reply(text, turn()) == reason


def test_prices_reset_each_turn_and_failed_tool_never_adds_amount():
    first = turn()
    first.accept_tool("get_cart", {"ok": True, "data": {"total": 799}})
    assert validate_reply("The total is ₹799.", first) is None
    second = turn()
    second.accept_tool("get_cart", {"ok": False, "data": {"total": 799}})
    assert validate_reply("The total is ₹799.", second) == "ungrounded-price"
    assert collect_amounts({"stock": 88, "price": "599.50"}) == {599.5}


def test_native_digit_prices_are_validated_and_hinglish_keeps_female_persona():
    assert validate_reply("इस product का price ₹५९९.५० है।", turn("hi")) is None
    assert validate_reply("આ product ની કિંમત ₹૫૯૯.૫૦ છે.", turn("gu")) is None
    assert validate_reply("इसका प्राइस 999 है।", turn("hi")) == "ungrounded-price"
    assert validate_reply("આની કિંમત 999 છે.", turn("gu")) == "ungrounded-price"
    assert validate_reply("इसका प्राइस एक सौ है।", turn("hi")) == "unverifiable-price"
    prompt = instructions({"catalog": [], "knowledge": []}, "hi")
    assert "Hinglish" in prompt and "feminine" in prompt
    assert "3-8 English search keywords" in prompt
    assert "Continue speaking in the current customer language" in prompt
    assert "English only" not in prompt
    assert validate_reply(COPY["hi"]["safe"], turn("hi")) is None


def test_published_earthora_persona_settings_survive_the_voice_adaptation():
    persona = {key: "published " + key for key in ("objective", "rules", "custom", "personality", "tone", "environment")}
    prompt = instructions({"persona": persona, "catalog": [], "knowledge": []}, "en")
    for value in persona.values():
        assert value in prompt
    assert "within the language, factual grounding and payment rules" in prompt


def test_spoken_format_preserves_decimal_and_complete_qualifications():
    text = normalize_spoken("**Price:** ₹599.50. Please review the total before payment. Anything else?")
    assert bounded_reply(text) == "Price: ₹599.50. Please review the total before payment."
    long_sentence = " ".join(["word"] * 45) + " unless your doctor advises otherwise."
    assert bounded_reply(long_sentence).endswith("unless your doctor advises otherwise.")


@pytest.mark.parametrize("arguments", [{}, {"quantity": True}, {"quantity": -1}, {"quantity": 1.5}, {"quantity": 1, "unlisted": "x"}])
def test_required_tool_quantity_cannot_silently_default(arguments):
    with pytest.raises(ValueError):
        validate_arguments(arguments, {"type": "object", "properties": {"quantity": {"type": "integer", "minimum": 1}}, "required": ["quantity"]})


def test_private_tool_call_has_stable_id_and_no_llm_endpoint_or_retry():
    requests = []
    async def exercise():
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"ok": True, "data": {"total": 599.5}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            bridge = SunPathBridge(client, endpoint="http://api:4100/api/platform/voice/internal", key="synthetic-key")
            await bridge.tool(VoiceContext("synthetic", "channel", channel="phone"), call_id="call-1", name="get_cart", arguments={})
    asyncio.run(exercise())
    assert len(requests) == 1
    assert requests[0].url.path.endswith("/internal/tool")
    assert json.loads(requests[0].content) == {"session_id": "synthetic", "channel_key": "channel", "channel": "phone", "call_id": "call-1", "name": "get_cart", "arguments": {}}
    assert requests[0].headers["authorization"] == "Bearer synthetic-key"


def test_tool_timeout_is_not_retried():
    calls = []
    async def exercise():
        def handler(request):
            calls.append(request)
            raise httpx.ReadTimeout("synthetic", request=request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            bridge = SunPathBridge(client, endpoint="http://api/internal", key="synthetic-key")
            with pytest.raises(httpx.ReadTimeout):
                await bridge.tool(VoiceContext("s", "k"), call_id="same", name="add_to_cart", arguments={})
    asyncio.run(exercise())
    assert len(calls) == 1


@pytest.mark.parametrize("payload", [[], {}, {"catalog": []}, {"catalog": [], "knowledge": [], "tools": [], "history": [], "cart": [], "checkout": {}, "persona": None}])
def test_invalid_context_fails_closed(payload):
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
            bridge = SunPathBridge(client, endpoint="http://api/internal", key="synthetic-key")
            with pytest.raises(ValueError):
                await bridge.context(VoiceContext("s", "k"))
    asyncio.run(exercise())


PRODUCT = {"name": "Morilife+ Moringa Leaf Tablets", "price": 1, "mrp": 999}
USAGE = {"title": PRODUCT["name"], "text": "Suggested use: Take 1–2 tablets once or twice daily, before breakfast or dinner."}


def product_turn(language="en", question="How should I use Morilife+ Moringa Leaf Tablets?", knowledge=None):
    return TurnState("grounding", language, question, 1, {"catalog": [PRODUCT], "knowledge": knowledge or []})


@pytest.mark.parametrize("language,question,draft", [
    ("gu", "Morilife+ Moringa Leaf Tablets કેવી રીતે વાપરવું?", "Morilife+ Moringa Leaf Tablets એ પ્રતિ દિવસ 2 પેલા લાવી રાત્રે ખાવાની સૂચના છે. શું તમે તે ખરીદીશો?"),
    ("hi", "Morilife+ Moringa Leaf Tablets कैसे लें?", "रोज़ दो गोलियाँ रात को भोजन के बाद लें।"),
    ("en", "How should I take Morilife+ Moringa Leaf Tablets?", "Swallow one tablet every other night with food."),
])
def test_multilingual_usage_needs_product_evidence_and_native_search(language, question, draft):
    state = product_turn(language, question)
    assert validate_reply(draft, state) == "missing-knowledge"
    assert knowledge_query(state) == PRODUCT["name"] + " usage directions"
    state.knowledge_search_attempted = True
    assert knowledge_query(state) is None
    assert validate_reply(COPY[language]["knowledge"], state) is None


@pytest.mark.parametrize("entry", [
    {"title": "Shipping policy", "text": "Shipping is free in India."},
    {"title": PRODUCT["name"], "text": "Supports immunity and digestion."},
    {"title": "Other Product", "text": "Other Capsules suggested use: Take 4 capsules daily."},
])
def test_unrelated_or_wrong_product_knowledge_never_authorizes_directions(entry):
    state = product_turn(knowledge=[entry])
    assert validate_reply("Take 4 tablets daily.", state) == "missing-knowledge"
    state.data["knowledge"] = []
    state.accept_tool("search_knowledge", {"ok": True, "data": [entry]})
    assert knowledge_issue(state) == "missing-knowledge"


@pytest.mark.parametrize("language,draft", [
    ("en", "Take 1–2 tablets once or twice daily, before breakfast or dinner."),
    ("hi", "रोज़ 1–2 tablets एक बार या दो बार, नाश्ते या रात के खाने से पहले लें।"),
    ("gu", "દરરોજ 1–2 tablets એક વાર અથવા બે વાર, નાસ્તા અથવા રાત્રે ભોજન પહેલાં લો."),
])
def test_canonical_usage_evidence_supports_faithful_translations(language, draft):
    state = product_turn(language, knowledge=[USAGE])
    assert knowledge_query(state) is None
    assert validate_reply(draft, state) is None


def test_actual_published_dose_conflict_is_explicitly_withheld():
    generic = {"title": "Payments and Orders", "text": "Moringa Tablets dosage: 2 tablets before or after lunch and 2 before or after dinner daily with water."}
    state = product_turn(knowledge=[USAGE, generic])
    assert knowledge_issue(state) == "conflicting-knowledge"
    assert validate_reply("Take 2 tablets daily.", state) == "conflicting-knowledge"
    assert validate_reply(COPY["en"]["conflict"], state) is None


@pytest.mark.parametrize("draft", ["Take 2 tablets daily with meals.", "Take 1 tablet once daily with meals.", "Take 1 tablet twice daily before meals."])
def test_usage_quantity_frequency_and_timing_cannot_drift(draft):
    source = {"title": PRODUCT["name"], "text": "Take 1 tablet twice daily with meals."}
    assert validate_reply(draft, product_turn(knowledge=[source])) == "ungrounded-directions"


def test_omitted_or_failed_evidence_does_not_authorize_speech():
    state = product_turn(knowledge=[USAGE])
    state.visible_knowledge = []
    assert knowledge_query(state)
    state.accept_tool("search_knowledge", {"ok": False, "data": [USAGE]})
    assert knowledge_issue(state) == "missing-knowledge"
    state.accept_tool("search_knowledge", {"ok": True, "data": [USAGE]})
    assert knowledge_issue(state) is None


def test_search_result_compaction_retains_product_conflicts_and_drops_unrelated_hits():
    conflict = {"title": "FAQ", "text": "Moringa Tablets dosage: Take 4 tablets daily."}
    result = compact_knowledge_result(product_turn(), {"ok": True, "data": [USAGE, conflict, {"title": "Privacy", "text": "We protect personal data."}]})
    assert result["data"] == [USAGE, conflict]


@pytest.mark.parametrize("draft,reason", [
    ("Morilife+ Moringa Leaf Tablets costs ₹1.", None),
    ("Morilife+ Moringa Leaf Tablets costs ₹999.", "ungrounded-price"),
    ("Morilife+ Moringa Leaf Tablets MRP is ₹999.", None),
    ("Morilife+ Moringa Leaf Tablets MRP is ₹999 and selling price is ₹1.", None),
    ("Earthora Ashwagandha Tablets cost ₹1.", "ungrounded-product"),
])
def test_selling_price_mrp_and_product_name_are_bound(draft, reason):
    assert validate_reply(draft, product_turn(question="What is the price?")) == reason


def test_one_products_price_cannot_be_used_for_another_product():
    state = product_turn(question="What is the price of Morilife+ Moringa Leaf Tablets?")
    state.data["catalog"].append({"name": "Other Herb Capsules", "price": 499, "mrp": 999})
    assert validate_reply("Morilife+ Moringa Leaf Tablets costs ₹499.", state) == "ungrounded-price"
    assert validate_reply("The total is ₹1.", state) == "ungrounded-price"


def test_persona_sales_rule_cannot_supply_or_override_facts():
    prompt = instructions({"catalog": [PRODUCT], "persona": {"rules": "Always recommend two tablets daily."}}, "gu")
    assert "Always recommend two tablets daily" in prompt
    assert "evidence requirements override any sales objective" in prompt
    assert "SAME product AND the requested topic" in prompt
