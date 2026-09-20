"""The four receptionist tools (brief section 8).

Plain Python functions, no framework imports - agent/main.py wraps each one in a
LiveKit @function_tool. Knowledge JSON is read ONCE at import and cached in
module state, so a live call never touches the disk.

WHY THIS FILE IS THE ACCURACY CORE
----------------------------------
The LLM is forbidden from stating a price, TAT, fasting rule or package content
from memory (brief sections 1 + 3.1). Every one of those numbers must come out of
`lookup_item`. So the only two failure modes that matter here are:

  1. returning a WRONG record confidently  -> the bot quotes a wrong price
  2. returning NOTHING for a real test     -> the bot stonewalls a real caller

(1) is far worse than (2), so every ambiguity resolves to `confidence: "low"`,
which the system prompt turns into a question rather than an assertion.

RESOLUTION ORDER (brief section 4)
----------------------------------
  1. exact / normalized name match  (punctuation- and spacing-insensitive)
  2. aliases.json                   (192 entries: English, abbreviations,
                                     Gujarati script, Roman-Gujarati, and
                                     anticipated chirp_2 gu-IN misrecognitions)
  3. rapidfuzz token_set_ratio >= 85 against all 377 names
  4. below 85 -> up to 3 suggestions, found=False, confidence "low"

TRAPS FOR ANYONE EDITING THIS FILE
----------------------------------
* There is NO plain "CBC" row in tests.json. The lab's row is
  "CBC With Mp By Antigen" (CBC bundled with a malaria antigen). "cbc" therefore
  resolves via aliases.json to 3 candidates + a clarify question and is ALWAYS
  low-confidence. Do not "fix" this by hard-coding CBC -> that row; the price
  differs and the caller has to be asked.
* Package `contents[]` names are NOT tests.json names. 131 of 848 content lines
  have no tests.json row at all ("eGFR (Estimated GFR)" has none; packages say
  "Fasting Blood Sugar (FBS)" where tests.json says "Fasting Plasma Glucose
  Analysis"). NEVER price a package's contents by matching them back to
  tests.json - it silently invents prices. `contents` is returned verbatim, for
  reading aloud only, alongside `tests_included` for the "N parameters" line.
* token_set_ratio scores a short query that is a substring of a long name at 100
  ("cbc" vs "CBC With Mp By Antigen" = 100). That is why a fuzzy hit is only
  high-confidence when exactly ONE name clears the gate.
"""

from __future__ import annotations

import copy
import json
import os
import re
import unicodedata
import uuid
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from rapidfuzz import fuzz

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"
LEADS_PATH = ROOT / "leads.jsonl"

# --- tunables -------------------------------------------------------------

FUZZ_ACCEPT = 85  # brief section 4 step 3: token_set_ratio >= 85 is a match
FUZZ_FLOOR = 60  # below this we do not even suggest - a wrong guess is worse
MAX_CANDIDATES = 3  # brief section 4 step 4: top-3

# --- facts (owner's Master Training Document, mirrored in prompts/system_gu.md)

CENTRE_HOURS = "8:00 AM to 8:00 PM"
OPEN_ALL_DAYS = True
CUSTOMER_CARE = "079-67006700"
ESCALATION_NAME = "Dr. Mayank Joshi"
ESCALATION_NUMBER = "9276843433"

# Owner doc section 11 ("a strict Sun Pathology rule"): MRP first, THEN the
# discounted price. The build brief section 3.1 said discount-only; the doc wins
# and config.py owns the switch. Imported defensively so this module still works
# when loaded outside the agent package (evals, notebooks, a bare `import tools`).
try:  # pragma: no cover - trivial fallback
    from . import config as _config

    PRICE_QUOTE_STYLE = _config.PRICE_QUOTE_STYLE
except Exception:  # noqa: BLE001
    PRICE_QUOTE_STYLE = os.environ.get("PRICE_QUOTE_STYLE", "mrp_then_discount").strip()

VALID_LEAD_KINDS = ("home_collection", "corporate", "society")
IST = timezone(timedelta(hours=5, minutes=30))

# Owner playbook 2026-07-14: the only two humans a caller can be handed to.
# The split is the owner's, not ours: corporate / society / report-doubt go to
# Dr. Joshi, everything else to the customer care desk.
TRANSFER_TARGETS: Dict[str, Dict[str, str]] = {
    "customer_care": {
        "number": CUSTOMER_CARE,
        "who_gu": "અમારી ટીમ",
        "label_gu": "કસ્ટમર કેર",
        "label_en": "Sun Pathology customer care",
    },
    "dr_joshi": {
        "number": ESCALATION_NUMBER,
        "who_gu": "ડૉ. મયંક જોષી",
        "label_gu": "ડૉ. મયંક જોષી",
        "label_en": ESCALATION_NAME,
    },
}

# Master escalation script, verbatim from prompts/system_gu.md section 18. The
# prompt's scripts are written in English on purpose - section 1 tells the model
# to deliver them in the caller's language with every fact kept exact.
ESCALATION_SCRIPT = (
    "If you have any concern regarding your report, please send the reports on "
    f"WhatsApp to {ESCALATION_NAME} at {ESCALATION_NUMBER}, and then call him for guidance."
)


# --- normalization --------------------------------------------------------

_WS = re.compile(r"\s+")

# Combining marks: every Gujarati vowel sign (ે ા ી), the virama (્) and the
# anusvara (ં) live here.
_MARKS = ("Mn", "Mc", "Me")


def _is_kept(ch: str) -> bool:
    return ch.isalnum() or ch.isspace() or unicodedata.category(ch) in _MARKS


