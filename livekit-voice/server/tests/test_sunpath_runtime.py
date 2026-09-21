import asyncio
import copy
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
                             compact_knowledge_result, select_knowledge, token_estimate, knowledge_topics,
                             language_request_target)


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


@pytest.mark.parametrize("language,question,draft", [
    ("en", "Do you dispatch daily?", "Orders are delivered across India."),
    ("en", "How do I use checkout?", "I can help you review your cart before checkout."),
    ("gu", "મારે આ લેવું છે.", "તમને કેટલી બોટલ જોઈએ છે?"),
    ("en", "What are its benefits?", "Morilife+ Moringa Leaf Tablets support daily wellness."),
])
def test_buying_delivery_checkout_and_benefits_are_not_dosage_requests(language, question, draft):
    context = [USAGE, {"title": "FAQ", "text": "Moringa Tablets dosage: Take 4 tablets daily. Supports immunity and wellness."},
               {"title": "Shipping policy", "text": "Orders are delivered across India. Free shipping."}]
    state = product_turn(language, question, context)
    assert knowledge_issue(state) is None
    assert validate_reply(draft, state) is None


@pytest.mark.parametrize("language,draft,reason", [
    ("en", "This product does not cure diabetes. Please ask your doctor.", None),
    ("hi", "यह product बीमारी का इलाज नहीं करता। Doctor से पूछें।", None),
    ("en", "I cannot diagnose a medical condition.", None),
    ("en", "It does not cure diabetes, but it treats cancer.", "medical-claim"),
    ("en", "It not only cures diabetes but also prevents cancer.", "medical-claim"),
    ("en", "Please do not share your OTP with me.", None),
    ("hi", "अपना OTP शेयर मत करें।", None),
    ("gu", "તમારો OTP શેર ન કરો.", None),
    ("en", "We never request your OTP.", None),
    ("en", "Do not worry, share your OTP.", "payment-secret"),
    ("en", "Do not share your OTP elsewhere, but give me your OTP.", "payment-secret"),
    ("en", "Please give me your OTP.", "payment-secret"),
])
def test_protective_explanations_are_allowed_but_positive_claims_stay_blocked(language, draft, reason):
    assert validate_reply(draft, product_turn(language, question="Please help")) == reason


@pytest.mark.parametrize("draft,reason", [
    ("It is not intended to cure or treat diabetes. Please ask your doctor about treatment.", None),
    ("This product is not a treatment or cure for diabetes.", None),
    ("It is not intended to cure diabetes, but it treats cancer.", "medical-claim"),
    ("It is not a treatment for diabetes; it cures cancer.", "medical-claim"),
    ("It is not only a treatment; it cures diabetes.", "medical-claim"),
])
def test_explicit_medical_negation_does_not_authorize_later_positive_claim(draft, reason):
    assert validate_reply(draft, product_turn(question="Can it cure diabetes?")) == reason


