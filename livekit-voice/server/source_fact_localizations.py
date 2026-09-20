"""Reviewed translations bound to complete, current approved source records.

This is a translation cache, not an independent knowledge source. A changed
English fact, missing visible evidence, conflicting records or a different
question returns None and stays with the normal guarded workflow.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

from sunpath_runtime import TurnState, _focused_products, _relevant_entries, knowledge_issue, knowledge_topics


INGREDIENTS_SHA = "9b4bbce70472445e2fbbdff06aa9bcfcacdec5de9085f8b5063bfee119583ab4"
DOSAGE_SHA = "b2423f1efd9688b91ce76daf64e5535f4e69e59f85a4520f57a49f4aba55c37e"
DIRECTIONS_SHA = "a7d1fa1484d5044580a1c58d1639dab98372a5639ffe335a1dee0534cadcd056"

# Reviewed against the full approved English records captured September 20,
# 2026. Whitespace/NFC normalization is allowed; quantities, wording and
# punctuation otherwise remain part of the fingerprint.
_TRANSLATIONS = {
    INGREDIENTS_SHA: {
        "category": "ingredients",
        "hi": "हर टैबलेट में 500 मिलीग्राम Moringa Leaf है।",
        "gu": "દરેક ટેબ્લેટમાં 500 મિલિગ્રામ Moringa Leaf છે.",
    },
    DOSAGE_SHA: {
        "category": "dosage",
        "hi": "Product label के अनुसार, रोज़ 1–2 टैबलेट एक बार या दो बार लें, नाश्ते या रात के खाने से पहले। कोई health condition हो, नियमित दवाइयाँ लेते हों, या सही मात्रा को लेकर संदेह हो, तो doctor से सलाह लें।",
        "gu": "Product label પ્રમાણે, દરરોજ 1–2 ગોળીઓ એક વાર અથવા બે વાર લો, નાસ્તા અથવા રાત્રે ભોજન પહેલાં. કોઈ સ્વાસ્થ્ય સમસ્યા હોય, નિયમિત દવાઓ લેતા હો, અથવા યોગ્ય માત્રા અંગે ખાતરી ન હોય, તો doctor ની સલાહ લો.",
    },
    DIRECTIONS_SHA: {
        "category": "directions",
        "hi": "Product label के अनुसार, रोज़ 1–2 टैबलेट एक बार या दो बार पानी के साथ लें, नाश्ते या रात के खाने से पहले।",
        "gu": "Product label પ્રમાણે, દરરોજ 1–2 ગોળીઓ એક વાર અથવા બે વાર પાણી સાથે લો, નાસ્તા અથવા રાત્રે ભોજન પહેલાં.",
    },
}

# This two-sentence rendering is permitted only when BOTH complete source
# fingerprints are present. It combines their shared directions without
# dropping the dosage record's health/regular-medicine/uncertainty caveats.
_COMBINED_USAGE = {
    "hi": "Product label के अनुसार, रोज़ 1–2 टैबलेट एक बार या दो बार पानी के साथ लें, नाश्ते या रात के खाने से पहले। कोई health condition हो, नियमित दवाइयाँ लेते हों, या सही मात्रा को लेकर संदेह हो, तो doctor से सलाह लें।",
    "gu": "Product label પ્રમાણે, દરરોજ 1–2 ગોળીઓ એક વાર અથવા બે વાર પાણી સાથે લો, નાસ્તા અથવા રાત્રે ભોજન પહેલાં. કોઈ સ્વાસ્થ્ય સમસ્યા હોય, નિયમિત દવાઓ લેતા હો, અથવા યોગ્ય માત્રા અંગે ખાતરી ન હોય, તો doctor ની સલાહ લો.",
}

_OTHER_REQUEST = re.compile(
    r"\b(?:additives?|binders?|fillers?|lubricants?|coatings?|stearate|caffeine|allergens?|benefits?|price|cost|stock|available|buy|purchase|cart|checkout|shipping|delivery|dispatch|refund|return|storage|store|where|farm|origin|company)\b"
    r"|बाइंडर|फिलर|कैफीन|मिलावट|फायदे|लाभ|कीमत|खरीद|डिलीवरी|कहाँ|ભેળસેળ|બાઇન્ડર|ફિલર|કેફીન|ફાયદા|લાભ|કિંમત|ખરીદ|ડિલિવરી|ક્યાં", re.I)
_PERSONAL_HEALTH = re.compile(
    r"\b(?:pregnan\w*|breastfeed\w*|diabet\w*|blood|sugar|asthma|hypertension|kidney|heart|medicin\w*|medications?|meds|condition|diseases?|illness|doctor|safe|safety|child|children|kids?|baby|sons?|daughters?|mothers?|fathers?|parents?|wife|husband|allerg\w*|cure|treat|i have|i am|i'm)\b"
    r"|गर्भ|स्तनपान|दवाइ|दवाई|दवा|बीमारी|बच्च|बेट[ाेी]|माता|पिता|माँ|मेरी मां|शुगर|मधुमेह|अस्थमा|दमा|बीपी|डॉक्टर|सुरक्षित|डायबिट|क्या मैं|प्रेग्न"
    r"|ગર્ભ|સ્તનપાન|દવા|બીમારી|બાળક|દીકર|દીકરી|પુત્ર|પુત્રી|માતા|પિતા|મમ્મી|પપ્પા|શુગર|મધુમેહ|અસ્થમા|બીપી|ડોક્ટર|સુરક્ષિત|ડાયાબિટ|મને.{0,20}(?:રોગ|તકલીફ|સમસ્યા)", re.I)


def source_sha256(text: str) -> str:
    return hashlib.sha256(" ".join(unicodedata.normalize("NFC", text).split()).encode("utf-8")).hexdigest()


def approved_fact_reply(turn: TurnState) -> str | None:
    """Return a source-bound HI/GU translation for one simple fact request."""
    if turn.language not in {"hi", "gu"} or knowledge_issue(turn) is not None:
        return None
    topics = knowledge_topics(turn.text)
    if topics not in ({"ingredients composition"}, {"usage directions"}):
        return None
    products = _focused_products(turn)
    if len(products) != 1 or not products[0].get("id"):
        return None
    # Product names can contain English nouns/numbers; remove only the exact
    # current name before testing whether the user added another request.
    question = turn.text.replace(str(products[0].get("name", "")), "")
    if _OTHER_REQUEST.search(question) or _PERSONAL_HEALTH.search(question) or re.search(r"\d", question):
        return None
    topic = next(iter(topics))
    categories = {"ingredients"} if topic == "ingredients composition" else {"dosage", "directions"}

    def records(include_omitted=False):
        return [entry for entry in _relevant_entries(turn, topic, include_omitted=include_omitted)
                if entry.get("source") == "product_knowledge" and entry.get("category") in categories]

    visible, complete = records(), records(True)
    if not visible:
        return None
    fingerprints = set()
    for entry in complete:
        fingerprint = source_sha256(entry["text"])
        translation = _TRANSLATIONS.get(fingerprint)
        locale = str(entry.get("locale", "")).lower().replace("_", "-").split("-")[0]
        if (entry.get("product_id") != products[0]["id"] or entry.get("status") != "approved" or not entry.get("source_id")
                or locale != "en" or entry.get("question") or not translation
                or translation["category"] != entry.get("category")):
            return None
        fingerprints.add(fingerprint)
    if fingerprints != {source_sha256(entry["text"]) for entry in visible}:
        return None  # Do not omit a known caveat merely because it missed the budget.
    if fingerprints == {DOSAGE_SHA, DIRECTIONS_SHA}:
        return _COMBINED_USAGE[turn.language]
    if len(fingerprints) == 1:
        return _TRANSLATIONS[next(iter(fingerprints))][turn.language]
    return None
