from pathlib import Path
import sys
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from request_collection import extract_request_field, request_collection_prompt, is_request_confirmation


def draft(kind="callback", **fields):
    return {"status": "draft", "request_type": kind, "fields": fields, "next_field": "name", "missing_fields": ["name"]}


@pytest.mark.parametrize("text,field,value", [
    ("My name is Asha Patel.", "name", "Asha Patel"),
    ("मेरा नाम आशा पटेल है।", "name", "आशा पटेल"),
    ("મારું નામ આશા પટેલ છે.", "name", "આશા પટેલ"),
    ("My phone number is 9000000000.", "phone", "9000000000"),
    ("मेरा फोन नंबर ९००००००००० है।", "phone", "९०००००००००"),
    ("મારો ફોન નંબર +૯૧ ૯૦૦૦૦૦૦૦૦૦ છે.", "phone", "+૯૧ ૯૦૦૦૦૦૦૦૦૦"),
])
def test_explicit_fields_in_all_three_languages(text, field, value):
    assert extract_request_field(text, draft()) == (field, value)


@pytest.mark.parametrize("text", ["Asha Patel", "आशा पटेल", "આશા પટેલ", "Mary O’Neil", "Jean-Luc"])
def test_bounded_bare_name(text):
    assert extract_request_field(text, draft()) == ("name", text)


@pytest.mark.parametrize("text", ["What is your name", "Can you repeat", "Yes", "No", "Please call me", "Open products", "Cancel", "I want to buy", "My name is what", "My name is Asha and my phone is 9000000000", "हाँ", "नहीं", "क्या नाम", "મને નથી ખબર", "હા", "ના", "શું કહું", "Thanks", "My name is Asha?", "My phone number is nine zero zero", "My name is 123", "I don't know", "I don’t remember", "मुझे नाम नहीं बताना", "તમે ફરીથી કહો"])
def test_questions_commands_confirmations_and_ambiguous_answers_are_not_names(text):
    assert extract_request_field(text, draft()) is None


def test_next_required_field_recomputed_and_already_known_name_not_asked():
    d = draft(name="Asha Patel", reason="Wholesale enquiry")
    assert extract_request_field("9000 000 000", d) == ("phone", "9000 000 000")
    assert "phone" in request_collection_prompt(d, "en")


@pytest.mark.parametrize("text,expected", [("asha underscore patel at example dot com", "asha_patel@example.com"),
    ("My email is Asha+shop@example.com.", "Asha+shop@example.com"),
    ("मेरा ईमेल asha at example dot com है।", "asha@example.com")])
def test_email_normalization_only_for_literal_latin_address_tokens(text, expected):
    assert extract_request_field(text, draft("contact", name="Asha")) == ("email", expected)


@pytest.mark.parametrize("text", ["asha at example", "आशा एट example dot com", "What email should I use?", "yes", "asha at example dot com and call me"])
def test_ambiguous_email_falls_back(text):
    assert extract_request_field(text, draft("contact", name="Asha")) is None


def test_initial_callback_purpose_is_preserved_verbatim():
    text = "I want your team to call me about buying for my shop."
    assert extract_request_field(text, draft()) == ("reason", text)
    assert extract_request_field(text, draft(reason=text)) is None
    assert extract_request_field("Do not call me about wholesale", draft()) is None


@pytest.mark.parametrize("kind,field,text", [("callback", "reason", "Wholesale quantities for my shop"),
    ("contact", "message", "I need help with a wholesale enquiry."),
    ("callback", "reason", "મારી દુકાન માટે ખરીદી વિશે વાત કરવી છે")])
def test_bare_purpose_only_when_expected(kind, field, text):
    fields = {"name": "Asha", "phone": "+919000000000", "email": "asha@example.com"}
    assert extract_request_field(text, draft(kind, **fields)) == (field, text)


@pytest.mark.parametrize("language", ["en", "hi", "gu"])
def test_prompt_one_missing_field_only_and_none_when_complete(language):
    assert request_collection_prompt(draft(name="Asha"), language)
    assert request_collection_prompt(draft(name="Asha", phone="+919000000000", reason="Wholesale"), language) is None


@pytest.mark.parametrize("text", ["yes", "Yes, please submit it.", "send the request", "हाँ", "हाँ, भेज दीजिए", "હા", "હા, મોકલી દો"])
def test_exact_api_confirmation_forms(text):
    assert is_request_confirmation(text)


@pytest.mark.parametrize("text", ["yes but change my phone", "yes no", "do not send", "हाँ लेकिन नाम बदलें", "હા પણ નંબર બદલો", "okay", "sure", "yes send tomorrow"])
def test_corrections_and_ambiguous_assent_are_not_confirmation(text):
    assert not is_request_confirmation(text)


def test_submitted_or_unknown_request_never_collects():
    assert extract_request_field("Asha", {**draft(), "status": "submitted"}) is None
    assert request_collection_prompt({**draft(), "status": "submitted"}, "en") is None
    assert extract_request_field("Asha", {"request_type": "order"}) is None


@pytest.mark.parametrize("kind,text,field,content", [
    ("contact", "My message is please contact me about buying for my shop.", "message", "please contact me about buying for my shop."),
    ("contact", "My message is can you call me?", "message", "can you call me?"),
    ("callback", "My reason is can you discuss wholesale prices?", "reason", "can you discuss wholesale prices?"),
    ("contact", "मेरा संदेश कृपया मुझे फ़ोन करें।", "message", "कृपया मुझे फ़ोन करें।"),
    ("contact", "મારો સંદેશ કૃપા કરીને મને ફોન કરો.", "message", "કૃપા કરીને મને ફોન કરો."),
])
def test_explicit_message_or_reason_preserves_literal_requests_and_questions(kind, text, field, content):
    assert extract_request_field(text, draft(kind)) == (field, content)


@pytest.mark.parametrize("text", ["Please contact me about buying", "Can you call me?", "What is the price?"])
def test_bare_requests_and_questions_are_not_reinterpreted_as_message(text):
    assert extract_request_field(text, draft("contact", name="Asha", email="asha@example.com")) is None