# Exact excerpts from the captured published Earthora public KB. Their ordering
# reproduces the privacy/marketing noise which previously preceded shipping.
PUBLIC_KB = [
    {"title": PRODUCT["name"], "text": "120 Tablets per Bottle. Rich in antioxidants, vitamins & minerals to support immunity, digestion, energy, skin, hair & overall wellness. Suggested Use: 1–2 tablets once or twice daily, before breakfast or dinner.\nMoringa Leaf Tablets are made from moringa leaves. They are a plant-based wellness product containing antioxidants, vitamins and minerals, intended to support immunity, energy and stamina, healthy digestion, and overall skin, hair and wellness.\nNo. The tablets are high-pressure pressed using 100% pure shade-dried moringa leaf powder, with no synthetic binders, fillers, lubricants, coatings, or magnesium stearate."},
    {"title": "Payments and Orders", "text": "Earthora accepts Credit/Debit Cards, UPI (GPay, PhonePe, Paytm), NetBanking and Razorpay Payment Links across India. Payment is completed securely on a Razorpay link; we never ask for card, CVV, OTP or UPI PIN over chat or call. Once placed, an order cannot be modified or cancelled - email earthorafarms@gmail.com for concerns. Moringa Tablets dosage: 2 tablets before or after lunch and 2 before or after dinner daily with water."},
    {"title": "Privacy Policy", "text": "Fulfilling and delivering your moringa powder and tablet orders via courier partners. Sending order confirmation SMS, WhatsApp payment links, and dispatch tracking alerts via Tata SmartFlow. Preventing fraudulent transactions and ensuring network security."},
    {"title": "Earthora Farms - Our Story and Farm", "text": "Earthora Farms cultivates organic Moringa oleifera on high-altitude volcanic-ash soil in Ooty, Tamil Nadu. Cool mountain breeze, solar radiation and mineral-rich spring water give exceptionally high antioxidants and vitamins."},
    {"title": "Frequently Asked Questions", "text": "Q: Do you offer free shipping across India? A: Yes! We offer free shipping on all orders across Pan-India — any product, any order size, no minimum cart value required.\nQ: How fast will my order arrive? A: All orders are shipped via India Post and delivered across Pan-India within 7–14 business days."},
    {"title": "Shipping and Delivery Policy", "text": "Earthora offers free shipping on all orders across Pan-India with no minimum cart value. Orders ship via India Post and arrive within 7 to 14 business days. We ship only within India; international shipping is not available yet. Courier partners: BlueDart, Delhivery and FedEx. Dispatch tracking alerts are sent via SMS and WhatsApp."},
]


def test_current_public_ingredients_keep_source_words_without_dosage_or_privacy():
    state = product_turn("hi", "इसके ingredients क्या हैं? छोटा जवाब दीजिए।", copy.deepcopy(PUBLIC_KB))
    original = copy.deepcopy(state.data)
    selected = select_knowledge(state)
    assert state.data == original
    assert selected[0]["title"] == PRODUCT["name"]
    assert "made from moringa leaves" in selected[0]["text"]
    assert "no synthetic binders, fillers" in selected[0]["text"]
    assert not any("dosage" in entry["text"] or "Suggested Use" in entry["text"] or "Privacy" in entry["title"] for entry in selected)
    for entry in selected:
        source = next(item["text"] for item in PUBLIC_KB if item["title"] == entry["title"])
        assert all(passage in source for passage in entry["text"].splitlines())


def test_shipping_policy_precedes_faq_and_survives_budget_with_irrelevant_noise():
    knowledge = [copy.deepcopy(PUBLIC_KB[2]) for _ in range(35)] + copy.deepcopy(PUBLIC_KB)
    state = product_turn("hi", "क्या आप रोज़ dispatch करते हैं?", knowledge)
    before = []
    instructions(state.data, "hi", included_knowledge=before)
    assert not any(item["title"] == "Shipping and Delivery Policy" for item in before)
    selected = select_knowledge(state)
    assert selected[0]["title"] == "Shipping and Delivery Policy"
    assert not any(item["title"] == "Privacy Policy" for item in selected)
    visible = []
    prompt = instructions({**state.data, "knowledge": selected}, "hi", included_knowledge=visible)
    assert visible[0]["title"] == "Shipping and Delivery Policy"
    assert "7 to 14 business days" in prompt and token_estimate(prompt) <= 4100
    assert "Transit time does not establish a dispatch calendar" in prompt


def test_selected_ingredients_do_not_erase_original_dose_conflict():
    state = product_turn("en", "What are its ingredients?", copy.deepcopy(PUBLIC_KB))
    state.visible_knowledge = select_knowledge(state)
    state.text = "How should I take Morilife+ Moringa Leaf Tablets?"
    state.visible_knowledge = select_knowledge(state)
    assert knowledge_issue(state) == "conflicting-knowledge"


