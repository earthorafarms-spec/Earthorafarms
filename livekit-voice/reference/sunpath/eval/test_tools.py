"""Tool-layer accuracy tests (brief section 11 step 2: "Tools + lookup with tests
on 20 tricky queries").

Run:  python -m pytest eval/test_tools.py -q

These are the safety net for the one rule the whole demo rests on: the bot may
never state a price it did not get from `lookup_item`, and may never state a
price `lookup_item` was not sure about. So most of these tests assert
*confidence*, not just content - a right price at the wrong confidence still
produces a wrong call.

Every expected value below was read out of knowledge/tests.json and
knowledge/packages.json, never from memory.
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

TESTS_JSON = json.loads((ROOT / "knowledge" / "tests.json").read_text(encoding="utf-8"))
PACKAGES_JSON = json.loads((ROOT / "knowledge" / "packages.json").read_text(encoding="utf-8"))


def names_of(result) -> list:
    return [i["name"] for i in result["items"]]


# =========================================================================
# 1. THE CBC TRAP
# =========================================================================
# The single most likely way this demo embarrasses the client: a caller says
# "CBC" - the most-ordered test in any lab - and the bot confidently quotes a
# price. There is NO plain "CBC" row in this price list. The only row is
# "CBC With Mp By Antigen" (CBC bundled with a malaria antigen, MRP 350 /
# price 170). Quoting that as "CBC" is quoting the wrong product.


def test_no_plain_cbc_row_exists_in_the_price_list():
    """Documents the trap. If this ever fails, the dataset changed and the CBC
    handling below must be revisited."""
    exact = [t for t in TESTS_JSON if t["name"].strip().lower() == "cbc"]
    assert exact == [], f"A plain CBC row now exists: {exact}. Revisit test_cbc_* below."


def test_cbc_is_never_high_confidence():
    result = tools.lookup_item("cbc")
    assert result["confidence"] == "low", (
        "'cbc' must never come back high-confidence - there is no plain CBC row, "
        "so the bot has to ask instead of quoting."
    )


def test_cbc_asks_a_clarifying_question_and_does_not_present_one_price():
    result = tools.lookup_item("cbc")
    assert result["clarify"], "'cbc' must carry a clarify question"
    assert len(result["items"]) > 1, (
        "'cbc' must offer the caller a choice, not a single implied answer. "
        f"Got: {names_of(result)}"
    )
    assert "CBC With Mp By Antigen" in names_of(result)
    assert "AMBIGUOUS" in result["note"]


def test_cbc_variants_all_stay_low_confidence():
    for query in ["cbc", "CBC", "c b c", "complete blood count", "hemogram", "સીબીસી"]:
        result = tools.lookup_item(query)
        assert result["confidence"] == "low", f"{query!r} must not assert a CBC price"


# =========================================================================
# 2. AMBIGUITY: must ask, must not assert
# =========================================================================


def test_sugar_is_ambiguous_and_clarifies():
    result = tools.lookup_item("sugar")
    assert result["found"] is True
    assert result["confidence"] == "low"
    assert result["clarify"], "'sugar' must ask fasting vs post-meal vs random"
    assert len(result["items"]) > 1
    # The lab's rows are named "...Plasma Glucose...", not "Blood Sugar" - the
    # alias table is what bridges the caller's word to them.
    assert any("Glucose" in n or "Sugar" in n for n in names_of(result))


def test_sugar_in_gujarati_script_behaves_identically():
    assert tools.lookup_item("સુગર")["confidence"] == "low"
    assert tools.lookup_item("સુગર")["clarify"]


def test_thyroid_spans_both_a_test_and_packages():
    """Brief section 3.1: 'If a query matches both a test and a package
    (e.g. thyroid), present both briefly and ask which they mean.'"""
    result = tools.lookup_item("thyroid")
    assert result["confidence"] == "low"
    assert result["clarify"]
    types = {i["type"] for i in result["items"]}
    assert types == {"test", "package"}, f"expected both a test and packages, got {types}"
    assert "TSH (Ultrasensitive)" in names_of(result)
    assert any(n.startswith("Thyroid Profile") for n in names_of(result))


def test_tsh_alone_is_unambiguous_unlike_thyroid():
    """The disambiguation actually pays off: once the caller narrows to TSH we
    may quote."""
    result = tools.lookup_item("tsh")
    assert result["confidence"] == "high"
    assert names_of(result) == ["TSH (Ultrasensitive)"]


