"""Small non-factual conversation controls, shared by web and phone."""
from __future__ import annotations

import re
from sunpath_runtime import knowledge_topics, personalized_dose_question, language_request_target

LANGUAGE_ACK = {
    "en": "Sure, we can speak in English.",
    "hi": "हाँ, मैं हिंदी में बात कर सकती हूँ।",
    "gu": "હા, ચોક્કસ. આપણે ગુજરાતીમાં વાત કરી શકીએ છીએ.",
}

DISPATCH_UNKNOWN = {
    "en": "I don't have a confirmed daily dispatch schedule yet.",
    "hi": "रोज़ dispatch का schedule अभी मेरे पास confirm नहीं है।",
    "gu": "દરરોજ dispatch થાય છે કે નહીં, એ schedule મારી પાસે confirm નથી.",
}


def policy_reply(text: str, language: str) -> str | None:
    """Answer standalone policy questions without inventing product facts.

    Match the whole request so a policy keyword cannot swallow a second intent.
    """
    question = text.strip().rstrip(".!?।？ ")
    if (personalized_dose_question(question)
            and not (knowledge_topics(question) - {"usage directions"})
            and not re.search(r"\b(?:and|also|price|cost|buy|order|shipping|delivery|refund|ingredients?|benefits?)\b|और|कीमत|खरीद|घटक|फायदे|અને|કિંમત|ખરીદ|ઘટકો|ફાયદા", question, re.I)):
        return {
            "en": "I can't recommend an individual dose, including for children. Please follow the product label and ask a qualified doctor about suitability and amount.",
            "hi": "मैं किसी व्यक्ति या बच्चे के लिए अलग से मात्रा तय नहीं कर सकती। Product label देखें और यह आपके लिए सही है या नहीं, और कितनी मात्रा लेनी है, इसके लिए doctor से सलाह लें।",
            "gu": "હું કોઈ વ્યક્તિ કે બાળક માટે માત્રા નક્કી કરી શકતી નથી. Product label જુઓ અને તમારા માટે યોગ્ય છે કે નહીં તથા કેટલી માત્રા લેવી, તે માટે doctor ની સલાહ લો.",
        }[language]
    if re.fullmatch(r"(?:what is|who is|tell me about) (?:orthora|arthora|eartora)(?: farms)?", question, re.I):
        return {"en": "Do you mean Earthora Farms?", "hi": "क्या आप Earthora Farms की बात कर रहे हैं?", "gu": "શું તમે Earthora Farms વિશે પૂછો છો?"}[language]
    secret = re.fullmatch(
        r"(?:should|can|may|do) I (?:share|send|give|tell)(?: you)? (?:my |the )?(?:OTP|CVV|UPI PIN)(?: with you)?",
        question, re.I,
    )
    cure = re.fullmatch(
        r"(?:can|will|does) (?:it|this|this product|these tablets|your product) (?:cure|treat|prevent) [\w -]{1,45}",
        question, re.I,
    ) and not re.search(r"\b(?:and|also|or|price|cost|order)\b", question, re.I)
    if secret:
        return {
            "en": "No, please keep your OTP, CVV and UPI PIN private. Never share them with anyone.",
            "hi": "नहीं, अपना OTP, CVV और UPI PIN private रखें। इन्हें किसी से share न करें।",
            "gu": "ના, તમારો OTP, CVV અને UPI PIN private રાખો. એ કોઈની સાથે share ન કરો.",
        }[language]
    if cure:
        return {
            "en": "These products are not a treatment or cure. Please consult a qualified doctor for medical advice.",
            "hi": "ये products किसी बीमारी का इलाज नहीं हैं। Medical advice के लिए qualified doctor से बात करें।",
            "gu": "આ products કોઈ બીમારીનો ઇલાજ નથી. Medical advice માટે qualified doctor સાથે વાત કરો.",
        }[language]
    return None


