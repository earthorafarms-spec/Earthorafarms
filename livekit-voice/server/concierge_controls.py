"""Small intent/state controls for explicit website and enquiry actions.

These choose existing native tools; they do not execute writes or invent facts.
"""
import re


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


def active_request(turn) -> dict | None:
    for result in reversed(turn.tool_results):
        data = result.get("data")
        if result.get("ok") and isinstance(data, dict) and data.get("request_type") and data.get("fields") is not None:
            return data
    return next((draft for draft in turn.data.get("request_drafts", []) if draft.get("status") == "draft"), None)


def concierge_guidance(turn) -> str:
    text = ""
    if turn.data.get("channel") == "web":
        text += "For an explicit request to show/open a listed page, CALL navigate_site before your spoken response. Do not just promise to open it. "
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