def test_language_change_and_buy_intent_need_no_static_marketing_context():
    for question in ("Can you speak Gujarati?", "મારે આ લેવું છે.", "Then I speak Hindi."):
        assert select_knowledge(product_turn(question=question, knowledge=PUBLIC_KB)) == []
    company = select_knowledge(product_turn(question="What is orthora?", knowledge=PUBLIC_KB))
    assert [entry["title"] for entry in company] == ["Earthora Farms - Our Story and Farm"]


@pytest.mark.parametrize("language,draft", [
    ("gu", "કયા ઉત્\u0caaાદનું નામ છે?"),
    ("gu", "કયા ઉત્\u0c3eપાદનું નામ છે?"),
    ("en", "The answer is Да."),
    ("hi", "यह product अच्छा है 中।"),
])
def test_foreign_letters_and_vowel_marks_are_rejected_before_speech(language, draft):
    assert validate_reply(draft, product_turn(language, question="Please help")) == "language"


@pytest.mark.parametrize("language,example", [
    ("en", "How many bottles would you like?"),
    ("hi", "आपको कितनी बोतलें चाहिए?"),
    ("gu", "તમને કેટલી બોટલ જોઈએ છે?"),
])
def test_examples_teach_short_local_dialogue_without_business_facts(language, example):
    prompt = instructions({"catalog": [], "knowledge": []}, language)
    assert example in prompt
    assert "patterns only; they supply no business facts" in prompt
    assert "Answer the immediate question first" in prompt


@pytest.mark.parametrize("draft", ["These natural tablets cost ₹1.", "Our organic tablets cost ₹1.", "The current price is ₹1."])
def test_normal_descriptive_price_wording_does_not_invent_a_product(draft):
    assert validate_reply(draft, product_turn(question="What is the price?")) is None


@pytest.mark.parametrize("text,previous,expected", [
    ("कैन यू स्पीक गुजराती", "hi", "gu"),
    ("क्या आप गुजराती बोल सकते हैं", "hi", "gu"),
    ("ગુજરાતીમાં બોલો", "hi", "gu"),
    ("हिंदी में बात करो", "gu", "hi"),
    ("Can you speak Gujarati?", "en", "gu"),
    ("Then I speak Hindi.", "en", "hi"),
    ("अंग्रेजी में बात करो", "gu", "en"),
    ("How are Gujarati farms different?", "en", "en"),
    ("Does your Hindi-speaking team dispatch daily?", "en", "en"),
    ("Does your Hindi team speak to customers?", "en", "en"),
    ("Please speak Gujarati about your team", "en", "gu"),
    ("Thoda fast bolo please", "hi", "hi"),
    ("Slow mat bolo yaar", "hi", "hi"),
    ("Accha price batao", "hi", "hi"),
    ("Kem cho?", "hi", "gu"),
    ("Ketli kimat che?", "hi", "gu"),
])
def test_explicit_switch_wins_over_asr_script_and_natural_transliteration(text, previous, expected):
    assert detect_language(text, previous) == expected


@pytest.mark.parametrize("text,language", [
    ("So... Hong. Can we talk in Hindi?", "hi"),
    ("Um, can, can we talk in Hindi?", "hi"),
    ("ગુજરાતીમાં", "gu"), ("हिंदी में", "hi"),
    ("क्या आप गुजराती में बोल सकती हैं?", "gu"),
    ("હવે ગુજરાતી માં વાત કરો.", "gu"),
    ("શું આપણે ગુજરાતી માં વાત કરી શકીએ?", "gu"),
    ("Gujarati ma bolo please.", "gu"),
    ("गुजराती में जवाब दीजिए", "gu"),
    ("ગુજરાતીમાં જવાબ આપો", "gu"),
    ("Please switch to English", "en"),
])
def test_language_only_target_and_runtime_detection_agree(text, language):
    assert language_request_target(text) == language
    assert detect_language(text, previous="en", detected="en") == language


@pytest.mark.parametrize("text", [
    "Never speak Gujarati", "Please do not speak Hindi", "Can I talk to your Hindi team?",
    "Can you ask your Gujarati staff about shipping?", "Does your Hindi team speak to me?",
])
def test_negation_or_third_party_language_does_not_select_that_target(text):
    assert language_request_target(text) is None
    assert detect_language(text, previous="en") == "en"


