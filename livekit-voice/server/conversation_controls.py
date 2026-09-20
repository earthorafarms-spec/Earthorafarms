"""Small non-factual conversation controls, shared by web and phone."""
from __future__ import annotations

import re
from sunpath_runtime import knowledge_topics, personalized_dose_question

LANGUAGE_ACK = {
    "en": "Sure, we can speak in English.",
    "hi": "हाँ, बिल्कुल। हम हिंदी में बात कर सकते हैं।",
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
    if not re.search(r"ingredients?|composition|benefits?|सामग्री|घटक|फायदे|लाभ|ઘટકો|સામગ્રી|ફાયદા|લાભ|में क्या", question, re.I):
        return reply
    sentences = re.split(r"(?<=[.!?।])\s+", reply.strip())
    if len(sentences) < 2 or not sentences[-1].endswith(("?", "？")):
        return reply
    before = " ".join(sentences[:-1])
    if re.search(r"don't know|not sure|unconfirmed|not confirmed|cannot confirm|which product|पक्का|confirm नहीं|કયો product|ચોક્કસ નથી", before, re.I):
        return reply
    return before


def language_only_reply(text: str, language: str) -> str | None:
    """A standalone language request needs no product knowledge or inference.

    Deliberately match a whole request. A request containing a business
    question, negation or third-party language description stays with the LLM.
    """
    names = r"(?:English|Hindi|Gujarati|अंग्रेज़ी|अंग्रेजी|हिंदी|हिन्दी|गुजराती|ગુજરાતી|હિન્દી|અંગ્રેજી)"
    patterns = (
        rf"(?:please\s+)?{names}(?:\s+please)?",
        rf"(?:can|could|will|would)\s+(?:you|we)\s+(?:please\s+)?(?:speak|talk|reply|respond)(?:\s+(?:to me|in))?\s+{names}(?:\s+please)?",
        rf"(?:please\s+)?(?:speak|talk|reply|respond|switch|continue)(?:\s+(?:to me|in|to))?\s+{names}(?:\s+please)?",
        rf"(?:then\s+)?I\s+(?:speak|want to speak|want to talk in)\s+{names}",
        rf"(?:क्या\s+)?आप\s+{names}\s+(?:में\s+)?(?:बोल|बात कर)\s+(?:सकते|सकती)\s+हैं",
        rf"(?:कैन यू\s+)?(?:स्पीक\s+)?{names}\s+(?:में\s+)?(?:बोलिए|बोलो|बात कीजिए)",
        rf"कैन यू स्पीक\s+{names}",
        rf"(?:શું\s+)?તમે\s+{names}(?:માં)?\s+(?:બોલી|વાત કરી)\s+શકો\s+છો",
        rf"{names}(?:માં)?\s+(?:બોલો|વાત કરો)",
    )
    normalized = text.strip().rstrip(".!?।？ ")
    if language in LANGUAGE_ACK and any(re.fullmatch(pattern, normalized, re.I) for pattern in patterns):
        return LANGUAGE_ACK[language]
    return None


def turn_guidance(text: str, language: str, catalog: list[dict]) -> str:
    """Keep the current conversational task close to the caller's message.

    This supplies behavior, never product facts. Knowledge remains in the
    authoritative context and tool results. Narrow cues do not execute actions.
    """
    base = (f"CURRENT TURN LANGUAGE: {language}. Answer only the latest customer question, using the current Earthora facts and successful tools. "
            "Give one brief direct answer and stop. Ask a follow-up only for information needed for the requested action. "
            "Use natural everyday words. Keep Moringa in Latin or spell it मोरिंगा / મોરિંગા as appropriate; never split one word across scripts. ")
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