def _norm(value: Any) -> str:
    """Lowercase, drop punctuation, collapse whitespace. Gujarati script survives.

    DO NOT "simplify" this back to `re.sub(r"[^\\w\\s]", " ", text)`. That is what
    it used to be, and it was silently destroying Gujarati: Python's `\\w` is
    `str.isalnum()` + underscore, and a Gujarati matra is Unicode category Mn, so
    isalnum() is False for it. Every vowel sign was being replaced by a SPACE --
    "પેકેજ" normalized to "પ ક જ", i.e. three one-letter tokens. Consequences:

      * aliases.json's Gujarati-script surface forms only matched because BOTH
        sides were mangled identically, and any alias whose mangling collided
        with another's matched the wrong record.
      * token_set_ratio over bags of one-letter tokens scores near-random text
        in the 70s ("what colour is your furniture" hit "are your machines good"
        at 76), which is exactly how a router starts guessing.

    Keeping category M* is the whole fix; ASCII behaviour is unchanged.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = "".join(ch if _is_kept(ch) else " " for ch in text)
    return _WS.sub(" ", text).strip()


def _squash(value: Any) -> str:
    """Normalized form with spaces removed too.

    Absorbs the spacing noise this dataset is full of: "Check-up" vs "checkup",
    "Hb A1c" vs "HbA1c", and the double space in "Fasting Plasma Glucose
    Analysis". Collisions between two genuinely different names are vanishingly
    unlikely, and if one happened it would surface as 2 items -> low confidence.
    """
    return _norm(value).replace(" ", "")


# --- knowledge load (once, at import) -------------------------------------


def _load_json(name: str, default: Any) -> Any:
    """Read a knowledge file. Missing/corrupt -> default, so one bad file
    degrades a single tool instead of killing the worker mid-call."""
    path = KNOWLEDGE / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


_TESTS: List[Dict[str, Any]] = [r for r in _load_json("tests.json", []) if isinstance(r, dict)]
_PACKAGES: List[Dict[str, Any]] = [r for r in _load_json("packages.json", []) if isinstance(r, dict)]
_HOLIDAYS: Dict[str, Any] = _load_json("holidays_2026.json", {}) or {}
_ALIAS_FILE: Any = _load_json("aliases.json", {})

# tests.json rows carry type="test", packages.json rows type="package".
ITEMS: List[Dict[str, Any]] = [r for r in (_TESTS + _PACKAGES) if r.get("name")]


def _index_names() -> Tuple[Dict[str, List[int]], Dict[str, List[int]], List[str]]:
    by_norm: Dict[str, List[int]] = {}
    by_squash: Dict[str, List[int]] = {}
    norm_names: List[str] = []
    for idx, rec in enumerate(ITEMS):
        n = _norm(rec["name"])
        s = _squash(rec["name"])
        if not n:
            continue
        if n not in by_norm:
            by_norm[n] = []
            norm_names.append(n)
        by_norm[n].append(idx)
        by_squash.setdefault(s, []).append(idx)
    return by_norm, by_squash, norm_names


_BY_NORM, _BY_SQUASH, _NORM_NAMES = _index_names()


def _index_aliases() -> Tuple[Dict[str, List[int]], Dict[str, List[int]], List[Dict[str, Any]]]:
    if isinstance(_ALIAS_FILE, dict):
        entries = _ALIAS_FILE.get("aliases") or []
    elif isinstance(_ALIAS_FILE, list):
        entries = _ALIAS_FILE
    else:
        entries = []
    entries = [e for e in entries if isinstance(e, dict) and e.get("match")]

    by_norm: Dict[str, List[int]] = {}
    by_squash: Dict[str, List[int]] = {}
    for idx, entry in enumerate(entries):
        for surface in entry.get("match") or []:
            n = _norm(surface)
            if not n:
                continue
            by_norm.setdefault(n, []).append(idx)
            by_squash.setdefault(_squash(surface), []).append(idx)
    return by_norm, by_squash, entries


_ALIAS_BY_NORM, _ALIAS_BY_SQUASH, ALIASES = _index_aliases()

# Alias surfaces, longest first, for CONTAINMENT matching (see _alias_contained).
_ALIAS_SURFACES: List[Tuple[List[str], str]] = sorted(
    ((s.split(), s) for s in _ALIAS_BY_NORM if s),
    key=lambda pair: -len(pair[0]),
)


def _alias_contained(nq: str) -> List[int]:
    """Alias entries whose surface form appears INSIDE the query.

    WHY THIS EXISTS (qa_eval, 2026-07-14 - it caught 12 of 18 failures):
    step 2 of lookup_item used to be a dict lookup on the WHOLE query, so the
    alias table only fired when the query WAS the alias. "hba1c" resolved; the
    thing a caller actually says - "HbA1c ટેસ્ટ કેટલામાં થાય?" - returned
    found=False, and the bot told them it would "check and call back" about a
    test whose price it was holding. Fuzzy (step 3) cannot rescue these: the
    alias exists precisely to bridge a gap fuzzy can't ("hba1c" scores nothing
    against "Glycosylated Hb ( Hba I C )").

    TOKEN BOUNDARIES, NOT SUBSTRINGS. A raw `in` check would match "બાય" inside
    "બાયોપ્સી" - the same trap that made the farewell detector hang up on a
    caller asking about a biopsy. Match contiguous TOKEN runs only.

    LONGEST MATCH WINS so "urine routine" beats "urine". Exact-length ties union
    their entries, which surfaces as multiple items -> low confidence -> the bot
    asks. Ambiguity must always degrade to a question, never to a guess.
    """
    q = nq.split()
    if not q:
        return []
    best = 0
    out: List[int] = []
    for tokens, surface in _ALIAS_SURFACES:
        n = len(tokens)
        if n < best:
            break  # sorted longest-first: nothing shorter can beat the best match
        if n > len(q):
            continue
        for i in range(len(q) - n + 1):
            if q[i : i + n] == tokens:
                if n > best:
                    best, out = n, list(_ALIAS_BY_NORM[surface])
                elif n == best:
                    out.extend(_ALIAS_BY_NORM[surface])
                break
    return _dedupe(out)


def _records_for_canonical(name: str) -> List[int]:
    """aliases.json canonicals are validated against real names by
    knowledge/validate_aliases.js, but resolve through the normalized index
    anyway so a stray space never silently drops a record."""
    n = _norm(name)
    if n in _BY_NORM:
        return _BY_NORM[n]
    return _BY_SQUASH.get(_squash(name), [])


# --- lookup_item ----------------------------------------------------------

_NOTE_HIGH = (
    "Single confident match. Quote MRP first, then the discounted Sun Pathology "
    "price, using ONLY the numbers in this result."
)
_NOTE_AMBIGUOUS = (
    "AMBIGUOUS - more than one item matches. Do NOT assert a single price. Ask the "
    "caller which one they mean (use `clarify` if present), then look up again."
)
_NOTE_NONE = (
    "NO MATCH - this test/package is not in the price list. Do NOT guess, do NOT "
    "state any price, do NOT invent a name. Use the no-match script: offer to take "
    "the caller's number for the team to confirm, or escalate. If `candidates` is "
    "non-empty you MAY ask 'did you mean ...?' - as a question, never as a fact."
)


def _public(idx: int) -> Dict[str, Any]:
    """Deep copy - callers (and the LLM plumbing) must never mutate the cache."""
    return copy.deepcopy(ITEMS[idx])


def _dedupe(indices: Sequence[int]) -> List[int]:
    seen: set = set()
    out: List[int] = []
    for i in indices:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _result(
    query: str,
    indices: Sequence[int],
    match_type: str,
    clarify: Optional[str],
    candidates: Sequence[int] = (),
) -> Dict[str, Any]:
    items = [_public(i) for i in indices]
    found = bool(items)
    # High confidence demands exactly one record AND no disambiguation question
    # attached to it. Everything else is a question, not an assertion.
    #
    # This line previously read `high = found`, which made EVERY hit
    # high-confidence and defeated the whole gate: "CBC" came back high with 3
    # items + a clarify question attached, so the bot would have confidently
    # quoted Rs.170 for "CBC With Mp By Antigen" (a CBC bundled with a malaria
    # antigen) on the most-asked query on a lab phone line. Ambiguity must
    # resolve to a question, never an assertion - see the module docstring.
    high = found and len(items) == 1 and not clarify
    if found:
        note = _NOTE_HIGH if high else _NOTE_AMBIGUOUS
    else:
        note = _NOTE_NONE
    return {
        "query": query,
        "found": found,
        "confidence": "high" if high else "low",
        "match_type": match_type,
        "items": items,
        "candidates": [_public(i) for i in candidates],
        "clarify": clarify,
        "price_quote_order": PRICE_QUOTE_STYLE,
        "note": note,
    }


def _fuzzy(nq: str) -> List[Tuple[float, float, str]]:
    """(token_set_ratio, token_sort_ratio, normalized_name), best first.

    token_set_ratio is the brief-mandated gate. token_sort_ratio is only a
    tie-break: it penalises length mismatch, so when several names clear the
    gate the closest-length one ranks first.
    """
    scored: List[Tuple[float, float, str]] = []
    for nname in _NORM_NAMES:
        score = fuzz.token_set_ratio(nq, nname)
        if score >= FUZZ_FLOOR:
            scored.append((score, fuzz.token_sort_ratio(nq, nname), nname))
    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return scored


def lookup_item(query: str) -> Dict[str, Any]:
    """Resolve a caller's words to test/package record(s). Brief section 4.

    Returns a dict with:
      found            - True only if real record(s) resolved
      confidence       - "high" (exactly one match, no clarify needed) | "low"
      match_type       - "exact" | "alias" | "fuzzy" | "none"
      items            - full records, each with `mrp` AND `price`
                         (price = discounted; owner quotes MRP first, then price)
      candidates       - up to 3 suggestions, ONLY when found is False
      clarify          - Gujarati disambiguation question, or None
      note             - what the model is allowed to do with this result

    The caller must treat confidence "low" as "ask the caller", never as a fact.
    """
    raw = str(query or "").strip()
    nq = _norm(raw)
    if not nq or not ITEMS:
        return _result(raw, [], "none", None)

    # 1. exact / normalized name
    hits = _BY_NORM.get(nq) or _BY_SQUASH.get(_squash(raw))
    if hits:
        return _result(raw, _dedupe(hits), "exact", None)

    # 2. alias table — whole-query first (fast path), then containment, so the
    #    caller's real phrasing ("HbA1c ટેસ્ટ કેટલામાં થાય?") resolves and not
    #    just the bare keyword. See _alias_contained.
    entries = (
        _ALIAS_BY_NORM.get(nq)
        or _ALIAS_BY_SQUASH.get(_squash(raw))
        or _alias_contained(nq)
    )
    if entries:
        indices: List[int] = []
        clarifies: List[str] = []
        for e_idx in entries:
            entry = ALIASES[e_idx]
            for canonical in entry.get("canonical") or []:
                indices.extend(_records_for_canonical(canonical))
            if entry.get("clarify"):
                clarifies.append(str(entry["clarify"]))
        indices = _dedupe(indices)
        if indices:
            clarify = clarifies[0] if len(clarifies) == 1 else (" / ".join(clarifies) or None)
            return _result(raw, indices, "alias", clarify or None)
        # Alias matched but no canonical resolved (validate_aliases.js should make
        # this impossible). Fall through rather than answer nothing.

    # 3. fuzzy >= 85
    scored = _fuzzy(nq)
    accepted = [row for row in scored if row[0] >= FUZZ_ACCEPT]
    if accepted:
        indices = _dedupe([i for row in accepted for i in _BY_NORM.get(row[2], [])])
        if len(indices) == 1:
            return _result(raw, indices, "fuzzy", None)
        # Several names clear the gate - usually the substring trap. Ask.
        return _result(raw, indices[:MAX_CANDIDATES], "fuzzy", None)

    # 4. below 85 -> suggestions only, never an assertion
    suggestions = _dedupe([i for row in scored for i in _BY_NORM.get(row[2], [])])
    return _result(raw, [], "none", None, candidates=suggestions[:MAX_CANDIDATES])


# --- check_holiday --------------------------------------------------------

_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d")


def _parse_date(value: str) -> Optional[_date]:
    text = str(value or "").strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def check_holiday(date: str) -> Dict[str, Any]:
    """Are the centres open on `date`? Brief sections 3.4 + 8.

    Sun Pathology runs 8:00 AM - 8:00 PM every day including Sunday; the only
    closures are the six festivals in holidays_2026.json.

    An UNVERIFIED entry returns open=True plus a "confirming with team" caveat
    (brief section 3.4) - the bot must never announce a closure the client has
    not signed off, and must never assert "we're open" about a date the file
    flags as a likely closure either. Both facts ride back together.
    """
    base: Dict[str, Any] = {
        "date": str(date or "").strip(),
        "hours": CENTRE_HOURS,
        "open_all_days": OPEN_ALL_DAYS,
        "recurring_rule": _HOLIDAYS.get("recurring_rule"),
        "client_signoff_required": bool(_HOLIDAYS.get("client_signoff_required")),
    }

    parsed = _parse_date(date)
    if parsed is None:
        base.update(
            open=None,
            festival=None,
            verified=False,
            caveat="I did not catch that date.",
            note="Date not understood. Ask the caller to repeat it. Do NOT state open or closed.",
        )
        return base

    base["date"] = parsed.isoformat()
    entries = _HOLIDAYS.get("dates_2026") or []
    if not entries:
        base.update(
            open=True,
            festival=None,
            verified=False,
            caveat="I'm confirming the festival holiday list with our team.",
            note=(
                "Holiday list unavailable. Say the centres normally run 8 AM to 8 PM all "
                "days, and that you will confirm festival closures with the team."
            ),
        )
        return base

    match = next(
        (e for e in entries if isinstance(e, dict) and str(e.get("date")) == parsed.isoformat()),
        None,
    )

    if match is None:
        # An ordinary day. Only 2026 festivals are listed, so anything outside
        # 2026 is an unknown, not an "open".
        if parsed.year != 2026:
            base.update(
                open=True,
                festival=None,
                verified=False,
                caveat="I'm confirming the festival holiday list for that year with our team.",
                note=(
                    "Only 2026 festival closures are known. Give the normal 8 AM to 8 PM "
                    "hours and offer to confirm that specific date with the team."
                ),
            )
            return base
        base.update(
            open=True,
            festival=None,
            verified=True,
            caveat=None,
            note="Open as normal, 8 AM to 8 PM. Not a festival closure.",
        )
        return base

    festival = match.get("name")
    if match.get("verified"):
        base.update(
            open=False,
            festival=festival,
            verified=True,
            caveat=None,
            note=(
                f"CLOSED for {festival}. Say the centres are closed that day, then offer the "
                "day before or after."
            ),
        )
        return base

    # Listed but unverified: brief section 3.4 says open + caveat.
    base.update(
        open=True,
        festival=festival,
        verified=False,
        closure_pending_confirmation=True,
        caveat="I'm confirming that festival date with our team.",
        note=(
            f"UNCONFIRMED closure ({festival}). Do NOT announce a closure and do NOT promise "
            "the lab is open. Say the centres normally run 8 AM to 8 PM, that this date falls "
            "near a festival, and that you will confirm with the team before they travel."
        ),
    )
    return base


# --- capture_lead ---------------------------------------------------------


def _leads_path() -> Path:
    """Env-overridable so evals never write into the real leads file."""
    return Path(os.environ.get("SUNPATH_LEADS_PATH", str(LEADS_PATH)))


def capture_lead(
    kind: str,
    name: str,
    phone: str,
    area: str = "",
    details: str = "",
) -> Dict[str, Any]:
    """Record a home-collection / corporate / society enquiry. Brief section 8.

    SIMULATED: appends one JSON line to leads.jsonl. No CRM, no SMS, no network -
    this is a demo and nothing here may touch an external system.
    """
    kind_clean = str(kind or "").strip().lower()
    name_clean = str(name or "").strip()
    phone_raw = str(phone or "").strip()
    digits = re.sub(r"\D", "", phone_raw)

    if kind_clean not in VALID_LEAD_KINDS:
        return {
            "ok": False,
            "error": "invalid_kind",
            "message": f"kind must be one of {', '.join(VALID_LEAD_KINDS)}.",
            "note": "Internal error - pick the correct kind and call again. Do not tell the caller.",
        }

    missing = [f for f, v in (("name", name_clean), ("phone", phone_raw)) if not v]
    if missing:
        return {
            "ok": False,
            "error": "missing_fields",
            "missing": missing,
            "message": f"Still need: {', '.join(missing)}.",
            "note": "Ask the caller for the missing detail (one at a time), then call again.",
        }

    # STT drops digits constantly on Gujarati-accented number reads. A short
    # number is almost always a mishear, and a lead we cannot ring back is dead.
    if len(digits) < 10:
        return {
            "ok": False,
            "error": "phone_too_short",
            "heard": phone_raw,
            "message": "That number has fewer than 10 digits.",
            "note": "Read back what you heard and ask the caller to repeat the number slowly.",
        }

    lead_id = "SP-" + uuid.uuid4().hex[:6].upper()
    record = {
        "lead_id": lead_id,
        "kind": kind_clean,
        "name": name_clean,
        "phone": phone_raw,
        "phone_digits": digits,
        "area": str(area or "").strip(),
        "details": str(details or "").strip(),
        "created_at": datetime.now(IST).isoformat(),
        "source": "voicebot_demo",
        "simulated": True,
    }

    path = _leads_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        return {
            "ok": False,
            "error": "write_failed",
            "detail": str(exc),
            "message": "Could not save the enquiry.",
            "note": (
                "Do not claim the enquiry was recorded. Give the customer care number "
                f"{CUSTOMER_CARE} and apologise."
            ),
        }

    return {
        "ok": True,
        "lead_id": lead_id,
        "kind": kind_clean,
        "lead": record,
        "simulated": True,
        "message": "Enquiry recorded. Our team will call back to confirm.",
        "note": (
            "Confirm by reading the phone number back digit by digit, slowly, and repeat "
            "the area/slot. Do not read out the lead id unless asked."
        ),
    }


# --- escalate -------------------------------------------------------------


def escalate(reason: str) -> Dict[str, Any]:
    """Hand off to Dr. Mayank Joshi. Brief section 8.

    Used for report doubts, any request for medical interpretation, and corporate
    / society planning. The script is verbatim from the owner's manual; the model
    delivers it in the caller's language (prompt section 1) and normalize.py turns
    the number into digit-by-digit Gujarati before TTS.
    """
    return {
        "ok": True,
        "reason": str(reason or "").strip(),
        "contact_name": ESCALATION_NAME,
        "contact_number": ESCALATION_NUMBER,
        "customer_care": CUSTOMER_CARE,
        "script": ESCALATION_SCRIPT,
        "note": (
            "Read the script in the caller's language, keeping the number exact. Speak the "
            "number slowly, in chunks. Do NOT interpret the report, do NOT give a diagnosis, "
            "and do NOT suggest medicines."
        ),
    }


# =========================================================================
# PLAYBOOK ROUTING (owner playbook, 2026-07-14)
# =========================================================================
#
# The owner's rule, in one line: the bot ANSWERS soft inquiries and FAQs, and
# TRANSFERS every booking and every direct sale. Anything not in the playbook is
# a transfer, never a guess.
#
# route_intent() is ADVISORY. The LLM is the real router - it has the same table
# in prompts/system_gu.md - and this function exists so the routing decision is
# also deterministic, inspectable and testable off-line. It resolves the caller's
# words against playbook.json `examples` the same way lookup_item resolves them
# against test names: normalize, exact, then rapidfuzz token_set_ratio.
#
# The one rule that differs from lookup_item: when an `answer` route and a
# `transfer` route score within TIE_MARGIN of each other, TRANSFER WINS. The two
# errors are not symmetrical. Transferring a price question wastes a caller one
# callback; answering a booking request ourselves means a patient sits at home
# waiting for a collector nobody dispatched.

ROUTE_ACCEPT = 85  # same gate as lookup_item's FUZZ_ACCEPT
ROUTE_FLOOR = 70  # below this a sentence match is noise -> unknown -> transfer
ROUTE_TIE_MARGIN = 4  # two routes this close are a coin-flip, so prefer transfer

# An `examples` entry of 1-2 tokens is a TRIGGER (a distinctive content word);
# 3+ tokens is an UTTERANCE (a whole sentence). They are scored differently, and
# the split is measured, not stylistic:
#
#   Sentence-level token_set_ratio cannot separate a real paraphrase from noise
#   here, because it keys on function words. Measured against this playbook:
#     "what is the WiFi password"      -> 61 vs "what is the status of the report"
#     "શું અહીં પાર્કિંગની સુવિધા છે"    -> 75 vs a report_tat example
#     "what is the rate for thyroid profile" -> 74 (a REAL price question)
#     "લિપિડ પ્રોફાઇલ કેટલાનું છે"        -> 53 (also a real price question)
#   Noise tops out ABOVE real questions, so no threshold works. What actually
#   separates them is one content word: "rate" is a price question, "parking" is
#   not - and no string metric will ever match "rate" to "price", they are
#   synonyms with zero characters in common.
#
# So a trigger matches TOKEN-WISE (is this word in the sentence?) rather than by
# whole-string ratio, and is worth a fixed, deliberately mediocre score:
#   * >= ROUTE_FLOOR, so a keyword alone is enough to name the desk;
#   * <  ROUTE_ACCEPT, so a keyword alone is never "high" confidence;
#   * below any decent sentence match, so a trigger can never outrank a real
#     utterance match. This is what stops the trap that bit during authoring:
#     the trigger "પેકેજ" must LOSE to the full sentence "મારે ફુલ બોડી પેકેજ ખરીદવું છે"
#     (95), or "I want to buy a package" gets answered as a price enquiry
#     instead of being transferred as the direct sale it is.
TRIGGER_MAX_TOKENS = 2
TRIGGER_SCORE = 80.0
TRIGGER_TOKEN_RATIO = 90  # per-token, to absorb STT wobble and inflection


def _playbook_path() -> Path:
    """Env-overridable so evals can point at a fixture playbook."""
    return Path(os.environ.get("SUNPATH_PLAYBOOK_PATH", str(KNOWLEDGE / "playbook.json")))


@lru_cache(maxsize=1)
def load_playbook() -> Dict[str, Any]:
    """Read knowledge/playbook.json. Cached - a live call never touches the disk.

    A missing or corrupt file must not take the worker down mid-call, but it must
    not silently turn into a bot that answers everything from memory either. So
    the fallback is an EMPTY route table with unknown_policy "transfer": with no
    routes, route_intent() returns unknown for every utterance, and unknown means
    transfer. The bot degrades into a polite switchboard, which is the safe
    failure direction.
    """
    try:
        data = json.loads(_playbook_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("version", 0)
    data.setdefault("routes", [])
    data.setdefault("faq", [])
    data.setdefault("transfer_default", "customer_care")
    data.setdefault("unknown_policy", "transfer")
    return data


@lru_cache(maxsize=1)
def _routes_by_intent() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for route in load_playbook().get("routes") or []:
        if isinstance(route, dict) and route.get("intent"):
            out[str(route["intent"])] = route
    return out


@lru_cache(maxsize=1)
def _example_index() -> Tuple[
    Dict[str, List[str]],
    Tuple[Tuple[str, str], ...],
    Tuple[Tuple[Tuple[str, ...], str, str], ...],
]:
    """(exact: normalized example -> [intent], utterances, triggers).

    utterances: ((normalized sentence, intent), ...)   - scored by token_set_ratio
    triggers:   ((token tuple, intent, raw), ...)      - matched token-wise

    An example string mapping to two intents would be an authoring bug, so exact
    keeps a list rather than overwriting: route_intent surfaces it as a tie, which
    resolves to a transfer instead of an arbitrary winner.
    """
    exact: Dict[str, List[str]] = {}
    utterances: List[Tuple[str, str]] = []
    triggers: List[Tuple[Tuple[str, ...], str, str]] = []
    for intent, route in _routes_by_intent().items():
        for example in route.get("examples") or []:
            n = _norm(example)
            if not n:
                continue
            exact.setdefault(n, []).append(intent)
            tokens = tuple(n.split())
            if len(tokens) <= TRIGGER_MAX_TOKENS:
                triggers.append((tokens, intent, str(example)))
            else:
                utterances.append((n, intent))
    return exact, tuple(utterances), tuple(triggers)


def _trigger_hit(trigger: Sequence[str], tokens: Sequence[str]) -> bool:
    """Does every token of `trigger` appear as a token of the utterance?

    Token-wise on purpose. The whole-string ratios inflate a short needle against
    a long haystack to 100 (token_set_ratio calls "પેકેજ" a perfect match for any
    sentence containing it), which is precisely the hijack this must avoid - so a
    trigger is asked the narrow question "is this word here?" and nothing more.
    fuzz.ratio per token rather than equality absorbs an STT wobble or an
    inflected ending ("પેકેજનો" vs "પેકેજ") without opening the door to a
    different word.
    """
    for needle in trigger:
        if not any(fuzz.ratio(needle, tok) >= TRIGGER_TOKEN_RATIO for tok in tokens):
            return False
    return True


def _unknown_result(reason: str) -> Dict[str, Any]:
    book = load_playbook()
    return {
        "intent": "unknown",
        "route": book.get("unknown_policy", "transfer"),
        "transfer_to": book.get("transfer_default", "customer_care"),
        "confidence": "low",
        "handler": "none",
        "score": 0.0,
        "matched_example": None,
        "note": (
            f"NOT IN THE PLAYBOOK ({reason}). Do NOT answer this from memory and do NOT "
            "reason it out from a similar question. Say you will have the team confirm it, "
            "take the caller's name and number, and call transfer_to_agent."
        ),
    }


def _route_result(intent: str, confidence: str, score: float, example: Optional[str]) -> Dict[str, Any]:
    route = _routes_by_intent().get(intent)
    if route is None:  # pragma: no cover - only reachable if the cache is torn
        return _unknown_result(f"intent {intent!r} vanished from the playbook")
    is_transfer = route.get("route") == "transfer"
    if is_transfer:
        transfer_to = route.get("transfer_to") or load_playbook().get("transfer_default")
    else:
        transfer_to = None

    if confidence == "high":
        note = str(route.get("notes") or "")
    else:
        note = (
            "LOW CONFIDENCE match - this is a hint, not a decision. Ask ONE short "
            "clarifying question before acting on it, or transfer. Never state a fact on "
            "the strength of a low-confidence route. Route notes: "
        ) + str(route.get("notes") or "")

    return {
        "intent": intent,
        "route": route.get("route"),
        "transfer_to": transfer_to,
        "confidence": confidence,
        "handler": route.get("handler") or "none",
        "score": round(float(score), 1),
        "matched_example": example,
        "note": note,
    }


def route_intent(text: str) -> Dict[str, Any]:
    """Classify a caller's utterance against knowledge/playbook.json.

    Returns:
        intent       - the playbook intent, or "unknown"
        route        - "answer" | "transfer"  (unknown is always "transfer")
        transfer_to  - "customer_care" | "dr_joshi", or None on an answer route
        confidence   - "high" | "low"
        handler      - "lookup_item" | "check_holiday" | "faq" | "none"
        score        - best token_set_ratio against that intent's examples
        note         - what the model is allowed to do with this

    "low" confidence means ASK, never assert - same contract as lookup_item.
    """
    raw = str(text or "").strip()
    nq = _norm(raw)
    if not nq:
        return _unknown_result("empty utterance")

    exact, utterances, triggers = _example_index()
    if not utterances and not triggers:
        return _unknown_result("playbook has no routes loaded")

    # 1. exact / normalized example
    hits = exact.get(nq)
    if hits:
        intents = list(dict.fromkeys(hits))
        if len(intents) == 1:
            return _route_result(intents[0], "high", 100.0, raw)
        # One example string authored under two intents. validate-worthy bug, but
        # never resolve it by picking the first: tie -> transfer, else ask.
        resolved = _resolve_tie([(100.0, 100.0, i) for i in intents], raw)
        if resolved is not None:
            return resolved
        return _route_result(intents[0], "low", 100.0, raw)

    # 2. sentence fuzzy - best (token_set, token_sort) per intent
    best: Dict[str, Tuple[float, float, str, str]] = {}
    for example, intent in utterances:
        score = fuzz.token_set_ratio(nq, example)
        if score < ROUTE_FLOOR:
            continue
        current = best.get(intent)
        tie = fuzz.token_sort_ratio(nq, example)
        if current is None or (score, tie) > (current[0], current[1]):
            best[intent] = (score, tie, example, "utterance")

    # 3. triggers - one distinctive content word naming a desk.
    #
    # Score and EVIDENCE are tracked separately, which is not a nicety: folding
    # them together meant a trigger hit on an intent that already had a better
    # sentence score was skipped to avoid downgrading it - silently discarding the
    # keyword the answer gate then needed. "શુગર ટેસ્ટ માટે ભૂખ્યા આવવું પડે કે નહીં"
    # scored 82 on the sentence AND hit the "ભૂખ્યા" trigger, and still came back
    # unknown. So: `best` holds the highest score, `triggered` holds the evidence,
    # and a trigger only ever RAISES a score, never lowers one.
    tokens = nq.split()
    triggered: set = set()
    for trigger, intent, raw_trigger in triggers:
        if not _trigger_hit(trigger, tokens):
            continue
        triggered.add(intent)
        current = best.get(intent)
        if current is None or current[0] < TRIGGER_SCORE:
            best[intent] = (TRIGGER_SCORE, TRIGGER_SCORE, raw_trigger, "trigger")

    if not best:
        return _unknown_result("no playbook example or keyword is close to this")

    ranked = sorted(
        ((v[0], v[1], intent, v[2]) for intent, v in best.items()),
        key=lambda row: (row[0], row[1]),
        reverse=True,
    )
    top_score, top_tie, top_intent, top_example = ranked[0]

    confidence = "high" if top_score >= ROUTE_ACCEPT else "low"

    # Contenders within TIE_MARGIN of the leader. If any of them is a transfer,
    # the transfer wins - see the module comment above for why.
    contenders = [row for row in ranked if top_score - row[0] <= ROUTE_TIE_MARGIN]
    if len(contenders) > 1:
        resolved = _resolve_tie([(r[0], r[1], r[2]) for r in contenders], top_example)
        if resolved is not None:
            return resolved
        # All contenders answer, so nothing unsafe can happen - but if they would
        # answer from DIFFERENT tools ("what time do you open" vs "are you open on
        # the 14th": faq vs check_holiday) then picking the leader picks the wrong
        # source of truth. Same handler, same facts, so a tie there is harmless.
        handlers = {_routes_by_intent().get(r[2], {}).get("handler") for r in contenders}
        if len(handlers) > 1:
            confidence = "low"

    # THE ANSWER GATE. The two routes are not held to the same bar, because the
    # owner's rule is not symmetrical: "if the answer is NOT in the playbook ->
    # TRANSFER. Never guess."
    #
    # To ANSWER, we need real evidence: either a strong sentence match, or a
    # distinctive keyword. A merely-close sentence is not evidence - measured on
    # this playbook, noise reaches 75 while real questions drop to 53, so a
    # mid-range sentence score says nothing at all and acting on it is guessing.
    # A weak match on a TRANSFER route only costs the caller a callback, so it is
    # allowed to stand on ROUTE_FLOOR alone.
    if (
        _routes_by_intent().get(top_intent, {}).get("route") == "answer"
        and top_score < ROUTE_ACCEPT
        and top_intent not in triggered
    ):
        return _unknown_result(
            f"closest match was {top_intent!r} at {top_score:.0f} with no keyword to back it "
            f"up, under the {ROUTE_ACCEPT} an answer has to clear"
        )

    return _route_result(top_intent, confidence, top_score, top_example)


def _resolve_tie(
    contenders: Sequence[Tuple[float, float, str]],
    example: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Break a near-tie between intents. Transfer beats answer, always.

    Returns None when every contender agrees on the same `route` value, in which
    case the caller keeps its own ranking - a tie between two answer routes (say
    test_price vs package) is not dangerous, it just needs a clarifying question.
    """
    routes = _routes_by_intent()
    transfers = [c for c in contenders if routes.get(c[2], {}).get("route") == "transfer"]
    if not transfers:
        return None

    answers = [c for c in contenders if routes.get(c[2], {}).get("route") != "transfer"]
    best_score, best_tie, intent = max(transfers, key=lambda c: (c[0], c[1]))

    # An uncontested transfer at the top of the list is a normal high-confidence
    # match. It is only "low" when an answer route was close enough to have won.
    if answers:
        confidence = "low"
    else:
        confidence = "high" if best_score >= ROUTE_ACCEPT else "low"

    result = _route_result(intent, confidence, best_score, example)
    if answers:
        result["note"] = (
            "AMBIGUOUS between answering and transferring "
            f"({', '.join(c[2] for c in contenders)}) - resolved to the TRANSFER, because "
            "wrongly answering a booking or a sale is worse than wrongly transferring a "
            "question. Ask ONE clarifying question if you are unsure which the caller "
            "means. Route notes: "
        ) + str(routes.get(intent, {}).get("notes") or "")
    return result


