"""Tests for the accuracy guard (brief section 7).

Prices/TAT/counts in the fixtures are REAL rows from knowledge/tests.json and
knowledge/packages.json - the guard must behave against the shapes the LLM will
actually see, not against invented numbers.

Run:  python -m pytest eval/test_guard.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent import guard  # noqa: E402

# --- real records ---------------------------------------------------------

# tests.json id 1
PROGESTERONE = {
    "id": 1,
    "type": "test",
    "name": "17-OH Progesterone",
    "sample_type": "Blood",
    "fasting_required": "No",
    "mrp": 1100,
    "price": 600,
    "category": "Special",
    "tat": "12 to 18 hours",
}

# packages.json - Full Body Check-up (Basic)
FULL_BODY_BASIC = {
    "type": "package",
    "name": "Full Body Check-up (Basic)",
    "slug": "full-body-check-up-basic",
    "tests_included": 10,
    "price": 650,
    "mrp": 2780,
    "category": "Full Body",
    "contents": ["Complete Blood Count (CBC)", "Lipid Profile"],
}


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Fresh failure counter + a throwaway guard log for every test."""
    guard.reset_state()
    monkeypatch.setattr(guard, "GUARD_LOG", tmp_path / "guard_log.jsonl")
    yield
    guard.reset_state()


def log_lines(tmp_path):
    p = tmp_path / "guard_log.jsonl"
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


# --- 1. price hallucination with no lookup --------------------------------


def test_price_stated_without_lookup_is_blocked(tmp_path):
    v = guard.verify_turn(
        response_text="17-OH Progesterone ટેસ્ટની કિંમત ₹550 છે.",
        tool_results=None,
        called_lookup=False,
    )
    assert v["ok"] is False
    assert v["action"] == "regenerate"
    assert "lookup" in v["reason"]
    assert "lookup_item" in v["instruction"]
    assert v["prices"] == [550.0]

    entries = log_lines(tmp_path)
    assert len(entries) == 1
    assert entries[0]["kind"] == "price_without_lookup"
    assert entries[0]["called_lookup"] is False


@pytest.mark.parametrize(
    "text",
    [
        "કિંમત ₹550 છે.",
        "Rs. 550 થાય છે.",
        "550 રૂપિયા થશે.",
        "આ ટેસ્ટ 550/- માં થાય છે.",
        "The price is 550.",
        "કિંમત ૫૫૦ રૂપિયા છે.",  # Gujarati-script digits
    ],
)
def test_rupee_amount_forms_all_caught_without_lookup(text):
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is False, f"missed a price in: {text}"
    assert v["action"] == "regenerate"
    assert 550.0 in v["prices"]


def test_non_price_turn_without_lookup_passes():
    v = guard.verify_turn(
        response_text="નમસ્તે, સન પેથોલોજીમાં આપનું સ્વાગત છે. હું આપની શું મદદ કરી શકું?",
        tool_results=None,
        called_lookup=False,
    )
    assert v["ok"] is True
    assert v["action"] == "pass"


# --- 2. price mismatch vs tool result -------------------------------------


