"""Conservative extraction of visitor-provided form data; no writes or inference.

The API remains responsible for validation and confirmation. Returning None
leaves ambiguous/multi-intent speech with the ordinary conversational path.
"""
import re
import unicodedata

_REQUIRED = {"contact": ("name", "email", "message"), "callback": ("name", "phone", "reason")}
_DIGITS = str.maketrans("०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯", "01234567890123456789")
_QUESTIONS = re.compile(r"^(?:what|why|when|where|who|whose|which|how|can|could|would|should|is|are|do|does|will|may)\b|^(?:क्या|क्यों|कब|कहाँ|कौन|कैसे|કેમ|ક્યારે|ક્યાં|કોણ|કેવી રીતે|શું)\s", re.I)
_COMMANDS = re.compile(r"^(?:please|show|open|stop|cancel|change|edit|submit|send|confirm|don't|do not|wait|repeat|speak|tell|help|never|no|yes|okay|ok|sure|thanks|thank you)\b|^(?:हाँ|हां|नहीं|मत|रुको|बंद|दिखा|खोल|बदल|कृपया|હા|ના|નહીં|રોકો|બંધ|બતાવ|ખોલ|બદલ|કૃપા)", re.I)
_PREFIXES = {
    "name": r"(?:my (?:full )?name is|name\s*[:=]|मेरा नाम|मेरा पूरा नाम|મારું નામ|મારુ નામ)\s*",
    "phone": r"(?:(?:my )?(?:phone|mobile|contact)(?: number)?(?: is|\s*[:=])|number is|मेरा (?:फोन|फ़ोन|मोबाइल)(?: नंबर)?|મારો (?:ફોન|મોબાઇલ)(?: નંબર)?)\s*",
    "email": r"(?:(?:my )?(?:e-?mail)(?: address)?(?: is|\s*[:=])|मेरा (?:ईमेल|ई-मेल|email)|મારું (?:ઈમેલ|ઇમેઇલ|email)|મારુ (?:ઈમેલ|email))\s*",
    "message": r"(?:(?:my )?message(?: is|\s*[:=])|मेरा संदेश|મારો સંદેશ)\s*",
    "reason": r"(?:(?:my )?(?:reason|purpose)(?: is|\s*[:=])|कारण(?: है|\s*[:=])|કારણ(?: છે|\s*[:=]))\s*",
}
_PROMPTS = {
    "en": {"name": "What name should I put on the request?", "phone": "What phone number should the team call?", "email": "What is your email address? Please spell it out.", "reason": "What would you like the team to call you about?", "message": "What message would you like to send to the team?"},
    "hi": {"name": "Request में आपका क्या नाम लिखूँ?", "phone": "Team आपको किस फ़ोन नंबर पर call करे?", "email": "आपका email address क्या है? कृपया spelling बताइए।", "reason": "आप team से किस बारे में बात करना चाहते हैं?", "message": "आप team को क्या संदेश देना चाहते हैं?"},
    "gu": {"name": "Request માં તમારું શું નામ લખું?", "phone": "Team તમને કયા ફોન નંબર પર call કરે?", "email": "તમારું email address શું છે? કૃપા કરીને spelling કહો.", "reason": "તમે team સાથે શેના વિશે વાત કરવા માંગો છો?", "message": "તમે team ને શું સંદેશ આપવા માંગો છો?"},
}


def _missing(draft: dict) -> list[str]:
    fields = draft.get("fields", {})
    # Recompute from canonical required fields instead of trusting stale
    # next_field/missing_fields after successful native set-field calls.
    return [field for field in _REQUIRED.get(draft.get("request_type"), ()) if not str(fields.get(field, "")).strip()]


def is_request_confirmation(text: str) -> bool:
    """Mirror the API's whole-utterance confirmation grammar, not keyword yes."""
    value = re.sub(r"[.!?।,]+$", "", text.strip()).strip()
    return bool(re.fullmatch(r"(?:yes(?:[, ]+please)?(?:[, ]+(?:submit|send|confirm)(?: it| this| the request)?)?|(?:please )?(?:submit|send|confirm)(?: it| this| the request)|हाँ|हां|हाँ[, ]+(?:भेज दीजिए|भेज दो|सबमिट कर दीजिए)|हां[, ]+(?:भेज दीजिए|भेज दो)|भेज दीजिए|सबमिट कर दीजिए|હા|હા[, ]+(?:મોકલો|મોકલી દો|સબમિટ કરો)|મોકલી દો|સબમિટ કરો)", value, re.I))


def request_collection_prompt(draft: dict, language: str) -> str | None:
    if not isinstance(draft, dict) or draft.get("status", "draft") != "draft" or not isinstance(draft.get("fields", {}), dict):
        return None
    missing = _missing(draft)
    return _PROMPTS.get(language, {}).get(missing[0]) if missing else None