# --- transfer_to_agent ----------------------------------------------------
#
# THE SIP SEAM. There is no telephony on this demo (build brief: "SIP trunk comes
# later - do NOT build telephony now"), so a "transfer" cannot be a warm handoff.
# It is: announce it in Gujarati, capture name + mobile + context, log the lead,
# give the right number, close politely.
#
# Everything about that is confined to _transfer_announce() below. When the SIP
# trunk lands, the change is: add _transfer_sip() which dials the number and
# bridges the leg, and switch on TRANSFER_MODE here. The lead log, the intent
# routing, the target table and the tool signature do not move, and neither does
# the prompt - the LLM already calls transfer_to_agent and does not know or care
# how the handoff is physically achieved.

TRANSFER_MODE = os.environ.get("TRANSFER_MODE", "announce").strip().lower()

# Intents where demanding a name and number before helping would be indefensible.
# An emergency caller gets the hospital script and nothing else; a caller asking
# what a value means gets the refusal and Dr. Joshi's number immediately. For
# these, capture is optional - the script is not.
TRANSFER_NO_CAPTURE_INTENTS = frozenset(
    {
        "emergency_symptoms",
        "medical_interpretation",
        "report_difference_doubt",
        "doctor_escalation_request",
    }
)


def _transfer_target(intent: str, requested: str) -> Tuple[str, str]:
    """(target_key, how_it_was_decided).

    The PLAYBOOK WINS over the caller-supplied `transfer_to` for any intent the
    playbook knows. That is deliberate: `transfer_to` arrives as an LLM argument,
    i.e. a guess, and the owner's routing split (corporate / society / report
    doubt -> Dr. Joshi, everything else -> customer care) is not a guess. The
    argument only decides intents the playbook has never heard of.
    """
    route = _routes_by_intent().get(str(intent or "").strip())
    if route is not None and route.get("route") == "transfer":
        target = str(route.get("transfer_to") or "")
        if target in TRANSFER_TARGETS:
            return target, "playbook"

    asked = str(requested or "").strip().lower()
    if asked in TRANSFER_TARGETS:
        return asked, "argument"

    return str(load_playbook().get("transfer_default", "customer_care")), "default"


