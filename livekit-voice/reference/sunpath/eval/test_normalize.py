"""Tests for agent/normalize.py.

Run:  python -m pytest eval/test_normalize.py -q
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO))

from agent.normalize import (  # noqa: E402
    RESPELL,
    TAT_GU,
    apply_respell,
    gu_digits_to_words,
    gu_number_to_words,
    normalize_for_tts,
    normalize_money,
    normalize_phone,
    normalize_tat,
    normalize_time,
)

_DEVANAGARI_OR_LATIN_DIGIT = re.compile(r"[0-9]")


# ---------------------------------------------------------------------------
# gu_number_to_words -- exhaustive sweep + spot checks
# ---------------------------------------------------------------------------


def test_number_to_words_exhaustive_0_to_99999():
    """Every value 0..99999 must produce clean Gujarati words.

    This is the contract the money/time/TAT rules all sit on top of: a single
    throw or empty string anywhere in the range would be a live mid-call
    failure, so the whole range is swept rather than sampled.
    """
    for n in range(100000):
        try:
            out = gu_number_to_words(n)
        except Exception as exc:  # noqa: BLE001 -- we want the value in the message
            pytest.fail(f"gu_number_to_words({n}) raised {exc!r}")
        assert out, f"gu_number_to_words({n}) returned empty"
        assert out.strip() == out, f"gu_number_to_words({n}) has edge whitespace: {out!r}"
        assert "  " not in out, f"gu_number_to_words({n}) has double space: {out!r}"
        assert not _DEVANAGARI_OR_LATIN_DIGIT.search(out), (
            f"gu_number_to_words({n}) leaked a digit: {out!r}"
        )


def test_number_to_words_all_outputs_distinct():
    """Distinct integers must not collapse to the same words.

    A duplicate would mean a table typo (e.g. two entries sharing a word) that
    the sweep above cannot see -- and would make the bot quote a wrong price
    that still sounds fluent.
    """
    seen: dict[str, int] = {}
    for n in range(100000):
        out = gu_number_to_words(n)
        if out in seen:
            pytest.fail(f"{n} and {seen[out]} both render as {out!r}")
        seen[out] = n


@pytest.mark.parametrize(
    ("n", "expected"),
    [
        # --- 0..20: the irregular core
        (0, "શૂન્ય"),
        (1, "એક"),
        (2, "બે"),
        (6, "છ"),
        (8, "આઠ"),
        (10, "દસ"),
        (15, "પંદર"),
        (18, "અઢાર"),
        (20, "વીસ"),
        # --- tens boundaries, where Gujarati is least regular
        (24, "ચોવીસ"),
        (30, "ત્રીસ"),
        (45, "પિસ્તાલીસ"),
        (48, "અડતાલીસ"),
        (50, "પચાસ"),
        (60, "સાઠ"),
        (72, "બોતેર"),
        (80, "એંસી"),
        (90, "નેવું"),
        (99, "નવ્વાણું"),
        # --- hundreds: bare 100 is "સો", never "એકસો"
        (100, "સો"),
        (101, "એકસો એક"),
        (150, "એકસો પચાસ"),
        (200, "બસો"),
        (400, "ચારસો"),          # brief §6 worked example
        (600, "છસો"),
        (999, "નવસો નવ્વાણું"),
        # --- Indian grouping at હજાર
        (1000, "એક હજાર"),
        (1100, "એક હજાર એકસો"),  # NOT "એક હજાર સો"
        (1500, "એક હજાર પાંચસો"),
        (2000, "બે હજાર"),
        (6500, "છ હજાર પાંચસો"),  # max test price in tests.json
        (9000, "નવ હજાર"),        # max package price in packages.json
        (10000, "દસ હજાર"),
        (45000, "પિસ્તાલીસ હજાર"),
        (99999, "નવ્વાણું હજાર નવસો નવ્વાણું"),
    ],
)
def test_number_to_words_spot_checks(n, expected):
    assert gu_number_to_words(n) == expected


@pytest.mark.parametrize("bad", [-1, 100000, 10**6])
def test_number_to_words_rejects_out_of_range(bad):
    with pytest.raises(ValueError):
        gu_number_to_words(bad)


@pytest.mark.parametrize("bad", [1.5, "400", None, True])
def test_number_to_words_rejects_non_int(bad):
    with pytest.raises(TypeError):
        gu_number_to_words(bad)


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("₹400", "ચારસો રૂપિયા"),
        ("₹ 400", "ચારસો રૂપિયા"),
        ("₹400/-", "ચારસો રૂપિયા"),
        ("Rs. 400", "ચારસો રૂપિયા"),
        ("Rs.400", "ચારસો રૂપિયા"),
        ("Rs 400", "ચારસો રૂપિયા"),
        ("INR 400", "ચારસો રૂપિયા"),
        ("400 rupees", "ચારસો રૂપિયા"),
        ("₹1,100", "એક હજાર એકસો રૂપિયા"),
        ("₹6,500", "છ હજાર પાંચસો રૂપિયા"),
        ("રૂ. 600", "છસો રૂપિયા"),
        ("600 રૂપિયા", "છસો રૂપિયા"),
    ],
)
def test_money_forms(text, expected):
    assert normalize_money(text) == expected


def test_money_mrp_then_price_in_one_sentence():
    """Owner doc rule: quote MRP first, then the discounted price.

    Both amounts must convert independently in a single turn -- this is the
    single most common money sentence the bot will ever say.
    """
    src = "આ ટેસ્ટની MRP ₹1,100 છે, ડિસ્કાઉન્ટ પછી ₹600 થાય છે."
    out = normalize_money(src)
    assert "એક હજાર એકસો રૂપિયા" in out
    assert "છસો રૂપિયા" in out
    assert "₹" not in out


def test_money_above_range_left_untouched():
    """>99999 is out of gu_number_to_words range: leave it, never mangle it."""
    assert normalize_money("₹100000") == "₹100000"


def test_money_does_not_touch_bare_numbers():
    """No currency marker -> not money. '62 parameters' must survive intact."""
    assert normalize_money("62 parameters included") == "62 parameters included"


# ---------------------------------------------------------------------------
# TAT
# ---------------------------------------------------------------------------


def test_tat_map_covers_every_value_in_tests_json():
    """The TAT map must cover 100% of live tests.json values.

    If the catalogue gains a 9th TAT string this fails loudly, instead of the
    bot reading raw English digits mid-call.
    """
    tests = json.loads((_REPO / "knowledge" / "tests.json").read_text(encoding="utf-8"))
    live = {t["tat"] for t in tests if t.get("tat")}
    missing = {v for v in live if v.lower() not in TAT_GU}
    assert not missing, f"TAT values in tests.json with no Gujarati mapping: {missing}"
    assert len(live) == 8, f"expected 8 distinct TAT strings, found {len(live)}: {live}"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("6 to 8 Hours", "છ થી આઠ કલાક"),
        ("12 to 18 hours", "બાર થી અઢાર કલાક"),
        ("24 Hours", "ચોવીસ કલાક"),
        ("48 Hours", "અડતાલીસ કલાક"),
        ("48 to 72 Hours", "અડતાલીસ થી બોતેર કલાક"),
        ("3 Days", "ત્રણ દિવસ"),
        ("5 Days", "પાંચ દિવસ"),
        ("15 to 48 Days", "પંદર થી અડતાલીસ દિવસ"),
    ],
)
def test_tat_all_eight_exact_strings(text, expected):
    assert normalize_tat(text) == expected


def test_tat_longest_match_wins():
    """'48 to 72 Hours' must not be shredded by the '48 Hours' rule."""
    assert normalize_tat("48 to 72 Hours") == "અડતાલીસ થી બોતેર કલાક"
    assert "અડતાલીસ કલાક" not in normalize_tat("48 to 72 Hours")


def test_tat_case_insensitive_and_in_sentence():
    out = normalize_tat("રિપોર્ટ 6 TO 8 HOURS માં મળશે")
    assert out == "રિપોર્ટ છ થી આઠ કલાક માં મળશે"


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("8:00 AM", "સવારે આઠ વાગ્યે"),      # brief §6 worked example
        ("8:00 PM", "રાત્રે આઠ વાગ્યે"),
        ("8 AM", "સવારે આઠ વાગ્યે"),
        ("11:00 AM", "સવારે અગિયાર વાગ્યે"),
        ("12:00 PM", "બપોરે બાર વાગ્યે"),
        ("12:00 AM", "રાત્રે બાર વાગ્યે"),
        ("2:00 PM", "બપોરે બે વાગ્યે"),
        ("5:00 PM", "સાંજે પાંચ વાગ્યે"),
        ("8:30 AM", "સવારે આઠ વાગીને ત્રીસ મિનિટે"),
        ("7:45 PM", "રાત્રે સાત વાગીને પિસ્તાલીસ મિનિટે"),
        ("8:00 a.m.", "સવારે આઠ વાગ્યે"),
    ],
)
def test_time_forms(text, expected):
    assert normalize_time(text) == expected


def test_time_opening_hours_line():
    """The clinic timings line from the brief: 8:00 AM - 8:00 PM, all days."""
    out = normalize_time("અમે 8:00 AM થી 8:00 PM સુધી ખુલ્લા છીએ")
    assert out == "અમે સવારે આઠ વાગ્યે થી રાત્રે આઠ વાગ્યે સુધી ખુલ્લા છીએ"


def test_time_rejects_impossible_clock_values():
    assert normalize_time("13:00 PM") == "13:00 PM"
    assert normalize_time("8:99 AM") == "8:99 AM"


# ---------------------------------------------------------------------------
# Phone numbers
# ---------------------------------------------------------------------------


def test_phone_customer_care_matches_brief_example():
    """Brief §6 specifies this exact rendering for the customer care number."""
    expected = "શૂન્ય સાત નવ, છ સાત શૂન્ય શૂન્ય, છ સાત શૂન્ય શૂન્ય"
    assert normalize_phone("079-67006700") == expected


def test_phone_escalation_mobile_chunks_five_five():
    """Dr. Mayank Joshi's number: 10 bare digits -> 5+5."""
    out = normalize_phone("9276843433")
    assert out == "નવ બે સાત છ આઠ, ચાર ત્રણ ચાર ત્રણ ત્રણ"
    assert out.count(",") == 1