def _name(value: str) -> str | None:
    if not 1 <= len(value) <= 120 or not 1 <= len(value.split()) <= 5 or _QUESTIONS.search(value) or _COMMANDS.search(value):
        return None
    if re.search(r"\b(?:i|me|my|you|your|we|know|remember|again|is|am|are|want|need|would|like|interested|call|email|phone|number|about|buy|wholesale|order|product|request|team|it|this|that|not)\b|चाहि|करना|खरीद|चाहता|चाहती|नहीं|नही|बताइ|बताओ|मुझे|आप|मेरा|નથી|જોઈએ|ખરીદ|કરવું|મને|તમે|તમારું|કહો", value, re.I):
        return None
    if any(not (unicodedata.category(c)[0] in {"L", "M"} or c in " '-’") for c in value):
        return None
    return value


def _phone(value: str) -> str | None:
    normalized = value.translate(_DIGITS)
    if not re.fullmatch(r"\+?[\d\s().-]+", normalized):
        return None
    digits = re.sub(r"\D", "", normalized)
    return value if 8 <= len(digits) <= 15 else None


def _email(value: str) -> str | None:
    if not value.isascii():
        return None  # Do not invent a Latin spelling from an Indic transcript.
    normalized = re.sub(r"\b(?:underscore|at|dot|dash|hyphen|plus)\b", lambda m: {"underscore": "_", "at": "@", "dot": ".", "dash": "-", "hyphen": "-", "plus": "+"}[m[0].lower()], value, flags=re.I)
    normalized = re.sub(r"\s*([@._+\-])\s*", r"\1", normalized)
    # Adjacent words are not silently joined into an invented mailbox/domain.
    if re.search(r"\s", normalized):
        return None
    # This is only an extraction gate; the backend's email schema still decides.
    return normalized if len(normalized) <= 255 and re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", normalized) else None


def _value(field: str, value: str) -> str | None:
    if field == "name":
        return _name(value)
    if field == "phone":
        return _phone(value)
    if field == "email":
        return _email(value)
    if not value or len(value) > (2000 if field == "reason" else 4000) or _QUESTIONS.search(value) or _COMMANDS.search(value):
        return None
    return value


def extract_request_field(text: str, draft: dict) -> tuple[str, str] | None:
    if (not isinstance(text, str) or not isinstance(draft, dict) or draft.get("request_type") not in _REQUIRED
            or draft.get("status", "draft") != "draft" or not isinstance(draft.get("fields", {}), dict)):
        return None
    raw = text.strip()
    # An explicit message/purpose label quotes customer content. It may itself
    # be a polite request or question; it is not a command to this agent.
    literal_field = "message" if draft["request_type"] == "contact" else "reason"
    literal = re.fullmatch(_PREFIXES[literal_field] + r"(.+)", raw, re.I | re.S)
    if literal:
        content = literal[1].strip()
        if content and len(content) <= (4000 if literal_field == "message" else 2000):
            return literal_field, content
        return None
    if not raw or "?" in raw or "？" in raw or is_request_confirmation(raw):
        return None
    value = raw.rstrip(".!। ")
    fields = draft.get("fields", {})
    allowed = set(_REQUIRED[draft["request_type"]]) | ({"phone"} if draft["request_type"] == "contact" else set())
    # Prefixes must consume the whole utterance. Mixed answers stay ambiguous;
    # do not guess where a customer's name ends and their message begins.
    for field, pattern in _PREFIXES.items():
        if field not in allowed:
            continue
        match = re.fullmatch(pattern + r"(.+)", raw if field in {"reason", "message"} else value, re.I)
        if not match:
            continue
        supplied = re.sub(r"\s+(?:है|છે)$", "", match[1]).strip()
        checked = _value(field, supplied)
        return (field, checked) if checked is not None else None
    # The first callback request already states its purpose; keep it verbatim.
    # Do not overwrite a collected purpose from incidental later navigation.
    if draft["request_type"] == "callback" and not fields.get("reason") and re.search(
            r"\b(?:call me|team to call me|callback|call back)\b.{0,25}\b(?:about|regarding|for)\b|(?:कॉल|फोन).{0,20}(?:बारे|लिए)|(?:વિશે|માટે).{0,35}(?:ફોન|કોલ|કૉલ)", raw, re.I):
        if not re.search(r"\b(?:don't|do not|never|cancel|stop)\b|नहीं|मत|નહીં|નથી", raw, re.I) and len(raw) <= 2000:
            return "reason", raw
    if _QUESTIONS.search(value) or _COMMANDS.search(value):
        return None
    missing = _missing(draft)
    if not missing:
        return None
    field = missing[0]
    # An explicit but unrecognized form prefix is not a bare name/message.
    if re.search(r"^(?:my |मेरा |मेरी |મારું |મારો |મારુ )", value, re.I):
        return None
    checked = _value(field, raw if field in {"reason", "message"} else value)
    return (field, checked) if checked is not None else None
