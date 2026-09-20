"""TTS text normalization for the Sun Pathology Gujarati voice receptionist.

Applied to EVERY LLM output before it reaches TTS (Chirp3-HD gu-IN).

Why this module exists
----------------------
Chirp3-HD gu-IN reads bare Latin digits and acronyms unreliably inside Gujarati
sentences: "Rs. 400" may come out in English, "079-67006700" gets read as one
enormous integer, and "8:00 AM" is anybody's guess. So every number that matters
(price, TAT, timing, phone) is converted to explicit Gujarati words here rather
than left to the voice model.

KNOWN PLATFORM LIMITATION (see brief section 5): custom pronunciations are NOT
available for gu-IN Chirp3-HD. The only lever for a mispronounced name is
respelling the text before synthesis -- hence RESPELL below.

Pipeline order inside normalize_for_tts() is deliberate:
    respell -> TAT -> money -> time -> phone -> whitespace
  * TAT runs before money/phone so the fixed strings ("48 to 72 Hours") are
    consumed whole rather than shredded into loose digits.
  * money runs before phone so a currency-marked run of digits can never be
    mistaken for a telephone number.
  * phone runs last and requires >= 7 digits. Prices in this catalogue top out
    at 9000 (packages) / 6500 (tests) and gu_number_to_words caps at 99999
    -- 5 digits -- so a price can never reach the phone threshold. That gap is
    load-bearing, not luck.

Pricing note (owner doc overrides the brief): the receptionist quotes MRP FIRST,
then the discounted price. That means two money amounts routinely land in one
sentence; _normalize_money handles each match independently.

Pure stdlib. No third-party dependencies.
"""

from __future__ import annotations

import re

__all__ = [
    "gu_number_to_words",
    "gu_digits_to_words",
    "normalize_for_tts",
    "normalize_money",
    "normalize_tat",
    "normalize_time",
    "normalize_phone",
    "apply_respell",
    "RESPELL",
    "TAT_GU",
]


# ---------------------------------------------------------------------------
# 1. Gujarati number -> words (0..99999, Indian grouping)
# ---------------------------------------------------------------------------

# Gujarati has an irregular, individually-named form for every value 0..99
# (like Hindi). There is no productive rule -- 45 is "પિસ્તાલીસ", not
# "ચાર-દસ-પાંચ" -- so 0..99 must be a table. Everything above 99 IS rule-driven
# and is composed below.
_ONES: tuple[str, ...] = (
    "શૂન્ય",        # 0
    "એક",           # 1
    "બે",           # 2
    "ત્રણ",         # 3
    "ચાર",          # 4
    "પાંચ",         # 5
    "છ",            # 6
    "સાત",          # 7
    "આઠ",           # 8
    "નવ",           # 9
    "દસ",           # 10
    "અગિયાર",       # 11
    "બાર",          # 12
    "તેર",          # 13
    "ચૌદ",          # 14
    "પંદર",         # 15
    "સોળ",          # 16
    "સત્તર",        # 17
    "અઢાર",         # 18
    "ઓગણીસ",        # 19
    "વીસ",          # 20
    "એકવીસ",        # 21
    "બાવીસ",        # 22
    "તેવીસ",        # 23
    "ચોવીસ",        # 24
    "પચ્ચીસ",       # 25
    "છવ્વીસ",       # 26
    "સત્તાવીસ",     # 27
    "અઠ્ઠાવીસ",     # 28
    "ઓગણત્રીસ",     # 29
    "ત્રીસ",        # 30
    "એકત્રીસ",      # 31
    "બત્રીસ",       # 32
    "તેત્રીસ",      # 33
    "ચોત્રીસ",      # 34
    "પાંત્રીસ",     # 35
    "છત્રીસ",       # 36
    "સાડત્રીસ",     # 37
    "આડત્રીસ",      # 38
    "ઓગણચાલીસ",     # 39
    "ચાલીસ",        # 40
    "એકતાલીસ",      # 41
    "બેતાલીસ",      # 42
    "ત્રેતાલીસ",    # 43
    "ચુંમાલીસ",     # 44
    "પિસ્તાલીસ",    # 45
    "છેંતાલીસ",     # 46
    "સુડતાલીસ",     # 47
    "અડતાલીસ",      # 48
    "ઓગણપચાસ",      # 49
    "પચાસ",         # 50
    "એકાવન",        # 51
    "બાવન",         # 52
    "ત્રેપન",       # 53
    "ચોપન",         # 54
    "પંચાવન",       # 55
    "છપ્પન",        # 56
    "સત્તાવન",      # 57
    "અઠ્ઠાવન",      # 58
    "ઓગણસાઠ",       # 59
    "સાઠ",          # 60
    "એકસઠ",         # 61
    "બાસઠ",         # 62
    "ત્રેસઠ",       # 63
    "ચોસઠ",         # 64
    "પાંસઠ",        # 65
    "છાસઠ",         # 66
    "સડસઠ",         # 67
    "અડસઠ",         # 68
    "ઓગણસિત્તેર",   # 69
    "સિત્તેર",      # 70
    "એકોતેર",       # 71
    "બોતેર",        # 72
    "તોતેર",        # 73
    "ચુમોતેર",      # 74
    "પંચોતેર",      # 75
    "છોતેર",        # 76
    "સિત્યોતેર",    # 77
    "ઇઠ્યોતેર",     # 78
    "ઓગણાએંસી",     # 79
    "એંસી",         # 80
    "એક્યાસી",      # 81
    "બ્યાસી",       # 82
    "ત્યાસી",       # 83
    "ચોર્યાસી",     # 84
    "પંચ્યાસી",     # 85
    "છ્યાસી",       # 86
    "સિત્યાસી",     # 87
    "ઈઠ્યાસી",      # 88
    "નેવ્યાસી",     # 89
    "નેવું",        # 90
    "એકાણું",       # 91
    "બાણું",        # 92
    "ત્રાણું",      # 93
    "ચોરાણું",      # 94
    "પંચાણું",      # 95
    "છન્નું",       # 96
    "સત્તાણું",     # 97
    "અઠ્ઠાણું",     # 98
    "નવ્વાણું",     # 99
)
assert len(_ONES) == 100