def dispatch_schedule_missing(text: str, knowledge: list[dict]) -> bool:
    if not re.search(r"\bdispatch\b|डिस्पैच|ડિસ્પેચ", text, re.I):
        return False
    if not re.search(r"\b(?:daily|every day|which days|what days|when)\b|रोज़?|किस दिन|दररोज|દરરોજ|કયા દિવસે", text, re.I):
        return False
    for entry in knowledge:
        content = str(entry.get("text", ""))
        for sentence in re.split(r"[.!?।\n]", content):
            # A question is not an approved answer about the dispatch calendar.
            if sentence.lstrip().startswith("Q:"):
                continue
            if (re.search(r"dispatch|डिस्पैच|ડિસ્પેચ", sentence, re.I)
                    and re.search(r"daily|every day|same.?day|same (?:business|working) day|next (?:business|working) day|within|before.{0,15}(?:AM|PM)|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|weekdays?|रोज़?|दररोज|દરરોજ", sentence, re.I)):
                return False
    return True


def trim_unsolicited_followup(reply: str, question: str) -> str:
    """Drop an appended sales/chitchat question after a direct factual answer.

    Never remove the only sentence, uncertainty clarification, or questions
    needed for a purchase/checkout flow. No new words or facts are introduced.
    """
    factual_question = bool(re.search(r"ingredients?|composition|benefits?|सामग्री|घटक|फायदे|लाभ|ઘટકો|સામગ્રી|ફાયદા|લાભ|में क्या", question, re.I))
    sentences = re.split(r"(?<=[.!?।])\s+", reply.strip())
    if len(sentences) < 2 or not sentences[-1].endswith(("?", "？")):
        return reply
    before = " ".join(sentences[:-1])
    if re.search(r"don't know|not sure|unconfirmed|not confirmed|cannot confirm|which product|पक्का|confirm नहीं|કયો product|ચોક્કસ નથી", before, re.I):
        return reply
    if not factual_question:
        # A topic offer is not a benefit claim. The observed compound story
        # answer was grounded, but its optional 'health benefits or products?'
        # offer introduced a new topic without the relevant product evidence.
        # Remove only that extra offer; never relax the downstream claim guard.
        company_question = (re.search(r"\b(?:earthora|our story|your company|your farm)\b", question, re.I)
                            and re.search(r"\b(?:what|who|how|tell|explain|about|story)\b", question, re.I))
        request_flow = re.search(r"\b(?:callback|call me|enquir[yi]|request|submit|buy|purchase|checkout|cart|order)\b", question, re.I)
        optional_offer = re.fullmatch(r"(?:would|do) you like (?:to |me to ).*\b(?:health benefits|benefits|products)\b.*\?", sentences[-1], re.I)
        company_answer = any(re.search(r"\bEarthora\b", sentence, re.I) and not sentence.endswith("?") for sentence in sentences[:-1])
        uncertain = re.search(r"\b(?:don't have|do not have|cannot|can't|couldn't|unsure)\b", before, re.I)
        if not (company_question and company_answer and optional_offer) or request_flow or uncertain:
            return reply
    return before


def language_only_reply(text: str, language: str) -> str | None:
    """A standalone language request needs no product knowledge or inference.

    Deliberately match a whole request. A request containing a business
    question, negation or third-party language description stays with the LLM.
    """
    if language in LANGUAGE_ACK and language_request_target(text) == language:
        return LANGUAGE_ACK[language]
    return None


def correct_spoken_grammar(text: str, language: str) -> str:
    """Repair a few observed Hindi agreement errors without another model call.

    Use only on normal generated prose, never verbatim request fields/readbacks.
    All claims still need the usual output guard after this function. Quotes,
    hedges and negations are deliberately left unchanged.
    """
    if language != "hi" or re.search(r"[\"'“”‘’«»]|\b(?:may|might|could)\b|नहीं|शायद|संभव|सकता है|सकती है", text, re.I):
        return text
    corrected = re.sub(r"हम\s+((?:हिंदी|हिन्दी|गुजराती|अंग्रेज़ी|अंग्रेजी)\s+में\s+बात\s+कर)\s+सकती\s+हूँ", r"हम \1 सकते हैं", text)
    corrected = re.sub(r"मैं\s+((?:(?:हिंदी|हिन्दी|गुजराती|अंग्रेज़ी|अंग्रेजी)\s+में\s+बात\s+कर|(?:आपकी\s+)?मदद\s+कर))\s+(?:सकता\s+हूँ|सकते\s+हैं)", r"मैं \1 सकती हूँ", corrected)
    # The observed redundant benefits predicate has one exact shape. Preserve
    # the product and list verbatim; do not rewrite quantities or extra clauses.
    pattern = r"(?P<product>मोरिंगा|Moringa)\s+(?:की|के)\s+(?:मुख्य\s+)?फायदे\s+(?P<benefits>[^।.!?;:\d\n]{1,160})\s+में\s+मदद\s+करना\s+है(?P<end>[।.!]?)"
    match = re.fullmatch(pattern, corrected.strip(), re.I)
    if match and not re.search(r"\b(?:only|always|guaranteed)\b|केवल|सिर्फ|ज़रूर|जरूर|गारंटी|इलाज|ठीक", match["benefits"], re.I):
        return f'{match["product"]} {match["benefits"]} में मदद करता है{match["end"]}'
    return corrected