def test_phone_with_country_code():
    out = normalize_phone("+91 9276843433")
    assert out.startswith("પ્લસ ")
    assert "નવ એક" in out  # 91 read digit-by-digit


def test_phone_respects_author_separators_as_chunk_boundaries():
    """'079 6700 6700' already says where the chunks are; honour that."""
    assert normalize_phone("079 6700 6700") == normalize_phone("079-67006700")


def test_phone_leaves_short_numbers_alone():
    """<7 digits is never a phone number."""
    assert normalize_phone("6500") == "6500"
    assert normalize_phone("123456") == "123456"


def test_phone_threshold_cannot_collide_with_prices():
    """Structural guarantee: max quotable price (5 digits) < phone floor (7).

    This is why money and phone rules can coexist without ordering hazards.
    """
    for price in (40, 400, 6500, 9000, 99999):
        assert normalize_phone(str(price)) == str(price)


def test_phone_digits_all_gujarati():
    out = normalize_phone("079-67006700")
    assert not _DEVANAGARI_OR_LATIN_DIGIT.search(out)


# ---------------------------------------------------------------------------
# Respell
# ---------------------------------------------------------------------------


def test_respell_mechanism_with_injected_mapping():
    """Test the machinery, not the provisional seed values."""
    mapping = {"Widal": "વાઇડલ"}
    assert apply_respell("Widal Test", mapping) == "વાઇડલ Test"


