"""Exact public approved records; no network, live tools, or model inference."""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_fact_localizations import (DOSAGE_SHA, DIRECTIONS_SHA, INGREDIENTS_SHA,
                                       approved_fact_reply, source_sha256)
from sunpath_runtime import TurnState, bounded_reply, knowledge_topics, validate_reply

PRODUCT = {"id": "86e093ab-e50e-4ef8-b1b6-5c20873771f0", "name": "Morilife+ Moringa Leaf Tablets"}
SOURCES = {
    "ingredients": "Each tablet contains 500 mg of Moringa Leaf.",
    "dosage": "Suggested use: Take 1–2 tablets once or twice daily, before breakfast or dinner. Follow the product label. If you have a health condition, take regular medicines, or are unsure about the right amount, consult a doctor.",
    "directions": "Take the tablets with water. Use them according to the suggested use on the product label: 1–2 tablets once or twice daily, before breakfast or dinner.",
}


def record(category, **updates):
    return {"title": PRODUCT["name"], "text": SOURCES[category], "source": "product_knowledge",
            "source_id": "approved-" + category, "product_id": PRODUCT["id"], "category": category,
            "question": "", "locale": "en-IN", "version": 2, "status": "approved",
            "approved_at": "2026-09-09T00:00:00Z", "effective_from": "2026-09-09T00:00:00Z",
            "effective_until": None, **updates}


def make_turn(language="gu", categories=("ingredients",), question=None):
    question = question or ("What are the ingredients?" if categories == ("ingredients",) else "How should I take these tablets?")
    state = TurnState("synthetic", language, question, 1,
                      {"catalog": [copy.deepcopy(PRODUCT)], "knowledge": [record(category) for category in categories]})
    state.visible_knowledge = copy.deepcopy(state.data["knowledge"])
    return state


@pytest.mark.parametrize("category,digest", [("ingredients", INGREDIENTS_SHA), ("dosage", DOSAGE_SHA), ("directions", DIRECTIONS_SHA)])
def test_cache_binds_full_current_source(category, digest):
    assert source_sha256(SOURCES[category]) == digest
    assert source_sha256(" \n" + SOURCES[category].replace(" ", "  ") + " \t") == digest
    assert source_sha256(SOURCES[category] + " Changed.") != digest


@pytest.mark.parametrize("language", ["hi", "gu"])
@pytest.mark.parametrize("categories", [("ingredients",), ("dosage",), ("directions",), ("dosage", "directions")])
def test_faithful_translation_passes_unchanged_business_guard(language, categories):
    state = make_turn(language, categories)
    before = copy.deepcopy(state.data)
    reply = approved_fact_reply(state)
    assert reply and len(reply.split()) <= 70
    assert bounded_reply(reply) == reply
    assert validate_reply(reply, state) is None
    assert state.data == before
    if "ingredients" in categories:
        assert "500" in reply and "Moringa Leaf" in reply
    else:
        assert "1–2" in reply and "Product label" in reply
        for phrase in ({"hi": ["एक बार या दो बार", "नाश्ते", "रात के खाने", "पहले"],
                        "gu": ["એક વાર અથવા બે વાર", "નાસ્તા", "રાત્રે ભોજન", "પહેલાં"]}[language]):
            assert phrase in reply
    if "dosage" in categories:
        for phrase in ({"hi": ["health condition", "नियमित दवाइयाँ", "संदेह", "doctor"],
                        "gu": ["સ્વાસ્થ્ય સમસ્યા", "નિયમિત દવાઓ", "ખાતરી ન હોય", "doctor"]}[language]):
            assert phrase in reply
    if "directions" in categories:
        assert ("पानी" if language == "hi" else "પાણી") in reply


@pytest.mark.parametrize("language,question", [
    ("hi", "आपके product में क्या है?"), ("hi", "इसमें क्या है?"), ("hi", "इसमें क्या होता है?"),
    ("hi", "आपकी प्रदक्ट में क्या है?"), ("hi", "आपके प्रॉडक्ट में क्या है?"),
    ("gu", "તમારા product માં શું છે?"), ("gu", "આમાં શું છે?"), ("gu", "આમાં શું હોય છે?"),
])
def test_natural_composition_questions_use_current_product_evidence(language, question):
    assert knowledge_topics(question) == {"ingredients composition"}
    assert approved_fact_reply(make_turn(language, question=question))


@pytest.mark.parametrize("question", ["मेरे cart में क्या है?", "मेरे order में क्या है?", "કાર્ટમાં શું છે?", "ઓર્ડરમાં શું છે?", "मेरे cart की बात है, इसमें क्या है?", "મારા કાર્ટ વિશે પૂછું છું, આમાં શું છે?"])
def test_cart_and_order_contents_are_not_product_composition(question):
    assert not knowledge_topics(question)
    assert approved_fact_reply(make_turn(question=question)) is None