def test_price_mismatch_against_tool_result_regenerates(tmp_path):
    v = guard.verify_turn(
        response_text="17-OH Progesterone ની MRP 1100 રૂપિયા છે, ડિસ્કાઉન્ટ પછી 550 રૂપિયા.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert v["ok"] is False
    assert v["action"] == "regenerate"
    assert "550" in v["reason"]
    assert "600" in v["instruction"]  # told the real discounted price
    assert v["allowed"] == [600.0, 1100.0]

    entry = log_lines(tmp_path)[0]
    assert entry["kind"] == "price_mismatch"
    assert entry["allowed_amounts"] == [600.0, 1100.0]


def test_mrp_hallucinated_but_discount_correct_still_fails():
    v = guard.verify_turn(
        response_text="MRP ₹1200 છે અને ડિસ્કાઉન્ટ પછી ₹600 થાય છે.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert v["ok"] is False
    assert v["prices"] == [1200.0, 600.0]
    assert "1200" in v["reason"]


def test_lookup_called_but_returned_nothing_blocks_any_price():
    v = guard.verify_turn(
        response_text="એની કિંમત ₹600 છે.",
        tool_results=[{"query": "xyz", "match": None, "confidence": "none"}],
        called_lookup=True,
    )
    assert v["ok"] is False
    assert v["action"] == "regenerate"


# --- 3. correct price passes ----------------------------------------------


def test_correct_mrp_and_discounted_price_passes(tmp_path):
    v = guard.verify_turn(
        response_text="17-OH Progesterone ની MRP 1100 રૂપિયા છે, અને સન પેથોલોજીમાં એ 600 રૂપિયામાં થાય છે.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert v["ok"] is True
    assert v["action"] == "pass"
    assert v["reason"] == "ok"
    assert log_lines(tmp_path) == []  # passes are not logged


def test_package_price_passes_with_nested_tool_shape():
    """tools.py may wrap records - the guard must not care about the wrapper."""
    v = guard.verify_turn(
        response_text="Full Body Check-up (Basic) ની MRP ₹2,780 છે, ડિસ્કાઉન્ટ પછી ₹650.",
        tool_results=[{"confidence": "high", "matches": [FULL_BODY_BASIC]}],
        called_lookup=True,
    )
    assert v["ok"] is True
    assert v["prices"] == [2780.0, 650.0]


def test_discount_only_quote_passes():
    v = guard.verify_turn(
        response_text="એની કિંમત 600 રૂપિયા છે.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert v["ok"] is True


# --- 4. non-price numbers must not be flagged -----------------------------


def test_timings_tat_counts_and_phone_are_not_prices():
    """The whole false-positive surface in one turn, with no lookup at all."""
    text = (
        "અમારા બધા સેન્ટર સવારે 8:00 થી રાત્રે 8:00 સુધી, અઠવાડિયાના સાતેય દિવસ ખુલ્લા છે. "
        "આ પેકેજમાં 62 પેરામીટર અને 10 ટેસ્ટ આવે છે, રિપોર્ટ 24 કલાકમાં મળી જશે. "
        "કસ્ટમર કેર નંબર 079-67006700 છે. અમારું સેન્ટર 380060 માં છે."
    )
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is True, f"false positive: {v}"
    assert v["prices"] == []


@pytest.mark.parametrize(
    "text",
    [
        "અમે સવારે 8 થી રાત્રે 8 સુધી ખુલ્લા છીએ.",
        "We are open 8 AM to 8 PM, all days including Sunday.",
        "રિપોર્ટ 6 to 8 Hours માં મળશે.",
        "રિપોર્ટ 48 to 72 Hours માં આવશે.",
        "રિપોર્ટ 15 to 48 Days માં આવે છે.",
        "આ પેકેજમાં 62 પેરામીટર છે.",
        "એમાં કુલ 10 ટેસ્ટ સામેલ છે.",
        "ડૉ. મયંક જોષી - 9276843433 પર વાત કરી શકો છો.",
        "કસ્ટમર કેર: 079-67006700.",
        "14 જાન્યુઆરી 2026 ના રોજ ઉત્તરાયણ છે, લેબ બંધ રહેશે.",
        "2026-01-14 ના રોજ લેબ બંધ છે.",
        "તમારી ઉંમર 35 વર્ષ છે?",
        "રિપોર્ટ 3 Days માં મળશે.",
    ],
)
def test_no_false_positive_on_non_price_numbers(text):
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is True, f"false positive on: {text} -> {v}"


def test_price_plus_tat_plus_count_in_one_turn_checks_only_the_price():
    """Realistic package answer: only 2780/650 are money; 10 and 24 are not."""
    v = guard.verify_turn(
        response_text=(
            "Full Body Check-up (Basic) ની કિંમત MRP 2780 રૂપિયા છે, "
            "ડિસ્કાઉન્ટ પછી 650 રૂપિયા. એમાં 10 ટેસ્ટ આવે છે અને રિપોર્ટ 24 કલાકમાં મળશે."
        ),
        tool_results=[FULL_BODY_BASIC],
        called_lookup=True,
    )
    assert v["ok"] is True, f"flagged a non-price: {v}"
    assert sorted(v["prices"]) == [650.0, 2780.0]


# The three tests below are the ones that actually exercise the disqualifying
# rules. Everything above them passes on the positive-evidence default alone (no
# price marker -> not a price), so without these the unit-word and time-of-day
# rules would be dead code. Each one puts a PRICE WORD within the lookbehind
# window of a non-price number, with no other digit in between - the only
# situation where those rules are load-bearing.


@pytest.mark.parametrize(
    "text",
    [
        # "this package's PRICE includes 62 PARAMETERS" - kills the count via _UNIT_RE
        "આ પેકેજની કિંમતમાં 62 પેરામીટર આવે છે.",
        # "at a DISCOUNTED RATE, a 62-PARAMETER checkup"
        "ડિસ્કાઉન્ટેડ રેટ પર 62 પેરામીટર નો ચેકઅપ છે.",
        # "no CHARGE, report in 24 HOURS" - price word then a TAT
        "કોઈ ચાર્જ નથી, રિપોર્ટ 24 કલાકમાં મળશે.",
        "There is no charge, and the report comes in 24 hours.",
    ],
)
def test_price_word_next_to_a_tat_or_count_does_not_promote_it(text):
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is True, f"unit word failed to disqualify: {text} -> {v}"


def test_price_word_next_to_a_timing_does_not_promote_it():
    """"No collection CHARGE, we come 8 to 8" - _TIME_PREFIX_RE has to catch the 8s.

    There is no unit word after either "8" here, so this is the time-of-day rule
    or nothing.
    """
    v = guard.verify_turn(
        response_text="કલેક્શન ચાર્જ નથી, સવારે 8 થી રાત્રે 8 સુધી ઘરે આવીશું.",
        tool_results=None,
        called_lookup=False,
    )
    assert v["ok"] is True, f"false positive on a timing: {v}"


def test_intervening_number_blocks_the_price_word_window():
    """In "કિંમત 650 રૂપિયા અને 10 ટેસ્ટ", "કિંમત" must not reach past 650 to the 10."""
    mentions = guard.extract_price_mentions("કિંમત 650 રૂપિયા અને 10 ટેસ્ટ આવે છે.")
    assert [m["value"] for m in mentions] == [650.0]


@pytest.mark.parametrize(
    "text,expected",
    [
        # "the PRICE is 600 rupees, and we'll need 2 SAMPLES" - "સેમ્પલ" is not a
        # unit word, so only the digit-block stops "કિંમત" reaching the 2.
        ("કિંમત 600 રૂપિયા છે, અને 2 સેમ્પલ જોઈશે.", [600.0]),
        ("ડિસ્કાઉન્ટ પછી 650 છે, અને 2 સેમ્પલ લઈશું.", [650.0]),
    ],
)
def test_price_word_cannot_reach_past_an_earlier_number(text, expected):
    mentions = guard.extract_price_mentions(text)
    assert [m["value"] for m in mentions] == expected, f"over-reached on: {text}"


@pytest.mark.parametrize(
    "text",
    [
        # "no CHARGE, free home collection in pincode 380060" - a 6-digit pincode
        # sitting inside a price word's window. Too many digits to be money.
        "કોઈ ચાર્જ નથી, પિનકોડ 380060 માં ફ્રી હોમ કલેક્શન છે.",
        "ડિસ્કાઉન્ટ માટે પિનકોડ 380015 જણાવો.",
    ],
)
def test_pincode_near_a_price_word_is_not_a_price(text):
    """Prices run 40-28,600; a 6-digit number is a pincode, never money."""
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is True, f"false positive on a pincode: {text} -> {v}"


@pytest.mark.parametrize(
    "text",
    [
        # "there's a 20% DISCOUNT on right now" - a discount percentage is not an amount
        "અત્યારે ડિસ્કાઉન્ટ 20% ચાલે છે.",
        # "call 079-67006700 for DISCOUNTS" - "079" sits inside the price word window
        "ડિસ્કાઉન્ટ માટે 079-67006700 પર કૉલ કરો.",
        # "no CHARGE, lab closed on 14 January 2026"
        "કોઈ ચાર્જ નથી, 14 જાન્યુઆરી 2026 ના રોજ લેબ બંધ છે.",
        # "come before 2026-01-14 to pay the FEE"
        "ફી ભરવા 2026-01-14 પહેલા આવો.",
    ],
)
def test_masked_spans_survive_a_nearby_price_word(text):
    """Clock times, %, phone numbers and dates are masked before the number scan.

    Each of these puts a price word within reach of a number that is part of a
    non-money span - masking is the only thing standing between them.
    """
    v = guard.verify_turn(response_text=text, tool_results=None, called_lookup=False)
    assert v["ok"] is True, f"false positive on a masked span: {text} -> {v}"


def test_clock_time_next_to_a_real_price_does_not_leak():
    """"price is 650 rupees and we open at 8:00" - 650 flagged, the 8:00 ignored."""
    mentions = guard.extract_price_mentions("કિંમત 650 રૂપિયા છે અને અમે 8:00 વાગ્યે ખુલીએ છીએ.")
    assert [m["value"] for m in mentions] == [650.0]


def test_tests_included_count_is_not_a_legal_price():
    """tests_included=10 must NOT legalise '₹10' - allowed amounts are price keys only."""
    v = guard.verify_turn(
        response_text="આ પેકેજ ₹10 માં થાય છે.",
        tool_results=[FULL_BODY_BASIC],
        called_lookup=True,
    )
    assert v["ok"] is False
    assert v["action"] == "regenerate"


# --- 5. second failure -> Gujarati fallback -------------------------------


def test_second_consecutive_failure_returns_gujarati_fallback(tmp_path):
    first = guard.verify_turn(
        response_text="એની કિંમત ₹550 છે.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert first["action"] == "regenerate"
    assert first["attempt"] == 1

    second = guard.verify_turn(
        response_text="માફ કરશો, એની કિંમત ₹575 છે.",
        tool_results=[PROGESTERONE],
        called_lookup=True,
    )
    assert second["ok"] is False
    assert second["action"] == "fallback"
    assert second["attempt"] == 2
    assert second["fallback_text"] == "હું ચોક્કસ કિંમત કન્ફર્મ કરીને જણાવું છું"
    assert "instruction" not in second

    entries = log_lines(tmp_path)
    assert len(entries) == 2
    assert [e["action"] for e in entries] == ["regenerate", "fallback"]
    assert entries[1]["fallback_text"] == guard.FALLBACK_GU


@pytest.mark.parametrize("text", ["કિંમત ૫૫૦ રૂપિયા છે.", "કિંમત ૫50 રૂપિયા છે."])
def test_gujarati_digits_are_normalised_for_the_log(tmp_path, text):
    """The log is demo evidence - a price must land as "550", not "૫૫૦"."""
    v = guard.verify_turn(response_text=text, tool_results=[PROGESTERONE], called_lookup=True)
    assert v["ok"] is False
    assert v["prices"] == [550.0]

    logged = log_lines(tmp_path)[0]["prices_spoken"][0]["raw"]
    assert logged == "550", f"log kept non-ASCII digits: {logged!r}"
    assert logged.isascii()


def test_fallback_line_is_gujarati_script():
    assert guard.FALLBACK_GU == "હું ચોક્કસ કિંમત કન્ફર્મ કરીને જણાવું છું"
    assert all(not c.isascii() or c.isspace() for c in guard.FALLBACK_GU)


def test_a_pass_resets_the_failure_counter():
    guard.verify_turn("એની કિંમત ₹550 છે.", [PROGESTERONE], True)
    ok = guard.verify_turn("એની કિંમત ₹600 છે.", [PROGESTERONE], True)
    assert ok["action"] == "pass"

    again = guard.verify_turn("એની કિંમત ₹555 છે.", [PROGESTERONE], True)
    assert again["action"] == "regenerate", "counter did not reset after a good turn"
    assert again["attempt"] == 1


def test_failure_counters_are_per_session():
    guard.verify_turn("કિંમત ₹550 છે.", [PROGESTERONE], True, session_id="call-a")
    b = guard.verify_turn("કિંમત ₹550 છે.", [PROGESTERONE], True, session_id="call-b")
    assert b["action"] == "regenerate", "one caller's failure leaked into another call"


def test_third_turn_after_fallback_starts_over():
    guard.verify_turn("કિંમત ₹550 છે.", [PROGESTERONE], True)
    guard.verify_turn("કિંમત ₹575 છે.", [PROGESTERONE], True)  # -> fallback, resets
    third = guard.verify_turn("કિંમત ₹580 છે.", [PROGESTERONE], True)
    assert third["action"] == "regenerate"


# --- API shape ------------------------------------------------------------


def test_returns_the_documented_keys():
    v = guard.verify_turn("નમસ્તે.", None, False)
    assert set(["ok", "action", "reason"]).issubset(v.keys())
    assert isinstance(v["ok"], bool)
    assert v["action"] in {"pass", "regenerate", "fallback"}
    assert isinstance(v["reason"], str)


def test_positional_call_signature_matches_main_py():
    v = guard.verify_turn("કિંમત ₹600 છે.", [PROGESTERONE], True)
    assert v["action"] == "pass"


def test_empty_turn_passes():
    assert guard.verify_turn("", None, False)["action"] == "pass"