@pytest.mark.parametrize("text,language", [("શું?", "gu"), ("કેમ?", "gu"), ("क्या?", "hi")])
def test_short_meaningful_script_still_controls_language(text, language):
    assert detect_language(text, previous="en", detected="en") == language


def test_hindi_style_covers_actual_agreement_failures_without_new_benefit_claims():
    prompt = instructions({"catalog": [], "knowledge": []}, "hi")
    assert "हाँ, मैं हिंदी में बात कर सकती हूँ।" in prompt
    assert "'[product] के फायदे हैं'" in prompt and "feminine first-person" in prompt
    assert "never 'कर सकती हूँ'" in prompt and "हम" in prompt
    assert "familiar technical words in Latin" in prompt
    assert "Grammar examples supply no product claims" in prompt
    assert "No diagnosis, prescription, cure" in prompt


def test_policy_query_does_not_insert_unrequested_product_into_retrieval():
    state = product_turn(question="How fast is shipping?")
    assert knowledge_query(state) == "Earthora shipping delivery policy"


def test_prompt_handles_brand_mishearing_and_language_changes_without_product_pitch():
    prompt = instructions({"catalog": [PRODUCT]}, "en")
    assert "What is orthora?" in prompt and "Do you mean Earthora Farms?" in prompt
    assert "language-change request, acknowledge briefly" in prompt
    assert "never guess that an unfamiliar word means Moringa" in prompt
    assert "For a simple factual question, answer without an automatic sales pitch" in prompt


def test_submission_receipt_requires_durable_success_not_a_failed_or_reviewed_tool():
    state = turn()
    answer = "Your request has been recorded for the team."
    assert validate_reply(answer, state) == "unconfirmed-request"
    state.accept_tool("review_request", {"ok": True, "data": {"recorded": True}})
    assert validate_reply(answer, state) == "unconfirmed-request"
    state.accept_tool("submit_request", {"ok": False, "data": {"recorded": True}})
    assert validate_reply(answer, state) == "unconfirmed-request"
    state.accept_tool("submit_request", {"ok": True, "data": {"recorded": True, "notification_queued": True}})
    assert validate_reply(answer, state) is None
    assert validate_reply("Your WhatsApp message was delivered.", state) == "unsupported-delivery"


def test_navigation_receipt_requires_browser_ack_not_only_server_resolution():
    state = turn()
    answer = "I've opened the products section."
    assert validate_reply(answer, state) == "unconfirmed-navigation"
    state.accept_tool("navigate_site", {"ok": True, "data": {"navigation": {"destination_id": "products"}}})
    assert validate_reply(answer, state) == "unconfirmed-navigation"
    state.accept_tool("navigate_site", {"ok": True, "data": {"navigation": {"destination_id": "products", "acknowledged": True}}})
    assert validate_reply(answer, state) is None


def test_review_keeps_details_and_final_confirmation_question():
    answer = "I have your name as Asha. The callback number is 9000000000. Your request is about wholesale quantities. Shall I submit this to the team?"
    assert bounded_reply(answer, request_review=True) == answer


def test_phone_context_omits_browser_destination_data():
    prompt = instructions({"channel": "phone", "site_guide": [{"id": "private-test-destination", "label": "Unused"}]}, "en")
    assert "private-test-destination" not in prompt
    assert '"channel":"phone"' in prompt


CANONICAL_PRODUCT_ID = "86e093ab-e50e-4ef8-b1b6-5c20873771f0"


def canonical_entry(category, text, **overrides):
    return {"title": PRODUCT["name"], "text": text, "source": "product_knowledge",
            "source_id": "synthetic-" + category, "product_id": CANONICAL_PRODUCT_ID,
            "category": category, "question": None, "locale": "en", "version": 1,
            "status": "approved", "approved_at": "2026-01-01T00:00:00Z",
            "effective_from": None, "effective_until": None, **overrides}