# Hundreds are regular: digit + "સો". 100 alone is spoken "સો"; inside a larger
# number it becomes "એકસો" ("એક હજાર સો" is wrong, "એક હજાર એકસો" is right).
_HUNDREDS: tuple[str, ...] = (
    "",
    "એકસો",
    "બસો",
    "ત્રણસો",
    "ચારસો",
    "પાંચસો",
    "છસો",
    "સાતસો",
    "આઠસો",
    "નવસો",
)

_THOUSAND = "હજાર"
_RUPEES = "રૂપિયા"


def _gu_below_thousand(n: int) -> str:
    """1..999 -> Gujarati words. Internal; assumes range already validated."""
    hundreds, rest = divmod(n, 100)
    parts: list[str] = []
    if hundreds:
        parts.append(_HUNDREDS[hundreds])
    if rest:
        parts.append(_ONES[rest])
    return " ".join(parts)


def gu_number_to_words(n: int) -> str:
    """Convert an integer 0..99999 to Gujarati words using Indian grouping.

    Indian grouping means the split is at the thousand (હજાર), and the
    thousands-count itself is a full 0..99 word -- so 45000 is
    "પિસ્તાલીસ હજાર" (forty-five thousand), never "four ten five thousand".

    Examples:
        0     -> શૂન્ય
        100   -> સો
        400   -> ચારસો
        1000  -> એક હજાર
        1500  -> એક હજાર પાંચસો
        6500  -> છ હજાર પાંચસો
        99999 -> નવ્વાણું હજાર નવસો નવ્વાણું

    Raises:
        TypeError: if n is not an int (bool is rejected too).
        ValueError: if n is outside 0..99999.
    """
    if isinstance(n, bool) or not isinstance(n, int):
        raise TypeError(f"gu_number_to_words expects int, got {type(n).__name__}")
    if n < 0 or n > 99999:
        raise ValueError(f"gu_number_to_words supports 0..99999, got {n}")

    if n < 100:
        return _ONES[n]
    if n == 100:
        # Bare hundred is "સો", not "એકસો".
        return "સો"

    thousands, rest = divmod(n, 1000)
    parts: list[str] = []
    if thousands:
        # thousands is 1..99 -- exactly the range _ONES covers, which is the
        # whole point of Indian grouping.
        parts.append(f"{_ONES[thousands]} {_THOUSAND}")
    if rest:
        parts.append(_gu_below_thousand(rest))
    return " ".join(parts)


