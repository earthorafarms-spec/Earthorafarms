"""Post-generation accuracy guard (brief section 7).

Runs after every LLM turn and BEFORE TTS. The contract this enforces:

  * The bot may never state a price it did not get from `lookup_item`.
  * If `lookup_item` WAS called, every price in the turn must appear in that
    tool's output (as `mrp` or `price`).
  * If it was NOT called and the turn contains a rupee amount, the turn is
    blocked - the model is told to call the tool instead of guessing.

Failure -> one silent regeneration with a corrective instruction. A SECOND
consecutive failure -> stop regenerating and speak the safe line
"હું ચોક્કસ કિંમત કન્ફર્મ કરીને જણાવું છું" ("I'll confirm the exact price and
let you know"). Every trigger is appended to eval/guard_log.jsonl - that file is
the demo-day evidence that the bot cannot invent a number.

Owner-doc pricing rule: quote MRP first, THEN the discounted price. Both numbers
are therefore legal to speak, and both are checked against the tool output.


THE FALSE-POSITIVE HEURISTIC
============================
The hard part is not catching hallucinated prices - it is NOT catching the four
other kinds of number a receptionist says constantly:

    "સવારે 8 થી રાત્રે 8"      timings          (brief section 6.3)
    "રિપોર્ટ 24 કલાકમાં"        TAT              (8 canonical TAT strings)
    "62 પેરામીટર / 10 ટેસ્ટ"    package counts   (tests_included)
    "079-67006700"             phone / pincode  (brief section 6.4)
    "2026-01-14"               holiday dates    (holidays_2026.json)

So the guard is built on POSITIVE EVIDENCE, not on negative filtering: a number
is assumed innocent and is only treated as a price when it carries an explicit
price marker. Nothing else is ever flagged, which is what makes a false
regeneration (the expensive failure - it adds a turn of latency to a 1.5s
voice-to-voice budget) structurally unlikely.

A number is a PRICE only if, in order:

  0. it has <= 5 digits. Real prices here run 40 - 28,600 and the brief's own
     normalizer only handles up to 99,999, so any 6+ digit run is a phone
     number or a pincode, never money.
  1. ATTACHED currency marker, prefix or suffix, within 2 chars:
     "₹400", "Rs. 400", "400 રૂપિયા", "650/-". This wins over every other rule -
     an attached ₹ is unambiguous.
  2. otherwise, a UNIT WORD within the next 16 chars disqualifies it:
     hours/કલાક/days/દિવસ/વાગ્યે/ટેસ્ટ/પેરામીટર/%/વર્ષ... The window is wide
     enough to cover ranges, so in "6 to 8 Hours" BOTH 6 and 8 see "Hours".
  3. otherwise, a time-of-day word immediately before it (સવારે/રાત્રે/at...)
     disqualifies it.
  4. otherwise, a PRICE WORD (કિંમત/ભાવ/MRP/discount/price...) within the 30
     chars before it, with no other digits in between, promotes it to a price.
     The window is deliberately tight and digit-blocked so that in
     "કિંમત 650 રૂપિયા, 10 ટેસ્ટ, રિપોર્ટ 24 કલાકમાં" the words 10 and 24 stay
     out of reach of "કિંમત".
  5. otherwise it is not a price.

Before any of that, spans that are definitionally not money are masked out of
the text (same-length fill, so offsets stay valid): clock times ("8:00 AM",
"8 PM"), ISO/slash dates, month-name dates, percentages, and any digit run of
8+ digits including separators (phone numbers - "079-67006700"). Masking is
digit-count-gated so a genuine range like "Rs 650 - 800" survives it.

Cost asymmetry that shaped the tuning: a missed hallucination is caught by the
human on the call, a false regeneration is heard by every caller as a stall.
When in doubt the guard stays quiet - EXCEPT for the no-lookup case, where any
price-marked number at all is blocked, because there the model is provably
speaking from memory.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent

#: Every guard trigger lands here as one JSON object per line (demo evidence).
GUARD_LOG = Path(os.environ.get("GUARD_LOG_PATH", str(ROOT / "eval" / "guard_log.jsonl")))

#: Spoken when regeneration has already failed once. Brief section 7, verbatim.
FALLBACK_GU = "હું ચોક્કસ કિંમત કન્ફર્મ કરીને જણાવું છું"

#: Prices are 40 - 28,600 across tests.json + packages.json; the TTS normalizer
#: only handles up to 99,999. Anything longer is a phone number or a pincode.
MAX_PRICE_DIGITS = 5

#: How far after a number we look for a disqualifying unit word. 16 chars covers
#: "6 to 8 Hours" and "15 to 48 Days" from the first number of the range.
UNIT_LOOKAHEAD = 16

#: How far before a number we look for a price word. Tight on purpose.
PRICE_WORD_LOOKBEHIND = 30

# --- lexicons -------------------------------------------------------------

# Attached currency. Longest alternatives first so "રૂપિયા" wins over "રૂ".
_CUR = r"₹|₨|Rs\.|Rs|INR|રૂપિયા|રુપિયા|રૂ\.|રુ\.|રૂ|રુ"

_CURRENCY_PREFIX_RE = re.compile(r"(?:" + _CUR + r")\s{0,2}$", re.IGNORECASE)
_CURRENCY_SUFFIX_RE = re.compile(
    r"^\s{0,2}(?:/-|₹|₨|રૂપિયામાં|રૂપિયા|રુપિયા|રૂ\.|રુ\.|રૂ|રુ|rupees|rupee|rs\.|rs|inr)",
    re.IGNORECASE,
)

# A unit word right after the number means it is a duration / count / time, not
# money. NOTE this is only consulted when there is no attached currency marker.
_UNIT_RE = re.compile(
    r"(?:hours?|hrs?|days?|minutes?|mins?|weeks?|months?|years?|tests?|parameters?"
    r"|params?|percent|કલાક|દિવસ|મિનિટ|અઠવાડિ|મહિન|વર્ષ|વાગ|બજે|ટેસ્ટ|પેરામીટર"
    r"|પરિમાણ|ટકા|નંગ)",
    re.IGNORECASE,
)

# "સવારે 8", "at 8" -> a clock time even without ":00".
_TIME_PREFIX_RE = re.compile(
    r"(?:સવારે|બપોરે|સાંજે|રાત્રે|રાતે|સવાર|રાત|morning|afternoon|evening|night|at|from|till|until)"
    r"\s*$",
    re.IGNORECASE,
)

# Promotes a bare number to a price when close enough in front of it.
_PRICE_WORD_RE = re.compile(
    r"(?:કિંમત|કીંમત|ભાવ|ચાર્જ|રેટ|ડિસ્કાઉન્ટ|એમઆરપી|ફી|પૈસા|prices?|costs?|charges?"
    r"|rates?|fees?|mrp|discount|discounted|amount|total|payable)",
    re.IGNORECASE,
)

_NUM_RE = re.compile(r"\d+(?:,\d+)*(?:\.\d+)?")

# --- spans that are definitionally not money ------------------------------

_MONTHS = (
    r"જાન્યુઆરી|ફેબ્રુઆરી|માર્ચ|એપ્રિલ|મે|જૂન|જુલાઈ|ઓગસ્ટ|સપ્ટેમ્બર|ઓક્ટોબર|નવેમ્બર|ડિસેમ્બર"
    r"|january|february|march|april|may|june|july|august|september|october|november|december"
    r"|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)

_MASK_PATTERNS: Sequence[re.Pattern] = (
    re.compile(r"\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?", re.IGNORECASE),  # 8:00 AM
    re.compile(r"\b\d{1,2}\s*[ap]\.?m\.?", re.IGNORECASE),                       # 8 PM
    re.compile(r"\b\d{4}-\d{1,2}-\d{1,2}\b"),                                    # 2026-01-14
    re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"),                            # 14/01/2026
    re.compile(r"\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:" + _MONTHS + r")\s*,?\s*\d{0,4}", re.IGNORECASE),
    re.compile(r"(?:" + _MONTHS + r")\s*\d{1,2}\s*,?\s*\d{0,4}", re.IGNORECASE),
    re.compile(r"\d+(?:\.\d+)?\s*%"),                                            # 20%
)

#: Phone-shaped: digits with separators. Only masked when it really carries 8+
#: digits, so a price range ("Rs 650 - 800", 6 digits) is NOT eaten.
_PHONE_CANDIDATE_RE = re.compile(r"\+?\d[\d\s\-().]{6,}\d")
_PHONE_MIN_DIGITS = 8

_GU_DIGITS = str.maketrans("૦૧૨૩૪૫૬૭૮૯", "0123456789")
_HI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# --- consecutive-failure state -------------------------------------------

_LOCK = threading.Lock()
_FAILURES: Dict[str, int] = {}


def reset_state(session_id: Optional[str] = None) -> None:
    """Clear the consecutive-failure counter (new call, or test isolation)."""
    with _LOCK:
        if session_id is None:
            _FAILURES.clear()
        else:
            _FAILURES.pop(session_id, None)


# --- number extraction ----------------------------------------------------


def _ascii_digits(text: str) -> str:
    """Fold Gujarati/Devanagari numerals to ASCII.

    NOT needed for detection - Python's `\\d` and `float()` already accept ૫૫૦
    natively. This is for the guard_log: the JSONL is demo-day evidence and the
    numbers in it have to be greppable and diffable against tests.json, so a
    logged price must read "550", not "૫૫૦". It also normalises mixed-script
    numbers ("૫50") that Gemini occasionally emits mid-Gujarati-sentence.
    """
    return text.translate(_GU_DIGITS).translate(_HI_DIGITS)


def _mask_non_price_spans(text: str) -> str:
    """Blank out clock times, dates, percentages and phone numbers.

    Same-length '#' fill so every offset in the masked copy still lines up with
    the original.
    """
    chars = list(text)

    def blank(start: int, end: int) -> None:
        for i in range(start, end):
            if not chars[i].isspace():
                chars[i] = "#"

    for pat in _MASK_PATTERNS:
        for m in pat.finditer(text):
            blank(m.start(), m.end())

    masked = "".join(chars)
    for m in _PHONE_CANDIDATE_RE.finditer(masked):
        if sum(c.isdigit() for c in m.group()) >= _PHONE_MIN_DIGITS:
            blank(m.start(), m.end())
    return "".join(chars)


def _to_number(raw: str) -> Optional[float]:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def extract_price_mentions(response_text: str) -> List[Dict[str, Any]]:
    """Every number in the turn that is being spoken AS MONEY.

    Returns dicts of {value, raw, why} - `why` records which rule fired, which
    is what makes a guard_log line debuggable after the demo.
    """
    if not response_text:
        return []

    text = _ascii_digits(response_text)
    masked = _mask_non_price_spans(text)

    found: List[Dict[str, Any]] = []
    for m in _NUM_RE.finditer(masked):
        raw = m.group()
        start, end = m.start(), m.end()

        # 0. too long to be money -> phone number / pincode.
        if sum(c.isdigit() for c in raw) > MAX_PRICE_DIGITS:
            continue

        value = _to_number(raw)
        if value is None:
            continue

        before = masked[:start]
        after = masked[end : end + UNIT_LOOKAHEAD]

        # 1. attached currency marker wins outright.
        if _CURRENCY_PREFIX_RE.search(before[-12:]):
            found.append({"value": value, "raw": raw, "why": "currency_prefix"})
            continue
        if _CURRENCY_SUFFIX_RE.match(after):
            found.append({"value": value, "raw": raw, "why": "currency_suffix"})
            continue

        # 2. a unit word right after -> duration / count / clock, not money.
        if _UNIT_RE.search(after):
            continue

        # 3. "સવારે 8" / "at 8" -> clock.
        if _TIME_PREFIX_RE.search(before[-14:]):
            continue

        # 4. a price word close in front, with no other number in between.
        window = before[-PRICE_WORD_LOOKBEHIND:]
        last = None
        for pw in _PRICE_WORD_RE.finditer(window):
            last = pw
        if last is not None and not re.search(r"\d", window[last.end() :]):
            found.append({"value": value, "raw": raw, "why": "price_word_context"})
            continue

        # 5. innocent until proven otherwise.

    return found


# --- tool-result parsing --------------------------------------------------

_PRICE_KEYS = {
    "price",
    "mrp",
    "amount",
    "cost",
    "fee",
    "rate",
    "total",
    "discounted_price",
    "discount_price",
    "offer_price",
    "list_price",
    "final_price",
    "net_price",
    "selling_price",
    "sun_price",
}


def collect_allowed_amounts(tool_results: Optional[Iterable[Any]]) -> List[float]:
    """Every number lookup_item actually returned under a price-ish key.

    Walks the whole structure, so it does not care whether tools.py returns a
    bare record, {"matches": [...]}, or {"candidates": [...], "confidence": ...}.
    Deliberately NOT "any number in the tool result" - that would legalise
    tests_included (62) or a TAT (24) as a price.
    """
    out: List[float] = []

    def walk(node: Any, key: Optional[str]) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, str(k).strip().lower())
        elif isinstance(node, (list, tuple, set)):
            for v in node:
                walk(v, key)
        elif key in _PRICE_KEYS:
            if isinstance(node, bool):
                return
            if isinstance(node, (int, float)):
                out.append(float(node))
            elif isinstance(node, str):
                for m in _NUM_RE.finditer(_ascii_digits(node)):
                    v = _to_number(m.group())
                    if v is not None:
                        out.append(v)

    if tool_results is None:
        return out
    if isinstance(tool_results, (dict, str)) or not isinstance(tool_results, Iterable):
        walk(tool_results, None)
    else:
        for item in tool_results:
            walk(item, None)
    return out


def _is_allowed(value: float, allowed: Sequence[float]) -> bool:
    return any(abs(value - a) < 0.005 for a in allowed)


# --- logging --------------------------------------------------------------


def _log(entry: Dict[str, Any]) -> None:
    """Append one JSON line. Must never raise into a live call."""
    try:
        path = Path(GUARD_LOG)
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False)
        with _LOCK:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
    except Exception:  # noqa: BLE001 - logging can never break the call
        pass


# --- public API -----------------------------------------------------------


def verify_turn(
    response_text: str,
    tool_results: Optional[List[Any]] = None,
    called_lookup: bool = False,
    *,
    session_id: str = "default",
) -> Dict[str, Any]:
    """Check one LLM turn before it is spoken.

    Args:
        response_text: the raw LLM turn (pre-normalization, so digits, not words).
        tool_results: the lookup_item result(s) available to that turn.
        called_lookup: whether lookup_item was actually called for this turn.
        session_id: keys the consecutive-failure counter (one call = one session).

    Returns:
        {"ok": bool, "action": "pass"|"regenerate"|"fallback", "reason": str, ...}
        plus "instruction" (what to tell the model on a regenerate),
        "fallback_text" (what to speak on a fallback), "prices", "allowed".
    """
    mentions = extract_price_mentions(response_text)
    spoken = [m["value"] for m in mentions]

    if called_lookup:
        allowed = collect_allowed_amounts(tool_results)
        bad = [m for m in mentions if not _is_allowed(m["value"], allowed)]
        if not bad:
            return _pass(session_id, spoken, allowed)

        bad_str = ", ".join(_fmt(m["value"]) for m in bad)
        ok_str = ", ".join(_fmt(a) for a in sorted(set(allowed))) or "(none)"
        reason = (
            f"price_not_in_tool_result: spoke {bad_str} but lookup_item returned {ok_str}"
        )
        instruction = (
            f"You stated the price {bad_str}, which is NOT in the lookup_item result. "
            f"The only prices you may say are the MRP and discounted price returned by "
            f"the tool: {ok_str}. Restate the answer using only those numbers, MRP first, "
            f"then the discounted price. Never invent or round a price."
        )
        return _fail(
            session_id=session_id,
            kind="price_mismatch",
            reason=reason,
            instruction=instruction,
            response_text=response_text,
            mentions=mentions,
            allowed=allowed,
            called_lookup=True,
        )

    if mentions:
        said = ", ".join(_fmt(v) for v in spoken)
        reason = f"price_without_lookup: stated {said} with no lookup_item call"
        instruction = (
            f"You stated the amount {said} without calling lookup_item. You must call "
            f"lookup_item for any price, MRP, fasting rule, TAT or package contents, and "
            f"use only the numbers it returns. Call lookup_item now and answer from its "
            f"output."
        )
        return _fail(
            session_id=session_id,
            kind="price_without_lookup",
            reason=reason,
            instruction=instruction,
            response_text=response_text,
            mentions=mentions,
            allowed=[],
            called_lookup=False,
        )

    return _pass(session_id, spoken, [])


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)


def _pass(session_id: str, spoken: List[float], allowed: List[float]) -> Dict[str, Any]:
    with _LOCK:
        _FAILURES.pop(session_id, None)
    return {
        "ok": True,
        "action": "pass",
        "reason": "ok",
        "prices": spoken,
        "allowed": sorted(set(allowed)),
    }


def _fail(
    *,
    session_id: str,
    kind: str,
    reason: str,
    instruction: str,
    response_text: str,
    mentions: List[Dict[str, Any]],
    allowed: List[float],
    called_lookup: bool,
) -> Dict[str, Any]:
    with _LOCK:
        attempt = _FAILURES.get(session_id, 0) + 1
        _FAILURES[session_id] = attempt

    if attempt >= 2:
        # Regeneration already failed once - stop trying and say the safe line.
        action = "fallback"
        with _LOCK:
            _FAILURES.pop(session_id, None)
    else:
        action = "regenerate"

    verdict: Dict[str, Any] = {
        "ok": False,
        "action": action,
        "reason": reason,
        "kind": kind,
        "attempt": attempt,
        "prices": [m["value"] for m in mentions],
        "allowed": sorted(set(allowed)),
    }
    if action == "regenerate":
        verdict["instruction"] = instruction
    else:
        verdict["fallback_text"] = FALLBACK_GU

    _log(
        {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
            "session_id": session_id,
            "kind": kind,
            "action": action,
            "attempt": attempt,
            "reason": reason,
            "called_lookup": called_lookup,
            "prices_spoken": [
                {"value": m["value"], "raw": m["raw"], "why": m["why"]} for m in mentions
            ],
            "allowed_amounts": sorted(set(allowed)),
            "response_text": response_text[:600],
            "fallback_text": FALLBACK_GU if action == "fallback" else None,
        }
    )
    return verdict