def canonical_turn(question, entries):
    return TurnState("provenance", "en", question, 1,
                     {"catalog": [{**PRODUCT, "id": CANONICAL_PRODUCT_ID}], "knowledge": entries})


def test_exact_approved_ingredient_fact_survives_selection_whole_and_overrides_copied_faq():
    record = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")
    copied = {"title": PRODUCT["name"], "text": "Moringa Leaf Tablets contain 250 mg of moringa leaf powder.", "source": "kb_document"}
    state = canonical_turn("What are its ingredients?", [copied, record])
    before = copy.deepcopy(state.data)
    selected = select_knowledge(state)
    assert selected == [record] and state.data == before
    state.visible_knowledge = selected
    assert knowledge_issue(state) is None
    visible = []
    prompt = instructions({**state.data, "knowledge": selected}, "en", included_knowledge=visible)
    assert "500 mg" in prompt and "250 mg" not in prompt
    assert visible == [record]


@pytest.mark.parametrize("overrides", [
    {"status": "draft"}, {"status": None}, {"status": "archived"},
    {"product_id": "other-product"}, {"product_id": None},
    {"effective_from": "2999-01-01T00:00:00Z"},
    {"effective_until": "2000-01-01T00:00:00Z"},
    {"effective_from": "not-a-date"},
])
def test_invalid_or_inactive_product_record_never_supplies_or_overrides_evidence(overrides):
    record = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.", **overrides)
    state = canonical_turn("What are its ingredients?", [record])
    assert select_knowledge(state) == []
    assert knowledge_issue(state) == "missing-knowledge"
    assert compact_knowledge_result(state, {"ok": True, "data": [record]})["data"] == []
    copied = {"title": PRODUCT["name"], "text": "Moringa Leaf Tablets are made from moringa leaves."}
    state.data["knowledge"].append(copied)
    assert select_knowledge(state) == [copied]


def test_canonical_usage_overrides_copied_dose_but_not_other_attribute():
    record = canonical_entry("dosage", USAGE["text"])
    copied = {"title": PRODUCT["name"], "text": "Moringa Tablets dosage: Take 4 tablets daily. Moringa Leaf Tablets are made from moringa leaves."}
    state = canonical_turn("How should I take Morilife+ Moringa Leaf Tablets?", [copied, record])
    state.visible_knowledge = select_knowledge(state)
    assert state.visible_knowledge == [record]
    assert knowledge_issue(state) is None
    assert validate_reply(USAGE["text"], state) is None
    state.text = "What are its ingredients?"
    selected = select_knowledge(state)
    assert len(selected) == 1 and selected[0].get("source") != "product_knowledge"
    assert selected[0]["text"] == "Moringa Leaf Tablets are made from moringa leaves."


def test_canonical_dosage_and_directions_conflict_even_when_one_is_omitted_or_newer():
    old = canonical_entry("dosage", "Take 1 tablet once daily before breakfast.", version=1)
    newer = canonical_entry("directions", "Take 2 tablets twice daily after dinner.", version=9)
    state = canonical_turn("How should I take Morilife+ Moringa Leaf Tablets?", [old, newer])
    assert select_knowledge(state) == [old, newer]
    state.visible_knowledge = [newer]
    assert knowledge_issue(state) == "conflicting-knowledge"


def test_canonical_same_record_versions_and_faq_answer_disagreements_remain_conflicts():
    first = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")
    second = {**first, "version": 2, "text": "Each tablet contains 600 mg of Moringa Leaf."}
    state = canonical_turn("What are its ingredients?", [first, second])
    assert select_knowledge(state) == [first, second]
    assert knowledge_issue(state) == "conflicting-knowledge"
    question = "Do these tablets contain synthetic binders?"
    first = canonical_entry("faq", "No.", question=question, source_id="first")
    second = canonical_entry("faq", "Yes.", question=question, source_id="second", version=3)
    state = canonical_turn("Do these tablets contain binders?", [first, second])
    assert knowledge_issue(state) == "conflicting-knowledge"


