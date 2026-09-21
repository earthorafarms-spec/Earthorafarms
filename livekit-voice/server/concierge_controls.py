"""Small intent/state controls for explicit website and enquiry actions.

These choose existing native tools; they do not execute writes or invent facts.
"""
import re
from sunpath_runtime import knowledge_topics


def requested_destination(text: str, guide: list[dict]) -> str | None:
    if re.search(r"\b(?:don't|do not|not|stop|cancel|never)\b|मत|नहीं|નહીં|\bના\b", text, re.I):
        return None
    if not re.search(r"\b(?:show|open|navigate|take me|go to|bring me)\b|दिखा|खोल|ले चल|બતાવ|ખોલ|લઈ જ", text, re.I):
        return None
    choices = {
        "our_story": r"\bstory\b|our farm|कहानी|हमारे बारे|વાર્તા|અમારા વિશે",
        "products": r"\bproducts?\b|उत्पाद|प्रोडक्ट|પ્રોડક્ટ|ઉત્પાદન",
        "contact_form": r"contact form|enquiry form|संपर्क.*फॉर्म|enquiry.*ફોર્મ",
        "contact": r"\bcontact\b|संपर्क|સંપર્ક",
        "health_benefits": r"\bbenefits?\b|फायदे|લાભ|ફાયદા",
        "faq": r"\bfaq\b|common questions|आम सवाल|સામાન્ય પ્રશ્ન",
        "shipping_policy": r"shipping|delivery policy|शिपिंग|શિપિંગ",
        "privacy_policy": r"privacy|गोपनीयता|ગોપનીયતા",
        "terms_of_use": r"terms|शर्तें|શરતો",
        "home": r"\bhome(?:page)?\b|होम|હોમ",
    }
    allowed = {entry.get("id") for entry in guide}
    matches = [key for key, pattern in choices.items() if key in allowed and re.search(pattern, text, re.I)]
    if "contact_form" in matches and "contact" in matches:
        matches.remove("contact")
    # Multiple possible destinations need the normal model/clarification path.
    return matches[0] if len(matches) == 1 else None


def requested_request_type(text: str) -> str | None:
    if re.search(r"\b(?:don't|do not|not|cancel|never)\b|मत|नहीं|નહીં|\bના\b", text, re.I):
        return None
    if re.search(r"\b(?:call me|callback|call back|team to call|speak to (?:a human|your team))\b|मुझे.{0,16}कॉल|callback|કૉલ.*કરો|મને.{0,16}(?:ફોન|કોલ)|ટીમ.*વાત", text, re.I):
        return "callback"
    if re.search(r"\b(?:send|submit|make|start|help).{0,45}\b(?:enquiry|inquiry|request)\b|(?:enquiry|inquiry).{0,20}(?:करनी|करना|भेज)|(?:પૂછપરછ|વિનંતી).{0,20}(?:કરવી|મોકલ)|(?:भेज|submit).{0,20}(?:enquiry|request)", text, re.I):
        return "contact"
    return None


def navigation_preference(text: str) -> bool | None:
    """Only explicit screen-control requests change the automatic guide."""
    if re.search(r"(?:don't|do not|stop|no more).{0,20}(?:navigat|scroll|show|open|take me|chang\w* (?:the )?page)|(?:stay|remain) on (?:this|the current) page|(?:पेज|page|स्क्रीन).{0,12}(?:मत बदल|नहीं बदल)|मत (?:दिखा|खोल)|(?:પેજ|page|સ્ક્રીન).{0,12}(?:ન બદલો|નહીં બદલ)|(?:બતાવ|ખોલ).{0,10}નહીં", text, re.I):
        return False
    if re.search(
            r"(?:पेज|page|स्क्रीन).{0,16}(?:न(?:हीं)?\s+(?:बदल|खोल|दिखा)|(?:बदलना|बदलें|बदलिए|खोलना|खोलें|दिखाना)\s+मत)"
            r"|(?:પેજ|page|સ્ક્રીન).{0,16}(?:ન(?:હીં|હિ)?\s+(?:બદલ|ખોલ|બતાવ)|(?:બદલ(?:શો|તા|વું|ો)?|ખોલ(?:શો|તા|વું|ો)?|બતાવ(?:શો|તા|વું|ો)?)\s+(?:નહીં|નહિ|ના))"
            r"|(?:સ્ક્રોલ|scroll)(?:\s+કરશો)?\s+(?:નહીં|નહિ)", text, re.I):
        return False
    if re.search(r"(?:resume|enable|start).{0,16}(?:automatic navigation|page navigation|guided tour)|(?:you can|please) guide me (?:through|around) (?:the |your )?(?:website|site)", text, re.I):
        return True
    return None