def _transfer_announce(intent: str, target_key: str, name: str, phone: str) -> str:
    """The Gujarati handoff script for the no-telephony demo.

    Deliberately does NOT say "I am connecting you" / "હું આપને જોડી રહી છું".
    There is no line to connect them to, and a receptionist who says she is
    transferring you and then hangs up is worse than one who never offered.
    The numbers stay as Latin digits - normalize.py speaks them digit-by-digit
    in chunks before TTS.
    """
    target = TRANSFER_TARGETS[target_key]
    number = target["number"]
    who = target["who_gu"]

    if intent == "emergency_symptoms":
        # Deliberately not a handoff script. Nothing - not a name, not a number,
        # not Dr. Joshi - comes before "go to a hospital".
        return (
            "આપનાં લક્ષણો માટે તાત્કાલિક તબીબી સારવારની જરૂર પડી શકે છે. કૃપા કરીને હમણાં જ "
            "આપના ડૉક્ટરનો સંપર્ક કરો અથવા નજીકની હૉસ્પિટલ કે ઇમરજન્સી સેવામાં જાઓ. "
            "લેબોરેટરી ફોન પર ઇમરજન્સી સારવાર આપી શકતી નથી."
        )

    if target_key == "dr_joshi":
        script = (
            f"આ બાબતમાં અમારા {who} આપને વધુ સારી રીતે માર્ગદર્શન આપી શકશે. "
            f"આપ તેમને {number} નંબર પર વૉટ્સએપ કરીને પછી કૉલ કરી શકો છો."
        )
    else:
        script = (
            f"આ માટે {who} આપને વધુ સારી રીતે મદદ કરી શકશે. "
            f"આપ સીધા અમારા કસ્ટમર કેર {number} પર કૉલ કરી શકો છો."
        )

    if name and phone:
        script += (
            f" મેં આપનું નામ {name} અને મોબાઇલ નંબર {phone} નોંધી લીધો છે — અમારી ટીમ આપનો "
            "સંપર્ક કરશે."
        )

    return script + " સન પેથોલોજીનો સંપર્ક કરવા બદલ આભાર."