def test_full_body_checkup_is_ambiguous_across_many_packages():
    result = tools.lookup_item("full body checkup")
    assert result["found"] is True
    assert result["confidence"] == "low"
    assert result["clarify"], "must ask which full-body package"
    assert len(result["items"]) >= 10, f"expected the full package menu, got {names_of(result)}"
    assert {i["type"] for i in result["items"]} == {"package"}


def test_iron_and_amh_ambiguity_stays_low():
    for query in ["iron", "amh", "kft", "liver function"]:
        result = tools.lookup_item(query)
        assert result["found"] is True, f"{query!r} should resolve to real rows"
        assert result["confidence"] == "low", f"{query!r} has multiple rows - must ask"


# =========================================================================
# 3. UNKNOWN TESTS: no match, never invent
# =========================================================================


def test_unknown_test_returns_no_match_and_no_items():
    result = tools.lookup_item("quantum flux capacitor test")
    assert result["found"] is False
    assert result["items"] == [], "must not surface a record for a test we do not sell"
    assert result["confidence"] == "low"
    assert result["match_type"] == "none"
    assert "NO MATCH" in result["note"] and "do NOT guess" in result["note"].replace("Do NOT", "do NOT")


def test_pure_gibberish_offers_no_candidates_at_all():
    """Below the noise floor we do not even say 'did you mean' - a wrong
    suggestion is a wrong answer with extra steps."""
    result = tools.lookup_item("xyzzy plugh")
    assert result["found"] is False
    assert result["candidates"] == []


def test_empty_and_whitespace_queries_are_safe():
    for query in ["", "   ", None]:
        result = tools.lookup_item(query)
        assert result["found"] is False
        assert result["items"] == []


def test_near_miss_may_suggest_but_never_asserts():
    """'kidney function' is not an alias surface form and fuzzes below 85, so it
    must come back as suggestions the bot ASKS about - never as a fact."""
    result = tools.lookup_item("kidney function")
    assert result["found"] is False
    assert result["items"] == []
    assert result["confidence"] == "low"
    assert len(result["candidates"]) <= tools.MAX_CANDIDATES


# =========================================================================
# 4. CONFIDENT MATCHES: exact price data must ride back
# =========================================================================


def test_vitamin_d_exact_match_carries_mrp_and_price():
    result = tools.lookup_item("vitamin d")
    assert result["found"] is True
    assert result["confidence"] == "high"
    assert result["match_type"] == "exact"
    item = result["items"][0]
    assert item["name"] == "Vitamin D"
    # Straight from tests.json id 314.
    assert item["mrp"] == 1400
    assert item["price"] == 600
    assert item["fasting_required"] == "No"
    assert item["tat"] == "6 to 8 Hours"


def test_vitamin_d_in_gujarati_script_resolves_the_same_row():
    result = tools.lookup_item("વિટામિન ડી")
    assert result["confidence"] == "high"
    assert result["items"][0]["name"] == "Vitamin D"
    assert result["items"][0]["price"] == 600


def test_owner_rule_both_prices_present_so_mrp_can_be_quoted_first():
    """Owner doc section 11: quote MRP first, THEN the discounted price. The tool
    must therefore always hand back both numbers."""
    result = tools.lookup_item("vitamin d")
    assert result["price_quote_order"] == tools.PRICE_QUOTE_STYLE
    for item in result["items"]:
        assert isinstance(item["mrp"], int) and item["mrp"] > 0
        assert isinstance(item["price"], int) and item["price"] > 0
        assert item["price"] <= item["mrp"], "discounted price must not exceed MRP"


def test_abbreviations_resolve_to_the_labs_oddly_named_rows():
    """The caller's abbreviation and the lab's row name share almost no
    characters - this only works via aliases.json, never via fuzz."""
    assert names_of(tools.lookup_item("fbs")) == ["Fasting Plasma Glucose  Analysis"]
    assert names_of(tools.lookup_item("hba1c")) == ["Glycosylated Hb ( Hba I C )"]
    assert names_of(tools.lookup_item("ppbs")) == ["P. P.Plasma Glucose Analysis"]
    for query in ["fbs", "hba1c", "ppbs"]:
        assert tools.lookup_item(query)["confidence"] == "high"


def test_exact_match_is_punctuation_and_spacing_insensitive():
    """STT will never emit the hyphen in 'Check-up' or the double space in
    'Fasting Plasma Glucose  Analysis'."""
    for query in [
        "Full Body Check-up (Basic)",
        "full body check up basic",
        "full body checkup basic",
        "FULL BODY CHECKUP BASIC",
    ]:
        result = tools.lookup_item(query)
        assert result["confidence"] == "high", f"{query!r} -> {result['confidence']}"
        assert result["items"][0]["name"] == "Full Body Check-up (Basic)"
        assert result["items"][0]["price"] == 650
        assert result["items"][0]["mrp"] == 2780