def navigation_needs_answer(text: str) -> bool:
    """Preserve a substantive question alongside a page-opening command."""
    # Permission-style 'can you show'/'क्या आप खोल सकते हैं' alone is an
    # opening request. Its grammatical question form is not a separate topic.
    substantive = re.sub(r"^\s*(?:क्या\s+(?:आप|तुम)|શું\s+(?:તમે|આપ))\s+", "", text)
    return bool(re.search(
        r"\b(?:tell|explain|describe|what|how|why|which|who|when|where)\b"
        r"|बताइए|बताइये|बताओ|बताएं|बताएँ|समझाइए|समझाइये|समझाओ|समझाएं|समझाएँ|क्या|क्यों|कैसे|कौन|कितन[ाेी]|किस|कहाँ|कब"
        r"|સમજાવ|જણાવ|શું|કેમ|કેવી|કયો|કઈ|કોણ|ક્યારે|ક્યાં|કેટલ", substantive, re.I))


def contextual_destination(text: str, guide: list[dict], *, current: str | None = None) -> str | None:
    """Open the public content relevant to a substantive visitor question.

    This chooses a screen, not an answer or a new source of approved facts.
    It never routes checkout, forms, contact data, dosage or a phone session.
    """
    if navigation_preference(text) is False or requested_request_type(text):
        return None
    if "usage directions" in knowledge_topics(text):
        return None
    # Personal state belongs to its validated tool flow, not a vaguely related
    # public page. Generic delivery/shipping-policy questions remain eligible.
    if re.search(
            r"\b(?:cart|basket|checkout|account|log ?in|sign in|password|profile|otp|cvv|upi pin|payment|invoice)\b"
            r"|\b(?:my|our|this|that)\s+(?:(?:current|last|existing)\s+)?order\b"
            r"|\border\s+(?:number|id|status|tracking)\b|\btracking\s+(?:number|id)\b"
            r"|कार्ट|बास्केट|अकाउंट|खाता|खाते|लॉगिन|पासवर्ड|भुगतान|पेमेंट|इनवॉइस|ओटीपी|ट्रैकिंग"
            r"|(?:मेरा|मेरे|मेरी|इस|उस)\s+ऑर्डर|ऑर्डर\s+(?:नंबर|आईडी|स्टेटस)"
            r"|કાર્ટ|બાસ્કેટ|એકાઉન્ટ|ખાતું|લોગિન|પાસવર્ડ|ચુકવણી|પેમેન્ટ|ઇનવોઇસ|ઓટીપી|ટ્રેકિંગ"
            r"|(?:મારો|મારા|મારી|આ|એ)\s+ઓર્ડર|ઓર્ડર\s+(?:નંબર|આઈડી|સ્ટેટસ)", text, re.I):
        return None
    if re.search(r"^(?:my (?:name|email|phone|message|reason)|मेरा (?:नाम|ईमेल|फोन|संदेश)|મારું (?:નામ|ઈમેલ)|મારો (?:ફોન|સંદેશ))\b", text, re.I):
        return None
    destination = None
    if re.search(r"\b(?:benefits?|fayde|faayde|faida|fayda|labh)\b|फायदे|फायदा|लाभ|ફાયદા|ફાયદો|લાભ", text, re.I):
        destination = "health_benefits"
    elif re.search(r"\b(?:ingredients?|composition|contains?|made (?:of|from))\b|सामग्री|घटक|में क्या|ઘટકો|સામગ્રી|માં શું", text, re.I):
        products = [item["id"] for item in guide if isinstance(item.get("id"), str) and item["id"].startswith("product:")]
        # Multi-product catalogues need the normal product-resolution path.
        destination = products[0] if len(products) == 1 else "products"
    elif re.search(r"\b(?:shipping|delivery policy|dispatch|courier)\b|डिलीवरी|शिपिंग|डिस्पैच|ડિલિવરી|શિપિંગ|ડિસ્પેચ", text, re.I):
        # Order-specific tracking details are not the public shipping policy.
        if not re.search(r"\b(?:my order|order (?:number|id)|tracking number)\b|मेरा ऑर्डर|મારો ઓર્ડર", text, re.I):
            destination = "shipping_policy"
    elif re.search(r"\b(?:privacy|personal data policy)\b|गोपनीयता|ગોપનીયતા", text, re.I):
        destination = "privacy_policy"
    elif re.search(r"\b(?:your (?:company|farm|story)|earthora|orthora|eartora)\b|अर्थोरा|एर्थोरा|कंपनी|अर्थरा|અર્થોરા|કંપની", text, re.I):
        if re.search(r"\b(?:what|who|how|tell|about|help|story)\b|क्या|कौन|कैसे|बताए|बताइ|हेल्प|बारे|શું|કોણ|કેવી|વિશે|મદદ", text, re.I):
            destination = "our_story"
    elif re.search(r"\b(?:what (?:is|are) (?:moringa|mooringa|your products?)|which products|what (?:do you )?sell|tell me about (?:moringa|your products))\b|(?:मोरिंगा|प्रोडक्ट|उत्पाद).{0,15}क्या|(?:મોરિંગા|પ્રોડક્ટ|ઉત્પાદન).{0,15}શું", text, re.I):
        destination = "products"
    allowed = {item.get("id") for item in guide}
    return destination if destination in allowed and destination != current else None