def transfer_to_agent(
    intent: str,
    name: str = "",
    phone: str = "",
    details: str = "",
    transfer_to: str = "",
) -> Dict[str, Any]:
    """Hand the caller to a human. Owner playbook 2026-07-14.

    Used for every booking and every direct sale, for report/complaint issues we
    cannot look up, and for anything the playbook does not cover.

    SIMULATED - there is no SIP trunk yet, so this announces the handoff, logs a
    lead line to leads.jsonl with route="transfer", and returns the script plus
    the correct number. See "THE SIP SEAM" above before changing the shape.

    Args:
        intent: the playbook intent (route_intent's `intent`). Decides the target.
        name: caller / company / society name.
        phone: caller's mobile, for the callback.
        details: one line of context for whoever picks this up.
        transfer_to: "customer_care" | "dr_joshi". Only used for intents the
            playbook does not know - otherwise the playbook's own target wins.

    Returns ok=False + `missing` when a callback is impossible (no name/number),
    EXCEPT for TRANSFER_NO_CAPTURE_INTENTS, which are never gated on details.
    """
    intent_clean = str(intent or "").strip()
    name_clean = str(name or "").strip()
    phone_raw = str(phone or "").strip()
    digits = re.sub(r"\D", "", phone_raw)

    target_key, routed_by = _transfer_target(intent_clean, transfer_to)
    target = TRANSFER_TARGETS[target_key]
    capture_required = intent_clean not in TRANSFER_NO_CAPTURE_INTENTS

    if capture_required:
        missing = [f for f, v in (("name", name_clean), ("phone", phone_raw)) if not v]
        if missing:
            return {
                "ok": False,
                "error": "missing_fields",
                "missing": missing,
                "intent": intent_clean,
                "transfer_to": target_key,
                "message": f"Still need: {', '.join(missing)}.",
                "note": (
                    "Ask the caller for the missing detail - ONE at a time - then call again. "
                    "Do not hand off without a callback number; there is no live transfer, so "
                    "the number is the only way the team can reach them."
                ),
            }
        # Same reasoning as capture_lead: chirp_2 drops digits on Gujarati-accented
        # number reads, and a lead nobody can ring back is not a lead.
        if len(digits) < 10:
            return {
                "ok": False,
                "error": "phone_too_short",
                "heard": phone_raw,
                "intent": intent_clean,
                "transfer_to": target_key,
                "message": "That number has fewer than 10 digits.",
                "note": "Read back what you heard and ask the caller to repeat it slowly.",
            }

    lead_id = "SP-" + uuid.uuid4().hex[:6].upper()
    record = {
        "lead_id": lead_id,
        "route": "transfer",
        "intent": intent_clean or "unknown",
        "transfer_to": target_key,
        "transfer_number": target["number"],
        "transfer_mode": TRANSFER_MODE,
        "routed_by": routed_by,
        "name": name_clean,
        "phone": phone_raw,
        "phone_digits": digits,
        "details": str(details or "").strip(),
        "created_at": datetime.now(IST).isoformat(),
        "source": "voicebot_demo",
        "simulated": True,
    }

    path = _leads_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        # The handoff still has to happen - the caller needs the number whether or
        # not our log file worked. But never claim we noted something we did not.
        return {
            "ok": False,
            "error": "write_failed",
            "detail": str(exc),
            "intent": intent_clean,
            "transfer_to": target_key,
            "contact_number": target["number"],
            "script_gu": _transfer_announce(intent_clean, target_key, "", ""),
            "message": "Could not save the lead.",
            "note": (
                "Do NOT tell the caller their details were noted - they were not. Give them "
                f"the number ({target['number']}) and ask them to call directly."
            ),
        }

    return {
        "ok": True,
        "route": "transfer",
        "intent": intent_clean or "unknown",
        "transfer_to": target_key,
        "routed_by": routed_by,
        "mode": TRANSFER_MODE,
        "contact_name": target["label_en"],
        "contact_number": target["number"],
        "customer_care": CUSTOMER_CARE,
        "lead_id": lead_id,
        "lead": record,
        "simulated": True,
        "script_gu": _transfer_announce(intent_clean, target_key, name_clean, phone_raw),
        "note": (
            "Speak script_gu (in the caller's language if they are not on Gujarati), keeping "
            f"the number {target['number']} exact and slow. There is NO live transfer - do not "
            "say you are connecting them, do not promise a callback time, and do not promise a "
            "price, slot or outcome on the human's behalf. Read the caller's own number back "
            "to confirm it, then close politely."
        ),
    }