def test_fuzzy_tier_catches_a_typo_from_stt():
    """A typo with exactly ONE plausible canonical resolves via fuzzy, confidently.

    Was "lipid profil" - which was a bad case for this tier and is now covered by
    test_lipid_is_ambiguous_and_must_ask below: the catalogue has THREE lipid
    profiles plus a standalone Cholesterol, so a confident single answer there was
    the bug, not the goal.
    """
    result = tools.lookup_item("vitamn d")
    assert result["found"] is True
    assert result["match_type"] == "fuzzy"
    assert result["confidence"] == "high"
    assert result["items"][0]["name"] == "Vitamin D"


def test_lipid_is_ambiguous_and_must_ask():
    """"lipid profil" must NOT resolve to one price.

    tests.json carries Lipid Profile, Lipid Profile (Basic), Lipid Profile
    (Extended) AND Cholesterol. Before alias-containment matching this fell to
    the fuzzy tier, which confidently returned a single "Lipid Profile" - i.e. it
    quoted one of three prices as though it were the answer. Ambiguity must
    degrade to a question.
    """
    result = tools.lookup_item("lipid profil")
    assert result["found"] is True
    assert result["confidence"] == "low"
    assert len(result["items"]) > 1
    assert result["clarify"]


def test_package_record_carries_contents_and_count_verbatim():
    """The 131-name gap: package contents[] names are NOT tests.json names
    ('eGFR (Estimated GFR)' has no row anywhere). contents must ride back exactly
    as scraped, for reading aloud - never priced by matching into tests.json."""
    result = tools.lookup_item("full body check-up basic")
    item = result["items"][0]
    assert item["tests_included"] == 10
    assert "Complete Blood Count (CBC)" in item["contents"]
    assert "eGFR (Estimated GFR)" in item["contents"]
    # Prove the trap is real, so nobody "helpfully" resolves contents later.
    all_test_names = {t["name"].strip().lower() for t in TESTS_JSON}
    assert "egfr (estimated gfr)" not in all_test_names
    assert "complete blood count (cbc)" not in all_test_names
    # And prove the tool did not try: no price fields were bolted onto contents.
    assert all(isinstance(c, str) for c in item["contents"])


def test_lookup_never_mutates_the_cached_knowledge():
    first = tools.lookup_item("vitamin d")
    first["items"][0]["price"] = 999999
    second = tools.lookup_item("vitamin d")
    assert second["items"][0]["price"] == 600, "records must be deep-copied per call"


def test_every_returned_item_is_a_real_row_from_the_knowledge_files():
    """Blanket anti-invention check across a spread of queries."""
    real = {t["name"] for t in TESTS_JSON} | {p["name"] for p in PACKAGES_JSON}
    for query in [
        "cbc", "sugar", "thyroid", "vitamin d", "full body checkup", "dengue",
        "widal", "psa", "beta hcg", "urine routine", "esr", "crp", "lipid profil",
        "kidney function", "quantum flux capacitor test",
    ]:
        result = tools.lookup_item(query)
        for item in result["items"] + result["candidates"]:
            assert item["name"] in real, f"{query!r} invented {item['name']!r}"


# =========================================================================
# 5. check_holiday
# =========================================================================


def test_verified_festival_is_closed():
    result = tools.check_holiday("2026-11-08")  # Diwali, Sunday
    assert result["open"] is False
    assert result["festival"] == "Diwali"
    assert result["verified"] is True


def test_uttarayan_is_closed():
    result = tools.check_holiday("2026-01-14")
    assert result["open"] is False
    assert result["festival"] == "Uttarayan"


def test_unverified_date_is_open_plus_a_confirming_caveat():
    """Brief section 3.4. The bot must not announce a closure the client has not
    signed off - but must not flatly promise 'open' either."""
    result = tools.check_holiday("2026-11-09")  # Day after Diwali, verified=false
    assert result["open"] is True
    assert result["verified"] is False
    assert result["caveat"] and "confirming" in result["caveat"].lower()
    assert result["festival"] == "Day after Diwali"
    assert result.get("closure_pending_confirmation") is True
    assert "Do NOT announce a closure" in result["note"]