def active_request(turn) -> dict | None:
    for result in reversed(turn.tool_results):
        data = result.get("data")
        if result.get("ok") and isinstance(data, dict) and data.get("request_type") and data.get("fields") is not None:
            return data
    return next((draft for draft in turn.data.get("request_drafts", []) if draft.get("status") == "draft"), None)


def concierge_guidance(turn) -> str:
    text = ""
    if turn.data.get("channel") == "web":
        text += ("The visitor requested no automatic navigation. Stay on the current page unless they explicitly ask to open a destination. "
                 if turn.data.get("auto_navigation") is False else
                 "For an explicit request to show/open a listed page, CALL navigate_site before your spoken response. Do not just promise to open it. ")
        if any(result.get("name") == "navigate_site" and result.get("ok") for result in turn.tool_results):
            text += "The relevant page is now open. ANSWER the visitor's actual question using approved facts; opening the page does not replace that answer. Do not ask what they want to know when they already asked a clear question. "
    draft = active_request(turn)
    if draft and draft.get("status") != "submitted":
        missing = [field for field in draft.get("required_fields", []) if not draft.get("fields", {}).get(field)]
        text += ("ACTIVE ENQUIRY: Save each clearly provided value with set_request_field BEFORE speaking. "
                 "Look in this turn and recent history for details the visitor already provided; do not ask for them again. "
                 "Ask only ONE missing field, not name and phone together. Confirm spelling only when genuinely unclear. "
                 "Use the visitor's expressed purpose as reason/message; a wholesale callback does not require a particular product or quantity. "
                 f"Current missing fields: {', '.join(missing) or 'none'}. ")
        if not missing:
            text += "Call review_request now unless a valid review was already given; after a NEW explicit yes call submit_request. Do not claim submission before tool success. "
    elif requested_request_type(turn.text):
        text += "The visitor wants a team enquiry. CALL start_request before asking for the next field. "
    if re.search(r"first time|where.*start|कहाँ.*शुरू|पहली बार|ક્યાં.*શરૂ|પહેલી વાર", turn.text, re.I):
        text += "Help this new visitor choose a starting point: ask whether this is for personal use, business buying or order support. Do not stop at a greeting or repeat an introduction. "
    return text