def test_bare_canonical_faq_answer_keeps_question_through_selection_tool_and_prompt():
    record = canonical_entry("faq", "No.", question="Do your pressed tablets contain synthetic binders or magnesium stearate?")
    state = canonical_turn("Do these tablets contain binders?", [record])
    assert select_knowledge(state) == [record]
    result = compact_knowledge_result(state, {"ok": True, "data": [record]})
    assert result["data"] == [record]
    assert knowledge_issue(state) is None
    prompt = instructions({**state.data, "knowledge": select_knowledge(state)}, "en")
    assert record["question"] in prompt and '"text":"No."' in prompt


def test_unrelated_canonical_faq_does_not_override_ingredients_and_benefits_use_category():
    faq = canonical_entry("faq", "No.", question="Is refrigeration required?")
    ingredients = {"title": PRODUCT["name"], "text": "Moringa Leaf Tablets are made from moringa leaves."}
    state = canonical_turn("What are its ingredients?", [faq, ingredients])
    assert select_knowledge(state) == [ingredients]
    benefits = canonical_entry("benefits", "Supports energy and stamina.")
    state = canonical_turn("What are its benefits?", [benefits, ingredients])
    assert select_knowledge(state) == [benefits] and knowledge_issue(state) is None


def test_known_canonical_record_cannot_be_bypassed_by_budget_or_legacy_search_hit():
    record = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")
    copied = {"title": PRODUCT["name"], "text": "Moringa Leaf Tablets contain 250 mg of moringa leaves."}
    state = canonical_turn("What are its ingredients?", [record, copied])
    state.visible_knowledge = [copied]
    assert knowledge_issue(state) == "missing-knowledge"
    assert compact_knowledge_result(state, {"ok": True, "data": [copied]})["data"] == []
    result = compact_knowledge_result(state, {"ok": True, "data": [copied, record]})
    assert result["data"] == [record]
    state.accept_tool("search_knowledge", result)
    assert knowledge_issue(state) is None


def test_independent_canonical_facts_and_equivalent_faq_answers_are_not_conflicts():
    ingredients = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.", source_id="ingredient-weight")
    no_fillers = canonical_entry("ingredients", "Contains no synthetic fillers.", source_id="ingredient-fillers")
    state = canonical_turn("What are its ingredients?", [ingredients, no_fillers])
    assert select_knowledge(state) == [ingredients, no_fillers]
    assert knowledge_issue(state) is None
    first = canonical_entry("benefits", "Supports energy.", source_id="energy")
    second = canonical_entry("benefits", "Supports digestion.", source_id="digestion")
    assert knowledge_issue(canonical_turn("What are its benefits?", [first, second])) is None
    question = "Do the tablets contain synthetic binders?"
    first = canonical_entry("faq", "No.", source_id="answer-a", question=question)
    second = canonical_entry("faq", "No, they contain no synthetic binders.", source_id="answer-b", question=question)
    assert knowledge_issue(canonical_turn(question, [first, second])) is None


def test_provable_strength_disagreement_across_canonical_records_fails_closed():
    first = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.", source_id="weight-a")
    second = canonical_entry("ingredients", "Each tablet contains 600 mg of Moringa Leaf.", source_id="weight-b")
    state = canonical_turn("What are its ingredients?", [first, second])
    assert knowledge_issue(state) == "conflicting-knowledge"


