import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from conversation_controls import (LANGUAGE_ACK, dispatch_schedule_missing, language_only_reply, policy_reply,
                                   trim_unsolicited_followup, correct_spoken_grammar, turn_guidance)


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


@pytest.mark.parametrize("text,language", [
    ("So... Hong. Can we talk in Hindi?", "hi"),
    ("Um, can, can we talk in Hindi?", "hi"),
    ("Okay... please, please switch to English.", "en"),
    ("अच्छा, हिंदी में बात कीजिए।", "hi"),
    ("Hmm, Gujarati ma bolo.", "gu"),
    ("હા, હવે ગુજરાતીમાં વાત કરો.", "gu"),
    ("શું આપણે ગુજરાતી માં વાત કરી શકીએ?", "gu"),
    ("Can we switch to Gujarati?", "gu"),
    ("Hindi me boliye please.", "hi"),
])
def test_hesitation_and_clear_switch_receive_grammatical_finite_ack(text, language):
    assert language_only_reply(text, language) == LANGUAGE_ACK[language]
    if language == "hi":
        assert language_only_reply(text, language) == "हाँ, मैं हिंदी में बात कर सकती हूँ।"


@pytest.mark.parametrize("text", [
    "So, what is the price? Can we talk in Hindi?",
    "So... Hong. Can we talk in Hindi about delivery?",
    "Well, don't speak Hindi", "No, can we talk in Hindi?", "Never speak Hindi",
    "Um, can your team speak Hindi?", "Can I talk to your Hindi team?",
    "My name is Hong. Can we talk in Hindi?", "Can we talk in Hindi or Gujarati?",
    "Can we talk in Hindi and show me products?", "So... Hong sells tablets. Can we talk in Hindi?",
])
def test_filler_handling_does_not_discard_intents_or_negations(text):
    assert language_only_reply(text, "hi") is None


def test_ack_never_confirms_a_different_target_language():
    assert language_only_reply("Please speak English", "hi") is None


@pytest.mark.parametrize("draft,expected", [
    ("हाँ, बिल्कुल! हम हिंदी में बात कर सकती हूँ।", "हाँ, बिल्कुल! हम हिंदी में बात कर सकते हैं।"),
    ("मैं हिंदी में बात कर सकता हूँ।", "मैं हिंदी में बात कर सकती हूँ।"),
    ("मैं आपकी मदद कर सकते हैं।", "मैं आपकी मदद कर सकती हूँ।"),
    ("मोरिंगा की मुख्य फायदे इम्यूनिटी, ऊर्जा और पाचन में मदद करना है।", "मोरिंगा इम्यूनिटी, ऊर्जा और पाचन में मदद करता है।"),
    ("Moringa के फायदे immunity और digestion में मदद करना है।", "Moringa immunity और digestion में मदद करता है।"),
])
def test_narrow_agreement_fixes_preserve_claim_words(draft, expected):
    assert correct_spoken_grammar(draft, "hi") == expected
    assert correct_spoken_grammar(expected, "hi") == expected


@pytest.mark.parametrize("draft", [
    "मैं मदद नहीं कर सकता हूँ।", "शायद हम हिंदी में बात कर सकती हूँ।",
    'आपने कहा "मैं हिंदी में बात कर सकता हूँ"।', "उन्होंने कहा 'मैं मदद कर सकता हूँ'।",
    "मोरिंगा की मुख्य फायदे केवल पाचन में मदद करना है।",
    "मोरिंगा की मुख्य फायदे 2 दिन में मदद करना है।",
    "मोरिंगा की मुख्य फायदे पाचन में मदद करना है। इसका price ₹500 है।",
    "मोरिंगा tablets की मुख्य फायदे पाचन में मदद करना है।",
    "Each tablet contains 500 mg of Moringa Leaf.",
    "इसमें 500 mg Moringa leaf है। Product label देखें।",
    "Earthora Farms आपको प्राकृतिक मोरिंगा उत्पादों से स्वास्थ्य और सुखदवस्था के लिए मदद करता है।",
])
def test_correction_does_not_rewrite_quotes_caveats_amounts_or_arbitrary_prose(draft):
    assert correct_spoken_grammar(draft, "hi") == draft


def test_other_languages_and_late_prompt_keep_own_contract():
    wrong = "मैं मदद कर सकता हूँ।"
    assert correct_spoken_grammar(wrong, "en") == wrong
    assert correct_spoken_grammar(wrong, "gu") == wrong
    guidance = turn_guidance("मोरिंगा के क्या फायदे हैं?", "hi", [])
    assert "मैं मदद कर सकती हूँ" in guidance and "के फायदे हैं" in guidance
    assert "technical English" in guidance


def test_observed_compound_story_offer_does_not_replace_grounded_answer():
    from sunpath_runtime import TurnState, knowledge_issue, select_knowledge, validate_reply
    question = "Open our story page and tell me how Earthora helps me"
    answer = "The Our Story page is open. Earthora helps you by growing 100% organic Moringa in Ooty with zero additives, fair wages for our partners, and shade-drying to keep nutrients high."
    draft = answer + " Would you like to know more about the health benefits or see our products?"
    state = TurnState("synthetic", "en", question, 1, {"catalog": [], "knowledge": [{
        "title": "Earthora Farms - Our Story and Farm",
        "text": "Earthora Farms cultivates organic Moringa oleifera on high-altitude volcanic-ash soil in Ooty, Tamil Nadu. Principles: 100% organic soil enriched with volcanic ash; shade-drying in UV-protected chambers to preserve chlorophyll and enzymes; zero additives (no binders, fillers, preservatives); direct trade with fair wages for Ooty partners.",
    }]})
    state.visible_knowledge = select_knowledge(state)
    assert knowledge_issue(state, draft) == "missing-knowledge"
    trimmed = trim_unsolicited_followup(draft, question)
    assert trimmed == answer
    assert validate_reply(trimmed, state) is None
    # A real ungrounded benefit assertion is still rejected after trimming.
    unsupported = "Earthora supports immunity. Would you like to hear more about the benefits?"
    assert validate_reply(trim_unsolicited_followup(unsupported, question), state) == "missing-knowledge"


@pytest.mark.parametrize("reply,question", [
    ("Would you like to know about health benefits or products?", "Tell me about Earthora"),
    ("I don't have confirmed Earthora information. Would you like to see products?", "Tell me about Earthora"),
    ("Which Earthora company do you mean? Would you like to see products?", "Tell me about Earthora"),
    ("Earthora grows Moringa. What would you like to know about the farm?", "Tell me about Earthora"),
    ("Earthora has your details. Would you like me to submit the request?", "Tell Earthora about my enquiry"),
    ("Earthora grows Moringa. Would you like to see our products?", "I want to buy products from Earthora"),
])
def test_company_offer_trim_preserves_sole_questions_clarifications_and_requests(reply, question):
    assert trim_unsolicited_followup(reply, question) == reply
