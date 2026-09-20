"""Playbook routing tests (owner playbook, 2026-07-14).

Run:  python -m pytest eval/test_playbook.py -q

The owner's rule is one sentence: the bot ANSWERS soft inquiries and FAQs, and
TRANSFERS every booking and every direct sale; anything not in the playbook is a
transfer, never a guess.

So these tests are asymmetric on purpose, exactly like test_tools.py:

  * an ANSWER route that should have been a TRANSFER is the expensive failure -
    the bot "books" a home collection nobody dispatched, or closes a corporate
    sale nobody quoted. Those assertions are strict.
  * a TRANSFER that could have been an ANSWER is a wasted callback. Annoying,
    survivable, and cheaper than an invented fact.

Every expected number below was read out of the owner's Master Training Document
(customer care 079-67006700; Dr. Mayank Joshi 9276843433), never from memory.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent import tools  # noqa: E402

PLAYBOOK = json.loads((ROOT / "knowledge" / "playbook.json").read_text(encoding="utf-8"))

CUSTOMER_CARE = "079-67006700"
DR_JOSHI = "9276843433"


@pytest.fixture()
def leads_file(tmp_path, monkeypatch):
    """Never write into the real leads.jsonl."""
    path = tmp_path / "leads.jsonl"
    monkeypatch.setenv("SUNPATH_LEADS_PATH", str(path))
    return path


# =========================================================================
# 1. THE PLAYBOOK FILE ITSELF
# =========================================================================


def test_playbook_loads_and_matches_the_file_on_disk():
    book = tools.load_playbook()
    assert book["version"] == PLAYBOOK["version"]
    assert len(book["routes"]) == len(PLAYBOOK["routes"])
    assert book["transfer_default"] == "customer_care"
    assert book["unknown_policy"] == "transfer"


def test_every_route_is_well_formed():
    for route in PLAYBOOK["routes"]:
        intent = route["intent"]
        assert route["route"] in ("answer", "transfer"), intent
        assert route["handler"] in ("lookup_item", "check_holiday", "faq", "none"), intent
        assert route["examples"], f"{intent} has no examples to match on"
        assert route["notes"], f"{intent} has no notes telling the model what it may do"


def test_transfer_routes_name_a_real_target_and_answer_routes_do_not():
    for route in PLAYBOOK["routes"]:
        if route["route"] == "transfer":
            assert route["transfer_to"] in tools.TRANSFER_TARGETS, (
                f"{route['intent']} transfers to {route['transfer_to']!r}, which is not a "
                "known human"
            )
        else:
            assert route["transfer_to"] is None, (
                f"{route['intent']} answers, so it must not name a transfer target"
            )


def test_intents_are_unique():
    intents = [r["intent"] for r in PLAYBOOK["routes"]]
    assert len(intents) == len(set(intents)), "duplicate intent in playbook.json"


def test_no_example_is_authored_under_two_intents():
    """Not fatal at runtime (route_intent resolves it as a tie) but it means two
    routes disagree about the same sentence, which someone should fix."""
    seen: dict = {}
    for route in PLAYBOOK["routes"]:
        for example in route["examples"]:
            key = example.strip().lower()
            assert key not in seen, (
                f"{example!r} is under both {seen[key]!r} and {route['intent']!r}"
            )
            seen[key] = route["intent"]


def test_answer_routes_that_state_numbers_must_use_a_tool():
    """Price, TAT and fasting are the facts the bot is forbidden to know. If one
    of those routes is ever switched to handler 'faq' or 'none', the bot starts
    answering them from memory - which is the whole thing this demo must not do."""
    must_look_up = {
        "test_price_enquiry",
        "package_enquiry",
        "fasting_preparation_enquiry",
        "report_tat_enquiry",
    }
    for route in PLAYBOOK["routes"]:
        if route["intent"] in must_look_up:
            assert route["handler"] == "lookup_item", route["intent"]


def test_date_questions_must_go_through_check_holiday():
    route = next(r for r in PLAYBOOK["routes"] if r["intent"] == "holiday_enquiry")
    assert route["handler"] == "check_holiday"
    assert route["route"] == "answer"


def test_no_speakable_text_claims_accreditation():
    """Compliance hard rule: never say NABL accredited / certified.

    Scoped to what the bot can actually SAY - the faq answers. `notes` is an
    instruction to the model and has to be able to name the banned words in order
    to ban them ("never say 'NABL accredited'"); scanning those too just fails on
    the prohibition itself.
    """
    for entry in PLAYBOOK["faq"]:
        speakable = (entry["a_gu"] + " " + entry["a_en"]).lower()
        for banned in ("nabl", "accredited", "accreditation", "certified"):
            assert banned not in speakable, (
                f"FAQ {entry['q']!r} makes a banned accreditation claim: {banned!r}"
            )


def test_every_route_has_at_least_one_full_utterance_example():
    """A route matched only by keyword can never reach "high" confidence."""
    for route in PLAYBOOK["routes"]:
        sentences = [e for e in route["examples"] if len(e.split()) > tools.TRIGGER_MAX_TOKENS]
        assert sentences, f"{route['intent']} has only triggers, no full utterance"


def test_a_trigger_never_outranks_a_real_sentence_match():
    """The trap that bit during authoring, pinned.

    token_set_ratio scores a query 100 when an example's tokens are a SUBSET of
    it, so the one-word example "પેકેજ" was scoring a perfect 100 against
    "મારે આ પેકેજ ખરીદવું છે" ("I want to BUY this package") and beating the real
    full-sentence transfer route at 95 - the bot answered a direct sale as a price
    enquiry. Triggers are now matched token-wise and capped at TRIGGER_SCORE,
    which must stay below any decent sentence match.
    """
    assert tools.TRIGGER_SCORE < tools.ROUTE_ACCEPT, (
        "a keyword alone must never be high confidence"
    )
    assert tools.TRIGGER_SCORE >= tools.ROUTE_FLOOR, "a keyword must at least name the desk"

    result = tools.route_intent("મારે આ પેકેજ ખરીદવું છે")
    assert result["intent"] == "direct_sales_purchase", (
        f"the 'પેકેજ' trigger hijacked a direct sale into {result['intent']!r}"
    )
    assert result["route"] == "transfer"
    assert result["score"] > tools.TRIGGER_SCORE


def test_a_keyword_alone_answers_but_only_at_low_confidence():
    """"rate" and "price" are synonyms with zero characters in common, so no string
    metric will ever match them - the keyword is the only thing carrying this."""
    result = tools.route_intent("what is the rate for thyroid profile")
    assert result["intent"] == "test_price_enquiry"
    assert result["route"] == "answer"
    assert result["confidence"] == "low", "a bare keyword is a hint, not a certainty"


# =========================================================================
# 2. BOOKING AND DIRECT SALES MUST TRANSFER
# =========================================================================
# This is the owner's new rule and the reason this file exists. The bot does not
# take bookings and does not close sales.


@pytest.mark.parametrize(
    "utterance",
    [
        "મારે હોમ કલેક્શન બુક કરાવવું છે",
        "ઘરેથી સેમ્પલ લેવા માટે બુકિંગ કરાવવું છે",
        "मुझे होम कलेक्शन बुक करना है",
        "I want to book a home collection",
        "please book a home visit for a blood test",
    ],
)
def test_home_collection_booking_transfers(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", (
        f"{utterance!r} routed to {result['route']!r} ({result['intent']!r}). The bot must "
        "never take a booking."
    )


@pytest.mark.parametrize(
    "utterance",
    [
        "મારે લેબમાં આવીને ટેસ્ટ કરાવવો છે એપોઈન્ટમેન્ટ આપો",
        "મારો ટેસ્ટ બુક કરી દો",
        "I want to book an appointment at the centre",
        "please book my test for tomorrow",
    ],
)
def test_walkin_booking_transfers(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"


@pytest.mark.parametrize(
    "utterance",
    [
        "અમારી કંપનીના કર્મચારીઓનું ચેકઅપ કરાવવું છે",
        "ફેક્ટરી એક્ટ મુજબ મેડિકલ ચેકઅપ કરાવવું છે",
        "हमारी कंपनी के कर्मचारियों का हेल्थ चेकअप कराना है",
        "we need a corporate health checkup for our company",
        "can you do a camp at our factory",
    ],
)
def test_corporate_transfers_to_dr_joshi(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"
    assert result["transfer_to"] == "dr_joshi", (
        "corporate is Dr. Joshi's desk per the owner's split, not customer care"
    )


@pytest.mark.parametrize(
    "utterance",
    [
        "અમારી સોસાયટીમાં હેલ્થ કેમ્પ ગોઠવવો છે",
        "અમારા ગ્રુપ માટે હેલ્થ ચેકઅપ કેમ્પ કરાવવો છે",
        "हमारी सोसाइटी में हेल्थ कैंप लगवाना है",
        "can you arrange a society health camp",
        "we want a health camp at our residential society",
    ],
)
def test_society_transfers_to_dr_joshi(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"
    assert result["transfer_to"] == "dr_joshi"


@pytest.mark.parametrize(
    "utterance",
    [
        "મારે આ પેકેજ લેવું છે",
        "મારે ફુલ બોડી પેકેજ ખરીદવું છે",
        "I want to buy this package",
        "I want to purchase the full body checkup",
    ],
)
def test_direct_sales_purchase_transfers(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", (
        f"{utterance!r} -> {result['intent']!r}. Buying is a direct sale; the bot does not "
        "close sales."
    )


# =========================================================================
# 3. SOFT INQUIRIES MUST BE ANSWERED
# =========================================================================
# The mirror risk: a bot that transfers everything is a switchboard, not a
# receptionist, and the demo dies.


@pytest.mark.parametrize(
    "utterance",
    [
        "ટેસ્ટનો ભાવ શું છે",
        "થાઇરોઇડ ટેસ્ટની કિંમત કેટલી છે",
        "इस टेस्ट का प्राइस बताइए",
        "what is the price of TSH test",
        "how much is the lipid profile test",
    ],
)
def test_price_is_answered_not_transferred(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "answer", f"{utterance!r} -> {result['intent']!r}"
    assert result["handler"] == "lookup_item", "a price must come from the price list"
    assert result["transfer_to"] is None


@pytest.mark.parametrize(
    "utterance",
    [
        "તમારો સમય શું છે",
        "તમે કેટલા વાગ્યે ખુલો છો",
        "શું તમે રવિવારે ખુલ્લા છો",
        "क्या रविवार को खुले हो",
        "what are your timings",
        "are you open on Sunday",
    ],
)
def test_timings_are_answered(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "answer", f"{utterance!r} -> {result['intent']!r}"
    assert result["intent"] in ("lab_timings_enquiry", "holiday_enquiry")


@pytest.mark.parametrize(
    "utterance",
    [
        "શું ખાલી પેટે આવવું પડશે",
        "કેટલા કલાક ઉપવાસ કરવો પડે",
        "क्या खाली पेट आना पड़ेगा",
        "do I need to fast for this test",
        "how many hours fasting is required",
    ],
)
def test_fasting_is_answered(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "answer", f"{utterance!r} -> {result['intent']!r}"
    assert result["handler"] == "lookup_item"


@pytest.mark.parametrize(
    "utterance,expected",
    [
        ("મારી નજીક તમારું સેન્ટર છે", "branch_enquiry"),
        ("where is your branch", "branch_enquiry"),
        ("રિપોર્ટ કેવી રીતે મળશે", "report_delivery_enquiry"),
        ("how will I receive my report", "report_delivery_enquiry"),
        ("શું કાર્ડથી પેમેન્ટ થાય", "payment_methods_enquiry"),
        ("તમારી લેબ ભરોસાપાત્ર છે", "brand_trust_enquiry"),
        ("why should I choose Sun Pathology", "brand_trust_enquiry"),
        ("શું તમે ઘરેથી સેમ્પલ લો છો", "home_collection_info"),
        ("do you provide home collection", "home_collection_info"),
    ],
)
def test_general_support_is_answered(utterance, expected):
    result = tools.route_intent(utterance)
    assert result["route"] == "answer", f"{utterance!r} -> {result['intent']!r}"
    assert result["intent"] == expected


def test_does_the_home_collection_exist_answers_but_booking_it_transfers():
    """The exact seam the owner drew, on one topic. Asking whether the service
    exists is a soft inquiry; asking for it to happen is a booking."""
    info = tools.route_intent("શું તમે ઘરેથી સેમ્પલ લો છો")
    booking = tools.route_intent("મારે હોમ કલેક્શન બુક કરાવવું છે")
    assert info["route"] == "answer"
    assert booking["route"] == "transfer"


def test_package_contents_answer_but_buying_the_package_transfers():
    contents = tools.route_intent("આ પેકેજમાં કેટલા ટેસ્ટ છે")
    buying = tools.route_intent("મારે આ પેકેજ ખરીદવું છે")
    assert contents["route"] == "answer"
    assert buying["route"] == "transfer"


# =========================================================================
# 4. MEDICAL, EMERGENCY, COMPLAINTS
# =========================================================================


@pytest.mark.parametrize(
    "utterance",
    [
        "આ વેલ્યુ ખતરનાક છે",
        "મારે કઈ દવા લેવી જોઈએ",
        "क्या मेरी रिपोर्ट नॉर्मल है",
        "is this value dangerous",
        "can you explain my report",
        "do I have diabetes",
    ],
)
def test_medical_interpretation_transfers_to_dr_joshi(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"
    assert result["transfer_to"] == "dr_joshi"


@pytest.mark.parametrize(
    "utterance",
    [
        "મને છાતીમાં દુખાવો થાય છે",
        "શ્વાસ લેવામાં બહુ તકલીફ પડે છે",
        "मुझे सीने में दर्द हो रहा है",
        "I have severe chest pain",
        "the patient has collapsed",
    ],
)
def test_emergency_transfers(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"


@pytest.mark.parametrize(
    "utterance",
    [
        "તમારો રિપોર્ટ બીજી લેબ કરતાં અલગ આવ્યો છે",
        "જૂનો અને નવો રિપોર્ટ અલગ છે",
        "my report is different from another lab",
    ],
)
def test_report_doubt_transfers_to_dr_joshi(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer"
    assert result["transfer_to"] == "dr_joshi"


@pytest.mark.parametrize(
    "utterance",
    [
        "મને મારો રિપોર્ટ મળ્યો નથી",
        "મારો રિપોર્ટ મોડો છે",
        "I have not received my report",
        "please check my report on my number",
    ],
)
def test_report_not_received_transfers_to_customer_care(utterance):
    """We have no lab database. "Where is my report" cannot be answered, only routed."""
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"
    assert result["transfer_to"] == "customer_care"


@pytest.mark.parametrize(
    "utterance",
    [
        "મારે ફરિયાદ કરવી છે",
        "મારી પાસેથી વધારે પૈસા લેવાયા છે",
        "I want to make a complaint",
        "your staff behaviour was rude",
    ],
)
def test_complaints_transfer(utterance):
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", f"{utterance!r} -> {result['intent']!r}"


def test_asking_for_a_human_transfers():
    result = tools.route_intent("મારે માણસ સાથે વાત કરવી છે")
    assert result["route"] == "transfer"


# =========================================================================
# 5. UNKNOWN -> TRANSFER, NEVER GUESS
# =========================================================================


@pytest.mark.parametrize(
    "utterance",
    [
        "What is the WiFi password?",
        "શું તમે ક્રિકેટ મેચનો સ્કોર કહી શકશો?",
        "Do you sell mobile phone chargers?",
        "તમારી ઓફિસમાં કઈ કંપનીનું ફર્નિચર છે?",
        "તમારા લેબમાં કેટલા માણસો કામ કરે છે?",
        "શું અહીં પાર્કિંગની સુવિધા છે?",
        "તમારી વેબસાઇટ કોણે બનાવી છે?",
    ],
)
def test_an_unknown_question_is_never_answered(utterance):
    """The measured noise floor.

    Every one of these scored 51-75 against some example on sentence similarity
    alone - the parking question hit a report_tat example at 75, ABOVE what real
    price questions score. That overlap is why a mid-range sentence score is not
    allowed to produce an answer.
    """
    result = tools.route_intent(utterance)
    assert result["route"] == "transfer", (
        f"{utterance!r} is not in the playbook, so it must transfer - it came back as "
        f"{result['intent']!r} / {result['route']!r} at {result['score']}."
    )
    assert result["confidence"] == "low"


def test_unknown_names_the_unknown_intent_and_the_default_desk():
    result = tools.route_intent("What is the WiFi password?")
    assert result["intent"] == "unknown"
    assert result["transfer_to"] == "customer_care"
    assert "NOT IN THE PLAYBOOK" in result["note"]


def test_empty_and_noise_input_transfers():
    for utterance in ["", "   ", "...", "hmm"]:
        result = tools.route_intent(utterance)
        assert result["route"] == "transfer", f"{utterance!r} must not be answered"


@pytest.mark.parametrize(
    "utterance,expected_route",
    [
        # None of these are verbatim examples - this is the generalisation check.
        ("વિટામિન ડી ટેસ્ટનો ભાવ કેટલો છે", "answer"),
        ("લિપિડ પ્રોફાઇલ કેટલાનું છે", "answer"),
        ("થાઇરોઇડ પ્રોફાઇલની કિંમત જણાવો", "answer"),
        ("what is the rate for thyroid profile", "answer"),
        ("બોપલમાં તમારું સેન્ટર ક્યાં આવેલું છે", "answer"),
        ("તમારી બ્રાન્ચનું સરનામું આપો", "answer"),
        ("શું કાર્ડથી પેમેન્ટ કરી શકાય", "answer"),
        ("શુગર ટેસ્ટ માટે ભૂખ્યા આવવું પડે કે નહીં", "answer"),
        ("મારે ઘરે સેમ્પલ કલેક્શન કરાવવું છે", "transfer"),
        ("મારે ફુલ બોડી પેકેજ બુક કરાવવું છે", "transfer"),
        ("અમારી કંપની માટે ચેકઅપ કેમ્પ જોઈએ છે", "transfer"),
        ("મારું સુગર ૩૦૦ છે ખતરનાક છે", "transfer"),
    ],
)
def test_paraphrases_route_correctly(utterance, expected_route):
    """Callers do not speak in examples. If this file only ever matched its own
    examples it would be measuring nothing."""
    result = tools.route_intent(utterance)
    assert result["route"] == expected_route, (
        f"{utterance!r} -> {result['intent']!r} / {result['route']!r} at {result['score']}"
    )


def test_known_recall_gaps_fail_safe():
    """Honest record of what this router does NOT catch, and proof it fails safe.

    These are real, answerable questions that no keyword covers and that score too
    low on sentence similarity ("how do I get my report" hits 81 - under the gate,
    and there is no non-ambiguous keyword to add, since "report" belongs equally to
    the TAT, delivery, status and not-received intents). They come back as unknown,
    which transfers. That is the intended failure direction, and the LLM - which is
    the primary router, holding the same table in prompts/system_gu.md - still
    answers them. If a future change makes these ANSWER, that is an improvement;
    if it makes them answer WRONGLY, this test is where to look.
    """
    for utterance in ["how do I get my report", "આજે તમારી લેબ ખુલ્લી હશે"]:
        result = tools.route_intent(utterance)
        assert result["route"] == "transfer", (
            f"{utterance!r} now routes to {result['intent']!r} - if that is a correct "
            "answer route, update this test; if not, the router just started guessing."
        )


def test_route_intent_always_returns_the_four_required_keys():
    for utterance in ["ટેસ્ટનો ભાવ શું છે", "મારે હોમ કલેક્શન બુક કરાવવું છે", "asdf qwerty"]:
        result = tools.route_intent(utterance)
        for key in ("intent", "route", "transfer_to", "confidence"):
            assert key in result, f"{key} missing for {utterance!r}"
        assert result["route"] in ("answer", "transfer")
        assert result["confidence"] in ("high", "low")


def test_an_answer_route_never_carries_a_transfer_target():
    for utterance in ["ટેસ્ટનો ભાવ શું છે", "તમારો સમય શું છે", "where is your branch"]:
        result = tools.route_intent(utterance)
        if result["route"] == "answer":
            assert result["transfer_to"] is None


def test_a_transfer_route_always_carries_a_reachable_target():
    for utterance in [
        "મારે હોમ કલેક્શન બુક કરાવવું છે",
        "we need a corporate health checkup for our company",
        "What is the WiFi password?",
    ]:
        result = tools.route_intent(utterance)
        assert result["route"] == "transfer"
        assert result["transfer_to"] in tools.TRANSFER_TARGETS


# =========================================================================
# 6. transfer_to_agent - writes a lead, returns the right number
# =========================================================================


def test_transfer_to_agent_writes_a_lead_and_returns_customer_care(leads_file):
    result = tools.transfer_to_agent(
        intent="home_collection_booking",
        name="Himanshu Patel",
        phone="98250 12345",
        details="Full Body Check-up, Bopal, tomorrow morning",
    )
    assert result["ok"] is True
    assert result["route"] == "transfer"
    assert result["transfer_to"] == "customer_care"
    assert result["contact_number"] == CUSTOMER_CARE
    assert result["lead_id"].startswith("SP-")
    assert result["simulated"] is True

    lines = leads_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["route"] == "transfer"
    assert record["intent"] == "home_collection_booking"
    assert record["transfer_to"] == "customer_care"
    assert record["transfer_number"] == CUSTOMER_CARE
    assert record["name"] == "Himanshu Patel"
    assert record["phone_digits"] == "9825012345"
    assert record["details"] == "Full Body Check-up, Bopal, tomorrow morning"


def test_transfer_to_agent_returns_dr_joshi_for_corporate(leads_file):
    result = tools.transfer_to_agent(
        intent="corporate_health_checkup",
        name="Rakesh Shah",
        phone="9876543210",
        details="Shah Industries, ~120 employees, Vatva GIDC, annual Factory Act check-up",
    )
    assert result["ok"] is True
    assert result["transfer_to"] == "dr_joshi"
    assert result["contact_number"] == DR_JOSHI
    assert DR_JOSHI in result["script_gu"]

    record = json.loads(leads_file.read_text(encoding="utf-8").strip())
    assert record["transfer_to"] == "dr_joshi"
    assert record["transfer_number"] == DR_JOSHI


def test_transfer_to_agent_returns_dr_joshi_for_society(leads_file):
    result = tools.transfer_to_agent(
        intent="society_health_camp",
        name="Meena Desai",
        phone="9825011111",
        details="Shukan Residency, ~60 participants, Gota",
    )
    assert result["ok"] is True
    assert result["transfer_to"] == "dr_joshi"
    assert result["contact_number"] == DR_JOSHI


def test_the_playbook_overrides_a_wrong_transfer_to_argument(leads_file):
    """The `transfer_to` argument arrives from the LLM, i.e. it is a guess. The
    owner's routing split is not. A corporate lead must reach Dr. Joshi even if
    the model asks for customer care."""
    result = tools.transfer_to_agent(
        intent="corporate_health_checkup",
        name="Rakesh Shah",
        phone="9876543210",
        details="120 employees",
        transfer_to="customer_care",
    )
    assert result["transfer_to"] == "dr_joshi", "the playbook must win over the LLM's guess"
    assert result["contact_number"] == DR_JOSHI
    assert result["routed_by"] == "playbook"


def test_an_unknown_intent_honours_the_transfer_to_argument(leads_file):
    result = tools.transfer_to_agent(
        intent="something_the_playbook_never_heard_of",
        name="Kiran",
        phone="9825099999",
        details="asked about a test we do not list",
        transfer_to="dr_joshi",
    )
    assert result["ok"] is True
    assert result["transfer_to"] == "dr_joshi"
    assert result["routed_by"] == "argument"


def test_an_unknown_intent_with_no_argument_falls_back_to_customer_care(leads_file):
    result = tools.transfer_to_agent(
        intent="unknown",
        name="Kiran",
        phone="9825099999",
        details="asked about parking",
    )
    assert result["ok"] is True
    assert result["transfer_to"] == "customer_care"
    assert result["contact_number"] == CUSTOMER_CARE
    assert result["routed_by"] == "default"


def test_route_intent_and_transfer_to_agent_agree_on_the_target(leads_file):
    """End to end: whatever route_intent says the desk is, transfer_to_agent must
    put the caller on that desk."""
    for utterance in [
        "મારે હોમ કલેક્શન બુક કરાવવું છે",
        "we need a corporate health checkup for our company",
        "અમારી સોસાયટીમાં હેલ્થ કેમ્પ ગોઠવવો છે",
        "I want to make a complaint",
    ]:
        routed = tools.route_intent(utterance)
        assert routed["route"] == "transfer"
        handed = tools.transfer_to_agent(
            intent=routed["intent"], name="Test Caller", phone="9825000000", details=utterance
        )
        assert handed["transfer_to"] == routed["transfer_to"], utterance
        assert handed["contact_number"] == tools.TRANSFER_TARGETS[routed["transfer_to"]]["number"]


# --- capture rules --------------------------------------------------------


def test_transfer_to_agent_will_not_hand_off_a_sale_without_a_callback_number(leads_file):
    result = tools.transfer_to_agent(intent="home_collection_booking", name="Himanshu", phone="")
    assert result["ok"] is False
    assert result["error"] == "missing_fields"
    assert "phone" in result["missing"]
    assert not leads_file.exists(), "a failed capture must not write a lead"


def test_transfer_to_agent_rejects_a_short_number(leads_file):
    """chirp_2 drops digits on Gujarati-accented number reads, and a lead nobody
    can ring back is not a lead."""
    result = tools.transfer_to_agent(
        intent="home_collection_booking", name="Himanshu", phone="98250"
    )
    assert result["ok"] is False
    assert result["error"] == "phone_too_short"
    assert not leads_file.exists()


def test_an_emergency_is_never_gated_on_collecting_details(leads_file):
    """Asking a caller with chest pain for their mobile number before helping is
    indefensible. The script must come back with no name and no phone."""
    result = tools.transfer_to_agent(intent="emergency_symptoms", name="", phone="")
    assert result["ok"] is True
    assert result["script_gu"]
    assert "હૉસ્પિટલ" in result["script_gu"], "the emergency script must send them to a hospital"
    assert DR_JOSHI not in result["script_gu"], (
        "Dr. Joshi's number must never be offered as an alternative to emergency care"
    )


def test_medical_interpretation_is_never_gated_on_collecting_details(leads_file):
    result = tools.transfer_to_agent(intent="medical_interpretation", name="", phone="")
    assert result["ok"] is True
    assert result["transfer_to"] == "dr_joshi"
    assert DR_JOSHI in result["script_gu"]


# --- the script itself ----------------------------------------------------


def test_the_handoff_script_never_claims_a_live_transfer(leads_file):
    """There is no SIP trunk. A receptionist who says she is putting you through
    and then hangs up is worse than one who never offered."""
    for intent in ("home_collection_booking", "corporate_health_checkup", "complaint_service_issue"):
        result = tools.transfer_to_agent(
            intent=intent, name="Test Caller", phone="9825000000", details="x"
        )
        script = result["script_gu"]
        for claim in ("જોડી રહી", "જોડું છું", "ટ્રાન્સફર કરું", "લાઇન પર લઉં"):
            assert claim not in script, f"{intent} script claims a live transfer: {claim!r}"


def test_the_handoff_script_reads_the_number_back(leads_file):
    result = tools.transfer_to_agent(
        intent="home_collection_booking",
        name="Himanshu Patel",
        phone="9825012345",
        details="CBC",
    )
    assert "Himanshu Patel" in result["script_gu"]
    assert "9825012345" in result["script_gu"], "read the caller's number back to confirm it"
    assert CUSTOMER_CARE in result["script_gu"]


def test_the_handoff_script_survives_tts_normalization(leads_file):
    """The script goes through normalize.py before Chirp3-HD. The numbers in it
    must come out as spoken Gujarati digits, not as one enormous integer."""
    from agent import normalize

    result = tools.transfer_to_agent(
        intent="home_collection_booking", name="Himanshu", phone="9825012345", details="x"
    )
    spoken = normalize.normalize_for_tts(result["script_gu"])
    assert CUSTOMER_CARE not in spoken, "079-67006700 must be converted to words"
    assert "શૂન્ય સાત નવ" in spoken, "customer care must be spoken digit by digit"


def test_transfer_mode_is_the_sip_seam():
    """The transfer is announce-only until a SIP trunk exists. This asserts the
    seam is still a single switch - if it grows a second one, the wiring drifted."""
    assert tools.TRANSFER_MODE == "announce"
    result = tools.transfer_to_agent(
        intent="medical_interpretation", name="", phone="", details="x"
    )
    assert result["mode"] == "announce"
    assert result["simulated"] is True


# =========================================================================
# 7. FAQ BANK
# =========================================================================


def test_faq_entries_are_complete():
    assert len(PLAYBOOK["faq"]) >= 15, "the doc's high-priority FAQ bank (sections 51-54)"
    for entry in PLAYBOOK["faq"]:
        for key in ("q", "q_gu", "a_gu", "a_en", "source"):
            assert entry.get(key), f"{entry.get('q')!r} is missing {key}"


def test_faq_answers_are_actually_gujarati():
    """a_gu must be Gujarati script, not romanised Gujarati and not English."""
    for entry in PLAYBOOK["faq"]:
        gujarati_chars = sum(1 for ch in entry["a_gu"] if "઀" <= ch <= "૿")
        assert gujarati_chars > 20, f"{entry['q']!r} a_gu does not look like Gujarati script"


def test_every_faq_traces_back_to_the_owner_doc():
    for entry in PLAYBOOK["faq"]:
        assert "doc section" in entry["source"].lower(), (
            f"{entry['q']!r} has no provenance in the owner's document"
        )


def test_the_faq_bank_covers_the_high_priority_sections():
    sources = " ".join(e["source"] for e in PLAYBOOK["faq"])
    for section in ("51", "52", "53", "54"):
        assert f"section {section}" in sources, f"doc section {section} is not represented"


def test_the_booking_faq_does_not_promise_the_bot_will_book():
    """The doc's own answer had the AI take the booking. The owner's playbook
    reassigned that to a human, so this FAQ must hand off, not collect."""
    entry = next(e for e in PLAYBOOK["faq"] if "book home collection" in e["q"].lower())
    assert CUSTOMER_CARE in entry["a_gu"], "the booking FAQ must give the customer care number"
    assert "ટીમ" in entry["a_gu"], "it must say the team does the booking"


def test_report_faqs_give_dr_joshis_number():
    hits = [e for e in PLAYBOOK["faq"] if DR_JOSHI in e["a_gu"]]
    assert len(hits) >= 3, "the report-doubt FAQs must carry the escalation number"


def test_faq_numbers_are_the_owners_numbers():
    """Any phone number anywhere in the FAQ bank must be one of the two real ones."""
    import re

    for entry in PLAYBOOK["faq"]:
        for found in re.findall(r"\d[\d\-\s]{7,}\d", entry["a_gu"]):
            digits = re.sub(r"\D", "", found)
            assert digits in ("07967006700", DR_JOSHI), (
                f"{entry['q']!r} contains an unknown number: {found!r}"
            )