@pytest.mark.parametrize("question", [
    "What ingredients and binders are in this?", "What ingredients and caffeine are in this?",
    "What are the ingredients and benefits?", "What are the ingredients and price?",
    "इसमें क्या है और इसकी कीमत क्या है?", "આમાં શું છે અને શું ફાયદા છે?",
    "How should I take tablets during pregnancy?", "How should I take tablets if I have diabetes?",
    "How many tablets for children?", "मुझे बीमारी है, कितनी गोली लें?",
    "ગર્ભાવસ્થા દરમિયાન કેવી રીતે લેવું?", "મને સ્વાસ્થ્ય સમસ્યા છે, કેવી રીતે લેવું?",
    "Should I take 4 tablets daily?", "Does each tablet contain 1000 mg?",
])
def test_compound_faq_and_personal_health_queries_stay_with_guarded_workflow(question):
    state = make_turn(categories=("ingredients", "dosage", "directions"), question=question)
    assert approved_fact_reply(state) is None


@pytest.mark.parametrize("language,question", [
    ("hi", "मेरे बेटे को कितनी गोली लेना चाहिए?"),
    ("hi", "मेरी बेटी को कितनी गोली दें?"),
    ("hi", "मेरे पिता कितनी गोली लें?"),
    ("hi", "मुझे शुगर है, कितनी गोली लें?"),
    ("hi", "मुझे दमा है, कितनी गोली लें?"),
    ("gu", "મારા દીકરાને કેટલી ગોળી લેવી જોઈએ?"),
    ("gu", "મારી દીકરીને કેટલી ગોળી લેવી જોઈએ?"),
    ("gu", "મારા પિતાએ કેટલી ગોળી લેવી જોઈએ?"),
    ("gu", "મને શુગર છે, કેટલી ગોળી લેવી જોઈએ?"),
    ("gu", "મને મધુમેહ છે, કેવી રીતે લેવું?"),
    ("hi", "How should a child take these tablets?"),
    ("gu", "What is the dosage for my son?"),
    ("hi", "What dose can my daughter take?"),
    ("gu", "What dosage for my father with asthma?"),
])
def test_personal_family_and_colloquial_condition_queries_do_not_get_generic_dose(language, question):
    state = make_turn(language, ("dosage", "directions"), question)
    assert knowledge_topics(question) == {"usage directions"}
    assert approved_fact_reply(state) is None


@pytest.mark.parametrize("updates", [
    {"text": SOURCES["ingredients"].replace("500", "600")}, {"status": "revoked"},
    {"product_id": "another-product"}, {"effective_until": "2020-01-01T00:00:00Z"},
    {"effective_from": "2099-01-01T00:00:00Z"}, {"locale": "gu-IN"},
    {"source": "kb_document"}, {"source_id": ""}, {"question": "A different source question"},
])
def test_unknown_or_ineligible_source_never_reuses_translation(updates):
    state = make_turn()
    state.data["knowledge"] = [record("ingredients", **updates)]
    state.visible_knowledge = copy.deepcopy(state.data["knowledge"])
    assert approved_fact_reply(state) is None


def test_conflicting_current_versions_do_not_choose_the_cached_one():
    state = make_turn()
    state.data["knowledge"].append(record("ingredients", source_id="new-version", version=3,
                                           text=SOURCES["ingredients"].replace("500", "1000")))
    state.visible_knowledge = copy.deepcopy(state.data["knowledge"])
    assert approved_fact_reply(state) is None


def test_changed_caveat_or_unknown_complementary_record_requires_normal_workflow():
    state = make_turn(categories=("dosage", "directions"))
    state.data["knowledge"][0]["text"] += " Ask the team for more details."
    state.visible_knowledge = copy.deepcopy(state.data["knowledge"])
    assert approved_fact_reply(state) is None
    state = make_turn()
    state.data["knowledge"].append(record("ingredients", source_id="extra", text="The product also contains another approved ingredient."))
    state.visible_knowledge = copy.deepcopy(state.data["knowledge"])
    assert approved_fact_reply(state) is None


def test_missing_visible_dosage_caveat_never_yields_directions_only():
    state = make_turn(categories=("dosage", "directions"))
    state.visible_knowledge = [record("directions")]
    assert approved_fact_reply(state) is None


def test_cache_miss_needs_actual_successful_retrieval_before_localizing():
    state = make_turn()
    state.data["knowledge"] = []
    state.visible_knowledge = []
    assert approved_fact_reply(state) is None
    state.accept_tool("search_knowledge", {"ok": False, "data": [record("ingredients")]})
    assert approved_fact_reply(state) is None
    state.accept_tool("search_knowledge", {"ok": True, "data": [record("ingredients")]})
    assert approved_fact_reply(state)


def test_english_and_ambiguous_product_requests_remain_model_driven():
    assert approved_fact_reply(make_turn("en")) is None
    state = make_turn()
    state.data["catalog"].append({"id": "other", "name": "Another product"})
    assert approved_fact_reply(state) is None