# ---------------------------------------------------------------------------
# 2. Money
# ---------------------------------------------------------------------------

# Matches: ₹400  ₹ 1,200  ₹400/-  Rs.400  Rs 400  INR 400  રૂ. 400
#
# The comma-grouped branch requires at least ONE group (+, not *). With * it
# also matched a bare "100", so "₹100000" captured just "100" -> "સો રૂપિયા000"
# ("hundred rupees000") instead of falling through to \d+ and being left alone
# as out-of-range. Ordered alternation never reached \d+ because the first
# branch already succeeded on the 3-digit prefix.
_MONEY_PREFIX_RE = re.compile(
    r"(?:₹|\bRs\.?|\bINR\b|\bરૂ\.?)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\s*/-)?",
    re.IGNORECASE,
)
# Matches: 400 rupees  400 rs  400 રૂપિયા
_MONEY_SUFFIX_RE = re.compile(
    r"(\d{1,3}(?:,\d{2,3})+|\d+)\s*(?:rupees\b|rupee\b|\bRs\.?|રૂપિયા)",
    re.IGNORECASE,
)


def _money_sub(match: re.Match) -> str:
    raw = match.group(1).replace(",", "")
    try:
        value = int(raw)
        words = gu_number_to_words(value)
    except (ValueError, TypeError):
        # Out of range (>99999) or unparseable: leave the original text alone
        # rather than emit something wrong. The guard layer will catch a
        # genuinely bogus amount; silently mangling it here would be worse.
        return match.group(0)
    return f"{words} {_RUPEES}"


def normalize_money(text: str) -> str:
    """₹400 / Rs. 400 / 400 rupees -> 'ચારસો રૂપિયા'.

    Prefix forms are handled first so "Rs. 400" is not also caught by the
    suffix rule. Amounts above 99999 are left untouched (see _money_sub).
    """
    text = _MONEY_PREFIX_RE.sub(_money_sub, text)
    text = _MONEY_SUFFIX_RE.sub(_money_sub, text)
    return text


# ---------------------------------------------------------------------------
# 3. TAT (turnaround time)
# ---------------------------------------------------------------------------

# These are ALL 8 exact `tat` values present in knowledge/tests.json, verified
# by reading the file (counts at time of writing: 6 to 8 Hours=172,
# 12 to 18 hours=130, 48 to 72 Hours=6, 5 Days=2, 15 to 48 Days=2, 3 Days=2,
# 48 Hours=1, 24 Hours=1). Keys are lowercased for case-insensitive lookup
# because the source data is inconsistent ("Hours" vs "hours").
#
# If tests.json ever gains a new TAT value, this map must gain a row. The
# eval suite asserts full coverage against the live file so a new value fails
# loudly instead of being spoken as bare English digits.
TAT_GU: dict[str, str] = {
    "6 to 8 hours": "છ થી આઠ કલાક",
    "12 to 18 hours": "બાર થી અઢાર કલાક",
    "24 hours": "ચોવીસ કલાક",
    "48 hours": "અડતાલીસ કલાક",
    "48 to 72 hours": "અડતાલીસ થી બોતેર કલાક",
    "3 days": "ત્રણ દિવસ",
    "5 days": "પાંચ દિવસ",
    "15 to 48 days": "પંદર થી અડતાલીસ દિવસ",
}

# Longest-first so "48 to 72 Hours" wins over "48 Hours".
_TAT_RE = re.compile(
    "|".join(re.escape(k) for k in sorted(TAT_GU, key=len, reverse=True)),
    re.IGNORECASE,
)


def normalize_tat(text: str) -> str:
    """Map the 8 exact tests.json TAT strings to Gujarati."""
    return _TAT_RE.sub(lambda m: TAT_GU[m.group(0).lower()], text)


# ---------------------------------------------------------------------------
# 4. Times
# ---------------------------------------------------------------------------

_PERIOD_LATE_NIGHT = "રાત્રે"   # 00:00-03:59
_PERIOD_MORNING = "સવારે"      # 04:00-11:59
_PERIOD_AFTERNOON = "બપોરે"    # 12:00-15:59
_PERIOD_EVENING = "સાંજે"      # 16:00-18:59
_PERIOD_NIGHT = "રાત્રે"       # 19:00-23:59

