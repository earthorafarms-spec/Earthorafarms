"""Speak a validated request review without asking the model to copy contact data.

This is a formatter, not a submission authority. Only the API can validate a new
confirmation turn and the current review token. No fields or tokens are logged.
"""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class ReviewSpeech:
    text: str
    ready_for_confirmation: bool
    request_id: str


_COPY = {
    "en": {
        "intro": "Please check these details", "name": "Name", "email": "Email",
        "phone": "Phone", "message": "Message", "reason": "Callback purpose", "topic": "Topic",
        "consent": "Marketing updates", "yes": "yes", "no": "no",
        "confirm": "Should I submit this request to the team?",
        "shorten": "The full request is too long to read back safely. Please give me a briefer message so I can review every detail before submission.",
        "ack": "Your request is recorded for the Earthora team.",
        "digits": "zero one two three four five six seven eight nine".split(), "plus": "plus",
    },
    "hi": {
        "intro": "कृपया ये details जाँच लें", "name": "नाम", "email": "Email",
        "phone": "फ़ोन", "message": "संदेश", "reason": "Callback का कारण", "topic": "विषय",
        "consent": "Marketing updates", "yes": "हाँ", "no": "नहीं",
        "confirm": "क्या मैं यह request team के लिए submit कर दूँ?",
        "shorten": "पूरी request इतनी लंबी है कि अभी सभी details पढ़कर confirm नहीं कर सकती। कृपया संदेश छोटा करके बताइए, फिर हर detail जाँच लेंगे।",
        "ack": "आपकी request Earthora team के लिए दर्ज हो गई है।",
        "digits": "शून्य एक दो तीन चार पाँच छह सात आठ नौ".split(), "plus": "प्लस",
    },
    "gu": {
        "intro": "કૃપા કરીને આ વિગતો તપાસો", "name": "નામ", "email": "Email",
        "phone": "ફોન", "message": "સંદેશ", "reason": "Callback નું કારણ", "topic": "વિષય",
        "consent": "Marketing updates", "yes": "હા", "no": "ના",
        "confirm": "શું હું આ request team માટે submit કરું?",
        "shorten": "આખી request એટલી લાંબી છે કે હમણાં બધી વિગતો વાંચીને ખાતરી કરી શકતી નથી. કૃપા કરીને સંદેશ ટૂંકો કરીને કહો, પછી દરેક વિગત તપાસીશું.",
        "ack": "તમારી request Earthora team માટે નોંધાઈ ગઈ છે.",
        "digits": "શૂન્ય એક બે ત્રણ ચાર પાંચ છ સાત આઠ નવ".split(), "plus": "પ્લસ",
    },
}
_EMAIL_SYMBOLS = {
    "_": "underscore", "@": "at", ".": "dot", "+": "plus", "-": "hyphen",
    "!": "exclamation mark", "#": "hash", "$": "dollar sign", "%": "percent",
    "&": "ampersand", "'": "apostrophe", "*": "asterisk", "/": "slash",
    "=": "equals", "?": "question mark", "^": "caret", "`": "backtick",
    "{": "open brace", "}": "close brace", "|": "vertical bar", "~": "tilde",
}
_NUMBER_TRANSLATION = str.maketrans("०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯", "01234567890123456789")


def _email(value: str, language: str) -> str:
    # Keep alphabetic runs and their case verbatim. Speak punctuation explicitly
    # so normalization/TTS cannot silently erase meaningful address characters.
    chunks = []
    for part in re.findall(r"[A-Za-z]+|.", value):
        chunks.append(_COPY[language]["digits"][int(part)] if part.isascii() and part.isdigit()
                      else _EMAIL_SYMBOLS.get(part, part))
    return " ".join(chunks)


def _phone(value: str, language: str) -> str | None:
    value = value.translate(_NUMBER_TRANSLATION)
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
        return None
    return " ".join([_COPY[language]["plus"], *(_COPY[language]["digits"][int(digit)] for digit in value[1:])])


def request_review_reply(result: dict, language: str) -> ReviewSpeech | None:
    """Format the exact review tool fields, or safely ask for a shorter message.

    None means there is no valid complete review to narrate. A false
    ready_for_confirmation means the full review did not fit; the caller must
    collect an edit and obtain a new API review before asking for confirmation.
    """
    if language not in _COPY or not isinstance(result, dict) or result.get("ok") is not True:
        return None
    data = result.get("data")
    if not isinstance(data, dict) or data.get("status") != "draft" or not isinstance(data.get("request_id"), str):
        return None
    token = data.get("confirmation_token")
    if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{48}", token):
        return None
    kind, fields = data.get("request_type"), data.get("fields")
    if kind not in {"contact", "callback"} or not isinstance(fields, dict):
        return None
    required = ["name", "email", "message"] if kind == "contact" else ["name", "phone", "reason"]
    allowed = set(required) | ({"phone", "topic", "marketingConsent"} if kind == "contact" else set())
    if set(fields) - allowed or any(not isinstance(fields.get(key), str) or not fields[key].strip() for key in required):
        return None
    if any(not isinstance(value, str) or any(ord(c) < 32 and c not in "\n\r\t" for c in value)
           for key, value in fields.items() if key != "marketingConsent"):
        return None
    if kind == "contact" and not isinstance(fields.get("marketingConsent"), bool):
        return None  # Do not invent the consent state of a malformed review.
    copy = _COPY[language]
    parts = [copy["intro"] + ":", copy["name"] + ": " + fields["name"] + ";"]
    for key in ("email", "phone", "topic", "message", "reason"):
        value = fields.get(key)
        if not value:
            continue
        if key == "email":
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
                return None
            value = _email(value, language)
        elif key == "phone":
            value = _phone(value, language)
            if value is None:
                return None
        parts.append(copy[key] + ": " + value + ";")
    if kind == "contact":
        parts.append(copy["consent"] + ": " + copy["yes" if fields["marketingConsent"] else "no"] + ";")
    text = " ".join([*parts, copy["confirm"]])
    if len(text) > 1200 or len(text.split()) > 70:
        return ReviewSpeech(copy["shorten"], False, data["request_id"])
    return ReviewSpeech(text, True, data["request_id"])


def submitted_request_reply(result: dict, language: str) -> str | None:
    """A queue receipt is neither a delivery receipt nor a promised callback."""
    if language not in _COPY or not isinstance(result, dict) or result.get("ok") is not True:
        return None
    data = result.get("data")
    if (not isinstance(data, dict) or not isinstance(data.get("request_id"), str)
            or data.get("request_type") not in {"contact", "callback"}
            or data.get("recorded") is not True or data.get("notification_queued") is not True
            or data.get("notification_status") != "queued"):
        return None
    return _COPY[language]["ack"]
