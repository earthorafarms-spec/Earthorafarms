import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from conversation_controls import LANGUAGE_ACK, dispatch_schedule_missing, language_only_reply, policy_reply, trim_unsolicited_followup


@pytest.mark.parametrize("text,language", [
    ("Can you speak Gujarati?", "gu"), ("Then I speak Hindi.", "hi"),
    ("Please switch to English", "en"), ("Hindi please", "hi"),
    ("क्या आप गुजराती बोल सकती हैं?", "gu"), ("हिंदी में बोलिए", "hi"),
    ("તમે ગુજરાતી બોલી શકો છો?", "gu"),
])
def test_language_ack_has_no_product_pitch(text, language):
    assert language_only_reply(text, language) == LANGUAGE_ACK[language]


@pytest.mark.parametrize("text", [
    "Does your Hindi-speaking team dispatch daily?",
    "Please speak Gujarati about your products",
    "Can you speak Hindi and tell me the price?",
    "Do not speak Hindi", "What does Hindi mean?", "I do not speak Hindi",
    "Can your team speak Gujarati?", "मैं हिंदी में product की कीमत पूछना चाहता हूँ", "કૃપા કરીને",
])
def test_business_questions_and_negations_are_not_swallowed(text):
    assert language_only_reply(text, "hi") is None


def test_transit_time_and_alerts_cannot_establish_dispatch_calendar():
    knowledge = [{"text": "Free shipping. Delivery takes 7–14 business days. Dispatch tracking alerts are sent."}]
    assert dispatch_schedule_missing("Do you dispatch daily?", knowledge)
    assert dispatch_schedule_missing("क्या आप रोज़ dispatch करते हैं?", knowledge)
    assert not dispatch_schedule_missing("How long does delivery take?", knowledge)


def test_explicit_calendar_stays_available_for_model_answer():
    assert not dispatch_schedule_missing("Do you dispatch daily?", [{"text": "Orders are dispatched Monday to Saturday."}])
    assert not dispatch_schedule_missing("When do orders dispatch?", [{"text": "Orders placed before 2 PM dispatch the same business day."}])


def test_question_is_not_dispatch_schedule_evidence():
    assert dispatch_schedule_missing("Do you dispatch daily?", [{"text": "Q: Do you dispatch daily? A: Please contact our team."}])


def test_only_appended_question_is_removed_from_complete_ingredient_answer():
    reply = "Each tablet contains Moringa leaf. Would you like to buy some?"
    assert trim_unsolicited_followup(reply, "What are the ingredients?") == "Each tablet contains Moringa leaf."
    assert trim_unsolicited_followup(reply, "I want to buy this") == reply
    uncertain = "I'm not sure which product you mean. Which product?"
    assert trim_unsolicited_followup(uncertain, "What ingredients?") == uncertain
    assert trim_unsolicited_followup("Which product do you mean?", "What ingredients?") == "Which product do you mean?"


def test_standalone_policy_questions_do_not_require_product_inference():
    assert policy_reply("What is orthora?", "en") == "Do you mean Earthora Farms?"
    assert policy_reply("What is Earthora?", "en") is None
    assert "not a treatment or cure" in policy_reply("Can it cure diabetes?", "en")
    assert "Never share" in policy_reply("Should I tell you my OTP?", "en")
    for text in ("Can it cure diabetes and what is the price?", "I never share OTP; how much is this?",
                 "Should I tell you my address?", "What does cure mean?", "Can you cure this typo?"):
        assert policy_reply(text, "en") is None


def test_factual_benefit_answer_does_not_append_an_unneeded_product_question():
    reply = "These tablets support digestion. Which product do you mean?"
    assert trim_unsolicited_followup(reply, "What are the benefits?") == "These tablets support digestion."
    assert trim_unsolicited_followup(reply, "How much are they?") == reply


@pytest.mark.parametrize("language,question", [
    ("en", "How many tablets should my child take?"),
    ("en", "What dosage for my son?"),
    ("hi", "मेरे बेटे को कितनी गोली लेना चाहिए?"),
    ("hi", "मुझे शुगर है, कितनी गोली लें?"),
    ("gu", "મારા દીકરાને કેટલી ગોળી લેવી જોઈએ?"),
    ("gu", "મને શુગર છે, કેટલી ગોળી લેવી જોઈએ?"),
])
def test_personal_dose_question_gets_brief_label_and_clinician_advice(language, question):
    reply = policy_reply(question, language)
    assert reply and "label" in reply and "doctor" in reply
    assert not any(character.isdigit() for character in reply)
    assert len(reply.split()) <= 70


@pytest.mark.parametrize("question", [
    "What is the general label dosage?", "My father asked what the label dosage says.",
    "How should I take these tablets?", "What dosage for my child and what is the price?",
    "मेरे बेटे को कितनी गोली दें और इसकी कीमत क्या है?",
    "મારા દીકરાને કેટલી ગોળી આપું અને તેના ઘટકો શું છે?",
    "Is it suitable for children?",
])
def test_personal_dose_control_preserves_general_facts_and_compound_requests(question):
    assert policy_reply(question, "en") is None