# "8:00 AM"  "8:00AM"  "8:00 a.m."  "8 PM"
#
# The trailing dot must be consumed AFTER the word boundary, not before it:
# with `[Mm]\.?\b`, "8:00 a.m." backtracked (no \b exists between "." and end
# of string), matched only "8:00 a.m" and left an orphan "." for the TTS to
# read as a pause. `[Mm]\b\.?` takes the boundary right after the "m" and then
# eats the final dot.
_TIME_RE = re.compile(
    r"\b(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\b\.?",
)


def _period_for_hour24(hour24: int) -> str:
    if hour24 < 4:
        return _PERIOD_LATE_NIGHT
    if hour24 < 12:
        return _PERIOD_MORNING
    if hour24 < 16:
        return _PERIOD_AFTERNOON
    if hour24 < 19:
        return _PERIOD_EVENING
    return _PERIOD_NIGHT


def _time_sub(match: re.Match) -> str:
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = match.group(3).lower()

    if hour < 1 or hour > 12 or minute > 59:
        return match.group(0)  # not a real clock time; leave it

    if meridiem == "a":
        hour24 = 0 if hour == 12 else hour
    else:
        hour24 = 12 if hour == 12 else hour + 12

    period = _period_for_hour24(hour24)
    hour_words = gu_number_to_words(hour)  # spoken as the 12-hour number

    if minute == 0:
        return f"{period} {hour_words} વાગ્યે"
    return f"{period} {hour_words} વાગીને {gu_number_to_words(minute)} મિનિટે"


def normalize_time(text: str) -> str:
    """'8:00 AM' -> 'સવારે આઠ વાગ્યે'; '8:30 PM' -> 'રાત્રે આઠ વાગીને ત્રીસ મિનિટે'."""
    return _TIME_RE.sub(_time_sub, text)


# ---------------------------------------------------------------------------
# 5. Phone numbers
# ---------------------------------------------------------------------------

_DIGIT_WORDS: tuple[str, ...] = _ONES[:10]  # 0..9 -- same table, no drift


def gu_digits_to_words(digits: str) -> str:
    """'079' -> 'શૂન્ય સાત નવ'. Digit-by-digit, no place value."""
    return " ".join(_DIGIT_WORDS[int(d)] for d in digits if d.isdigit())


def _chunk_digits(group: str) -> list[str]:
    """Split one digit run into speakable chunks.

    <=5 digits stay whole. 6..10 split near the middle, which reproduces the
    natural Indian reading: 8 -> 4+4 (67006700), 10 -> 5+5 (mobile numbers),
    6 -> 3+3. >10 falls back to groups of 4.
    """
    n = len(group)
    if n <= 5:
        return [group]
    if n <= 10:
        half = n // 2
        return [group[:half], group[half:]]
    return [group[i:i + 4] for i in range(0, n, 4)]


# A phone number: optional +, then >=7 digits total across groups separated by
# -, space, ., or brackets. The >=7 floor is what keeps prices (<=5 digits,
# capped by gu_number_to_words) out of this rule entirely.
_PHONE_RE = re.compile(
    r"(?<![\d\w])"
    r"(\+?\d[\d\s\-().]{5,}\d)"
    r"(?![\d])"
)


def _phone_sub(match: re.Match) -> str:
    raw = match.group(0)
    digit_count = sum(c.isdigit() for c in raw)
    if digit_count < 7 or digit_count > 13:
        return raw

    plus = raw.strip().startswith("+")
    # Author's separators are chunk boundaries we should respect: "079-67006700"
    # is already telling us where the STD code ends.
    groups = [g for g in re.split(r"[\s\-().]+", raw.strip().lstrip("+")) if g]
    if not groups or not all(g.isdigit() for g in groups):
        return raw

    chunks: list[str] = []
    for group in groups:
        chunks.extend(_chunk_digits(group))

    spoken = ", ".join(gu_digits_to_words(c) for c in chunks)
    # Comma is the only pause lever available: [pause] markup tags are markup-
    # field-only and we send plain text through streaming_synthesize.
    return f"પ્લસ {spoken}" if plus else spoken