@pytest.mark.parametrize("language,question,correct,wrong", [
    ("en", "What are its ingredients?", "Each tablet contains 500 mg of Moringa Leaf.", "Each tablet contains 1000 mg of Moringa Leaf."),
    ("hi", "इसके ingredients क्या हैं?", "हर टैबलेट में ५०० मिलीग्राम Moringa Leaf है।", "हर टैबलेट में १००० मिलीग्राम Moringa Leaf है।"),
    ("gu", "આના ઘટકો શું છે?", "દરેક ટેબ્લેટમાં ૫૦૦ મિલિગ્રામ Moringa Leaf છે.", "દરેક ટેબ્લેટમાં ૧૦૦૦ મિલિગ્રામ Moringa Leaf છે."),
])
def test_ingredient_strength_is_bound_to_approved_fact_in_all_languages(language, question, correct, wrong):
    record = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")
    state = canonical_turn(question, [record])
    state.language = language
    state.visible_knowledge = select_knowledge(state)
    assert validate_reply(correct, state) is None
    assert validate_reply(wrong, state) == "ungrounded-ingredient-strength"


@pytest.mark.parametrize("draft,reason", [
    ("Each tablet contains 0.5 g of Moringa Leaf.", None),
    ("Each tablet contains 1 gram of Moringa Leaf.", "ungrounded-ingredient-strength"),
    ("Each tablet contains 1,000 mg of Moringa Leaf.", "ungrounded-ingredient-strength"),
    ("Each tablet contains 500 mg of Moringa Leaf. There are 120 tablets in a bottle.", None),
    ("Each tablet contains 500 mg of Moringa Leaf. The bottle net weight is 60 g.", None),
    ("Morilife+ Moringa Leaf Tablets contain 500 mg of Moringa Leaf. The price is ₹1.", None),
])
def test_strength_guard_normalizes_units_without_treating_counts_prices_or_pack_weight_as_strength(draft, reason):
    state = canonical_turn("What are its ingredients?", [canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")])
    assert validate_reply(draft, state) == reason


def test_strength_cannot_borrow_another_products_value_or_a_faq_question_number():
    record = canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")
    state = canonical_turn("What are the ingredients of Morilife+ Moringa Leaf Tablets?", [record])
    state.data["catalog"].append({"id": "other", "name": "Other Herb Capsules", "price": 9})
    assert validate_reply("Other Herb Capsules contain 500 mg of Moringa Leaf.", state) == "ungrounded-ingredient-strength"
    question = canonical_entry("faq", "No.", question="Does each tablet contain 1000 mg of Moringa Leaf?", source_id="faq-weight")
    state.data["knowledge"].append(question)
    assert validate_reply("Each tablet contains 1000 mg of Moringa Leaf.", state) == "ungrounded-ingredient-strength"


def test_nonselected_ingredient_amount_cannot_authorize_the_reply():
    state = canonical_turn("What are its ingredients?", [canonical_entry("ingredients", "Each tablet contains 500 mg of Moringa Leaf.")])
    state.visible_knowledge = []
    assert validate_reply("Each tablet contains 500 mg of Moringa Leaf.", state) == "missing-knowledge"


@pytest.mark.parametrize("draft,reason", [
    ("It cannot cure or treat diabetes. Please consult your doctor.", None),
    ("This product is not intended to diagnose, treat, cure, or prevent any disease.", None),
    ("It does not diagnose, treat, cure or prevent diabetes.", None),
    ("It cannot diagnose, treat, cure, and prevent disease.", None),
    ("It cannot cure diabetes and treats cancer.", "medical-claim"),
    ("It cannot cure and treats cancer.", "medical-claim"),
    ("It cannot cure or treat diabetes, but it prevents cancer.", "medical-claim"),
    ("It is not intended to diagnose, treat, cure, or prevent illness; it cures diabetes.", "medical-claim"),
    ("It cannot cure diabetes and will prevent cancer.", "medical-claim"),
])
def test_negated_medical_verb_lists_end_before_a_new_positive_claim(draft, reason):
    assert validate_reply(draft, product_turn(question="Can it cure diabetes?")) == reason


@pytest.mark.parametrize("draft,reason", [
    ("No, please keep your OTP private and do not share it with anyone.", None),
    ("Keep your OTP and CVV private.", None),
    ("No, please keep your OTP, CVV and UPI PIN private. Never share them with anyone.", None),
    ("Please keep your UPI PIN confidential.", None),
    ("Keep your OTP private. Never share it with me.", None),
    ("Keep your OTP private, but give me your OTP.", "payment-secret"),
    ("Keep your OTP private and give me your CVV.", "payment-secret"),
    ("Keep your OTP private, but send it to me.", "payment-secret"),
    ("Keep your OTP private and share it with me.", "payment-secret"),
    ("Tell me your OTP privately.", "payment-secret"),
    ("Keep your OTP private; provide your UPI PIN.", "payment-secret"),
])
def test_private_credential_advice_does_not_authorize_a_later_request(draft, reason):
    assert validate_reply(draft, product_turn(question="Should I tell you my OTP?")) == reason


@pytest.mark.parametrize("question", ["आपकी प्रदक्ट में क्या है?", "आपके प्रॉडक्ट में क्या होता है?"])
def test_heard_hindi_product_variants_still_select_composition(question):
    assert knowledge_topics(question) == {"ingredients composition"}
    # The same noun inside a cart question must not become product evidence.
    assert not knowledge_topics("मेरे cart में यह प्रदक्ट है, इसमें क्या है?")


@pytest.mark.parametrize("text", [
    "Don't hang up yet", "Do not end the call", "Please don't say goodbye yet",
    "फोन मत रखिए", "कॉल बंद मत करना", "ફોન ના રાખશો", "કૉલ બંધ નહીં કરતા",
])
def test_negated_farewell_does_not_disconnect(text):
    assert not is_farewell(text)


@pytest.mark.parametrize("text", ["Please hang up", "End the call", "bye", "फोन रख दीजिए", "ફોન રાખો"])
def test_affirmative_farewell_still_disconnects(text):
    assert is_farewell(text)


@pytest.mark.parametrize("language,question,draft", [
    ("en", "How many tablets should my child take?", "Give your child 1–2 tablets once or twice daily, before breakfast or dinner."),
    ("hi", "मेरे बेटे को कितनी गोली लेना चाहिए?", "आपके बेटे को रोज़ 1–2 टैबलेट एक बार या दो बार दें, नाश्ते या रात के खाने से पहले।"),
    ("gu", "મારા દીકરાને કેટલી ગોળી લેવી જોઈએ?", "તમારા દીકરાને દરરોજ 1–2 ગોળીઓ એક વાર અથવા બે વાર આપો, નાસ્તા અથવા રાત્રે ભોજન પહેલાં."),
    ("hi", "मुझे शुगर है, कितनी गोली लें?", "रोज़ 1–2 टैबलेट एक बार या दो बार लें, नाश्ते या रात के खाने से पहले।"),
    ("en", "What dosage for my child and what is the price?", "Give your child 1–2 tablets once or twice daily, before breakfast or dinner."),
    ("en", "What dose for my child?", "The product label says your child can take 1–2 tablets once or twice daily, before breakfast or dinner."),
])
def test_general_label_dose_cannot_become_personalized_or_pediatric_advice(language, question, draft):
    state = canonical_turn(question, [canonical_entry("dosage", "Take 1–2 tablets once or twice daily, before breakfast or dinner.")])
    state.language = language
    assert validate_reply(draft, state) == "personalized-directions"


def test_general_label_quote_and_other_compound_answer_remain_available():
    source = "Take 1–2 tablets once or twice daily, before breakfast or dinner."
    state = canonical_turn("My father asked what the label dosage says.", [canonical_entry("dosage", source)])
    assert validate_reply(source, state) is None
    state.text = "What dosage for my child and what is the price?"
    assert validate_reply("I cannot recommend a dose for your child. Please ask a qualified doctor.", state) is None
    assert validate_reply("The product label says take 1–2 tablets once or twice daily, before breakfast or dinner. Ask a qualified doctor about suitability for children.", state) is None
    # A literal general label quote without applying it to a person stays valid.
    assert validate_reply("The product label says take 1–2 tablets once or twice daily, before breakfast or dinner.", state) is None