def test_ordinary_day_is_open_with_no_festival():
    result = tools.check_holiday("2026-06-15")
    assert result["open"] is True
    assert result["festival"] is None
    assert result["caveat"] is None


def test_centre_hours_ride_back_on_every_answer():
    for date in ["2026-11-08", "2026-11-09", "2026-06-15", "nonsense"]:
        result = tools.check_holiday(date)
        assert result["hours"] == "8:00 AM to 8:00 PM"
        assert result["open_all_days"] is True


def test_date_outside_2026_is_not_asserted():
    result = tools.check_holiday("2027-01-14")
    assert result["verified"] is False
    assert result["caveat"], "only 2026 closures are known - must caveat"


def test_unparseable_date_refuses_to_answer():
    result = tools.check_holiday("not a date")
    assert result["open"] is None, "must not guess open/closed from a misheard date"
    assert "repeat" in result["note"].lower()


# =========================================================================
# 6. capture_lead  (simulated - writes leads.jsonl, no external calls)
# =========================================================================


@pytest.fixture()
def leads_file(tmp_path, monkeypatch):
    path = tmp_path / "leads.jsonl"
    monkeypatch.setenv("SUNPATH_LEADS_PATH", str(path))
    return path


def test_capture_lead_appends_a_json_line(leads_file):
    result = tools.capture_lead(
        kind="home_collection",
        name="Himanshu Patel",
        phone="98250 12345",
        area="Bopal",
        details="Full Body Check-up (Basic), tomorrow 9am",
    )
    assert result["ok"] is True
    assert result["lead_id"].startswith("SP-")
    assert result["simulated"] is True

    lines = leads_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["kind"] == "home_collection"
    assert record["name"] == "Himanshu Patel"
    assert record["phone_digits"] == "9825012345"
    assert record["area"] == "Bopal"


def test_capture_lead_appends_rather_than_overwrites(leads_file):
    tools.capture_lead("corporate", "Acme Ltd", "9876543210", "Naroda", "120 employees")
    tools.capture_lead("society", "Shivalik Society", "9876543211", "Satellite", "40 people")
    lines = leads_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert [json.loads(l)["kind"] for l in lines] == ["corporate", "society"]


def test_capture_lead_survives_a_gujarati_name(leads_file):
    result = tools.capture_lead("home_collection", "હિમાંશુ પટેલ", "9825012345", "બોપલ", "")
    assert result["ok"] is True
    record = json.loads(leads_file.read_text(encoding="utf-8").strip())
    assert record["name"] == "હિમાંશુ પટેલ", "Gujarati must survive the JSONL round-trip"


def test_capture_lead_rejects_an_unknown_kind(leads_file):
    result = tools.capture_lead("pizza_order", "X", "9825012345", "", "")
    assert result["ok"] is False
    assert result["error"] == "invalid_kind"
    assert not leads_file.exists(), "a rejected lead must not be written"


def test_capture_lead_asks_for_missing_fields(leads_file):
    result = tools.capture_lead("home_collection", "", "", "Bopal", "")
    assert result["ok"] is False
    assert result["error"] == "missing_fields"
    assert set(result["missing"]) == {"name", "phone"}
    assert not leads_file.exists()


def test_capture_lead_rejects_a_misheard_short_phone(leads_file):
    """STT drops digits on Gujarati number reads constantly. A lead we cannot
    ring back is a dead lead - make the bot re-ask instead."""
    result = tools.capture_lead("home_collection", "Himanshu", "98250", "Bopal", "")
    assert result["ok"] is False
    assert result["error"] == "phone_too_short"
    assert "repeat" in result["note"].lower()
    assert not leads_file.exists()


def test_capture_lead_accepts_a_country_code(leads_file):
    result = tools.capture_lead("home_collection", "Himanshu", "+91 98250 12345", "Bopal", "")
    assert result["ok"] is True
    assert json.loads(leads_file.read_text(encoding="utf-8"))["phone_digits"] == "919825012345"


# =========================================================================
# 7. escalate
# =========================================================================


def test_escalate_returns_the_doctor_script_and_number():
    result = tools.escalate("caller asked what their high TSH value means")
    assert result["contact_name"] == "Dr. Mayank Joshi"
    assert result["contact_number"] == "9276843433"
    assert "9276843433" in result["script"]
    assert "Dr. Mayank Joshi" in result["script"]
    assert result["customer_care"] == "079-67006700"


def test_escalate_forbids_interpretation_in_its_note():
    result = tools.escalate("report doubt")
    note = result["note"]
    assert "diagnosis" in note.lower() and "medicines" in note.lower()