def normalize_phone(text: str) -> str:
    """'079-67006700' -> 'શૂન્ય સાત નવ, છ સાત શૂન્ય શૂન્ય, છ સાત શૂન્ય શૂન્ય'.

    '9276843433' -> 5+5 chunks. '+91 9276843433' keeps a spoken 'પ્લસ'.
    """
    return _PHONE_RE.sub(_phone_sub, text)


# ---------------------------------------------------------------------------
# 6. Respell dict
# ---------------------------------------------------------------------------

# Chirp3-HD gu-IN offers NO custom-pronunciation / lexicon support (brief §5),
# so respelling the source text is the only fix for a mangled name.
#
# THIS DICT GROWS DURING VOICE TESTING. The workflow is: hear a mispronounced
# name in a real call -> add the exact source spelling as the key -> add a
# Gujarati-script respelling that synthesises correctly -> add a case to
# eval/test_normalize.py. Do not add speculative entries; every row should be
# traceable to a clip where the default reading was actually wrong.
#
# Constraint: keys must be text that genuinely appears in bot output, i.e.
# canonical names from knowledge/tests.json + knowledge/packages.json. Inventing
# a key like "CBC" is useless here -- there is no plain "CBC" row in tests.json
# (the real row is "CBC With Mp By Antigen"), so it would never fire.
#
# The two seeds below are PROVISIONAL: bare Latin acronyms embedded in Gujarati
# sentences are the highest-risk case, and both substrings do occur in real
# canonical names ("TSH (Ultrasensitive)", "PSA"). Confirm or delete them after
# the first voice pass -- they are a starting hypothesis, not a verified fix.
RESPELL: dict[str, str] = {
    "TSH": "ટી એસ એચ",   # PROVISIONAL -- verify in voice testing
    "PSA": "પી એસ એ",    # PROVISIONAL -- verify in voice testing
}


def _build_respell_re(mapping: dict[str, str]) -> re.Pattern | None:
    if not mapping:
        return None
    # Longest key first: a later "TSH Receptor Antibody" entry must beat "TSH".
    keys = sorted(mapping, key=len, reverse=True)
    return re.compile(
        r"(?<![^\W\d_])(" + "|".join(re.escape(k) for k in keys) + r")(?![^\W\d_])"
    )


_RESPELL_RE = _build_respell_re(RESPELL)


def apply_respell(text: str, mapping: dict[str, str] | None = None) -> str:
    """Replace known-mispronounced names with TTS-safe respellings.

    Matching is case-sensitive (these are acronyms and proper names) and
    boundary-guarded, so "TSH" in "TSH (Ultrasensitive)" is replaced but the
    "PSA" inside a hypothetical "PSAX" is not.

    Args:
        mapping: override for tests / experiments. Defaults to RESPELL.
    """
    if mapping is None:
        mapping, pattern = RESPELL, _RESPELL_RE
    else:
        pattern = _build_respell_re(mapping)
    if pattern is None:
        return text
    return pattern.sub(lambda m: mapping[m.group(1)], text)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"[ \t]{2,}")


def normalize_for_tts(text: str) -> str:
    """Normalize one LLM turn for Chirp3-HD gu-IN synthesis.

    Applies, in order: respell, TAT, money, time, phone, whitespace cleanup.
    See the module docstring for why the order is what it is.

    Idempotent in practice: every rule consumes Latin digits and emits Gujarati
    words, so a second pass finds nothing left to match.
    """
    if not text:
        return text
    text = apply_respell(text)
    text = normalize_tat(text)
    text = normalize_money(text)
    text = normalize_time(text)
    text = normalize_phone(text)
    text = _WS_RE.sub(" ", text)
    return text.strip()


if __name__ == "__main__":  # manual smoke check
    samples = [
        "આ ટેસ્ટની MRP ₹1,100 છે અને ડિસ્કાઉન્ટ પછી Rs. 600 થાય છે.",
        "રિપોર્ટ 12 to 18 hours માં મળી જશે.",
        "અમે 8:00 AM થી 8:00 PM સુધી ખુલ્લા છીએ.",
        "કસ્ટમર કેર નંબર 079-67006700 છે.",
        "ડૉ. મયંક જોષી: 9276843433",
        "TSH (Ultrasensitive) ટેસ્ટ 6 to 8 Hours માં થાય છે.",
    ]
    for s in samples:
        print(f"IN : {s}\nOUT: {normalize_for_tts(s)}\n")