def test_respell_longest_key_wins():
    mapping = {"TSH": "ટી એસ એચ", "TSH Receptor Antibody": "ટી એસ એચ રિસેપ્ટર એન્ટિબોડી"}
    out = apply_respell("TSH Receptor Antibody", mapping)
    assert out == "ટી એસ એચ રિસેપ્ટર એન્ટિબોડી"


def test_respell_is_boundary_guarded():
    """A key must not fire inside a longer word."""
    mapping = {"PSA": "પી એસ એ"}
    assert apply_respell("PSAX", mapping) == "PSAX"
    assert apply_respell("PSA", mapping) == "પી એસ એ"


def test_respell_empty_mapping_is_noop():
    assert apply_respell("TSH (Ultrasensitive)", {}) == "TSH (Ultrasensitive)"


def test_respell_keys_exist_in_real_catalogue():
    """Every RESPELL key must appear in a real canonical name, else it's dead.

    Guards the documented naming trap: there is no plain "CBC" row in
    tests.json (only "CBC With Mp By Antigen"), so a "CBC" key would never
    fire. Keys must be traceable to text the bot can actually say.
    """
    tests = json.loads((_REPO / "knowledge" / "tests.json").read_text(encoding="utf-8"))
    packages = json.loads((_REPO / "knowledge" / "packages.json").read_text(encoding="utf-8"))
    corpus = [t["name"] for t in tests] + [p["name"] for p in packages]
    for pkg in packages:
        for item in pkg.get("contents") or []:
            corpus.append(item if isinstance(item, str) else str(item))
    blob = " | ".join(corpus)
    for key in RESPELL:
        assert re.search(rf"(?<![^\W\d_]){re.escape(key)}(?![^\W\d_])", blob), (
            f"RESPELL key {key!r} appears in no canonical test/package name -- "
            f"it can never fire. Remove it or fix the spelling."
        )