def turn_guidance(text: str, language: str, catalog: list[dict]) -> str:
    """Keep the current conversational task close to the caller's message.

    This supplies behavior, never product facts. Knowledge remains in the
    authoritative context and tool results. Narrow cues do not execute actions.
    """
    base = (f"CURRENT TURN LANGUAGE: {language}. Address the latest customer intent using current Earthora facts and successful tools. "
            "Answer directly; guide an exploration, purchase or enquiry with ONE relevant next question or tool action. For a simple factual question, no automatic sales pitch. "
            "Use natural everyday words. Keep Moringa in Latin or spell it मोरिंगा / મોરિંગા as appropriate; never split one word across scripts. ")
    if language == "hi":
        base += ("Hindi agreement: Eva says 'मैं मदद कर सकती हूँ'; 'हम' takes 'कर सकते हैं'. "
                 "Use '[product] के फायदे हैं', not 'की फायदे है'. Prefer short everyday Hinglish with familiar technical English words; never invent literary wellness words. ")
    if re.search(r"\b(?:what is|who is|tell me about)\s+(?:earthora|orthora)(?:\s+farms)?[?.!\s]*$|कंपनी|કંપની", text, re.I):
        base += "This is a COMPANY IDENTITY question, not a product lookup. If the heard name is Orthora, ask briefly 'Do you mean Earthora Farms?' and describe the company using only the supplied company facts. Do not say a product is unavailable. "
    if re.search(r"\b(?:want|would like|need).{0,24}(?:buy|purchase)|મારે.{0,30}લેવું છે|ખરીદ|खरीदना", text, re.I):
        base += "This is PURCHASE INTENT, not instructions for consuming tablets. Use the product already discussed; if no quantity was stated ask for quantity, never invent one. "
        if len(catalog) == 1:
            base += "Only one product is in the current catalog, so 'this' refers to that product unless the caller indicates otherwise. "
        base += {"gu": "Natural question style: તમને કેટલી બોટલ જોઈએ છે? ", "hi": "Natural question style: आपको कितनी बोतलें चाहिए? ", "en": "Natural question style: How many bottles would you like? "}.get(language, "")
    if re.search(r"\bdispatch\b|डिस्पैच|ડિસ્પેચ", text, re.I):
        base += "The caller asks about DISPATCH, which is different from delivery duration. Look for an explicit dispatch calendar or cutoff in the supplied facts. If absent, clearly say that the dispatch schedule is unconfirmed. Do not infer yes/no, weekdays or daily dispatch from transit time or tracking alerts. "
    if re.search(r"ingredients?|composition|सामग्री|घटक|ઘટકો|સામગ્રી|में क्या|શું છે", text, re.I):
        base += "Answer the INGREDIENTS question with the exact relevant composition from the facts. Keep it short; no purchase invitation, dosage instructions, unrelated benefits or follow-up question. "
        if language == "hi":
            base += ("Use everyday Hinglish, retaining these technical terms verbatim in Latin when relevant: tablet, mg, Moringa leaf, synthetic binders, fillers. "
                     "Use the simple sentence pattern 'हर tablet में [approved amount and ingredient] है।' Mention only the requested composition; omit extra FAQ details unless asked about additives. ")
    if re.search(r"\b(?:cure|treat|prevent)\b|इलाज|ठीक कर|રોગ મટાડ", text, re.I):
        base += "This is a medical-outcome question, not a dosage question. Do not promise a cure or treatment. Respond directly that this is not a treatment or cure and suggest qualified medical advice when needed. Do not introduce dose instructions. "
    if re.search(r"\b(?:OTP|CVV|UPI PIN)\b|ओटीपी|ઓટીપી", text, re.I):
        base += "Keep payment credentials private: tell the caller not to share an OTP, CVV or UPI PIN. Never request or repeat a secret. "
    return base