# ---------------------------------------------------------------------------
# gu_digits_to_words
# ---------------------------------------------------------------------------


def test_digits_to_words():
    assert gu_digits_to_words("079") == "શૂન્ય સાત નવ"
    assert gu_digits_to_words("6700") == "છ સાત શૂન્ય શૂન્ય"
    assert gu_digits_to_words("") == ""


# ---------------------------------------------------------------------------
# normalize_for_tts -- integration
# ---------------------------------------------------------------------------


def test_full_pipeline_price_and_tat_turn():
    src = "આ ટેસ્ટની MRP ₹1,100 છે, ડિસ્કાઉન્ટ પછી ₹600. રિપોર્ટ 12 to 18 hours માં મળશે."
    out = normalize_for_tts(src)
    assert "એક હજાર એકસો રૂપિયા" in out
    assert "છસો રૂપિયા" in out
    assert "બાર થી અઢાર કલાક" in out
    assert not _DEVANAGARI_OR_LATIN_DIGIT.search(out)


def test_full_pipeline_timings_and_phone_turn():
    src = "અમે 8:00 AM થી 8:00 PM સુધી ખુલ્લા છીએ. કસ્ટમર કેર: 079-67006700."
    out = normalize_for_tts(src)
    assert "સવારે આઠ વાગ્યે" in out
    assert "રાત્રે આઠ વાગ્યે" in out
    assert "શૂન્ય સાત નવ, છ સાત શૂન્ય શૂન્ય, છ સાત શૂન્ય શૂન્ય" in out
    assert not _DEVANAGARI_OR_LATIN_DIGIT.search(out)


def test_full_pipeline_escalation_turn():
    src = "ડૉ. મયંક જોષી નો સંપર્ક કરો: 9276843433"
    out = normalize_for_tts(src)
    assert "નવ બે સાત છ આઠ, ચાર ત્રણ ચાર ત્રણ ત્રણ" in out


def test_full_pipeline_is_idempotent():
    """Every rule consumes digits and emits words, so pass 2 is a no-op.

    Matters because a retry path (guard.py regeneration) could plausibly
    normalize an already-normalized string.
    """
    src = "MRP ₹1,100, ભાવ ₹600. 8:00 AM થી. ફોન 079-67006700. 6 to 8 Hours."
    once = normalize_for_tts(src)
    assert normalize_for_tts(once) == once


def test_full_pipeline_handles_empty_and_plain_text():
    assert normalize_for_tts("") == ""
    assert normalize_for_tts("નમસ્તે, સન પેથોલોજીમાં આપનું સ્વાગત છે.") == (
        "નમસ્તે, સન પેથોલોજીમાં આપનું સ્વાગત છે."
    )


def test_full_pipeline_no_digits_survive_a_realistic_turn():
    """Any Latin digit reaching Chirp3-HD gu-IN is a pronunciation risk."""
    turns = [
        "CBC With Mp By Antigen ની કિંમત Rs. 400 છે, રિપોર્ટ 6 to 8 Hours માં.",
        "Vitamin D ટેસ્ટ ₹1,500 માં, 24 Hours માં રિપોર્ટ.",
        "અમારો નંબર 079-67006700 છે, સવારે 8:00 AM થી.",
        "Glycosylated Hb ( Hba I C ) MRP ₹800, ભાવ ₹450, 12 to 18 hours.",
    ]
    for turn in turns:
        out = normalize_for_tts(turn)
        assert not _DEVANAGARI_OR_LATIN_DIGIT.search(out), f"digits survived in: {out!r}"
