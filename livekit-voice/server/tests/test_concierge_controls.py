import sys
from pathlib import Path
from types import SimpleNamespace
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from concierge_controls import (requested_destination, contextual_destination, navigation_preference,
                                requested_request_type, concierge_guidance, navigation_needs_answer)
from sunpath_runtime import normalize_spoken, bounded_reply

GUIDE = [{'id':name} for name in ['products','our_story','contact','contact_form','faq']]

@pytest.mark.parametrize('text,destination', [
    ('Show me your products section','products'),
    ('मुझे products दिखाइए','products'),
    ('મને તમારી કંપનીની story વાળું page બતાવો.','our_story'),
    ('Open the contact form','contact_form'),
    ('Do not open the products section',None),
    ('products मत दिखाना',None),
    ('Show me admin credentials',None),
    ('What are your products?',None),
    ('Show me products and our story',None),
])
def test_explicit_navigation_only_uses_an_unambiguous_public_destination(text,destination):
    assert requested_destination(text,GUIDE)==destination

@pytest.mark.parametrize('text,kind',[
    ('I want your team to call me about buying for my shop.','callback'),
    ('Can you help me send a wholesale enquiry to your team?','contact'),
    ('मुझे wholesale enquiry करनी है।','contact'),
    ('મને ફોન કરો','callback'),
    ('Do not call me',None),
    ('How do I use tablets?',None),
])
def test_only_explicit_team_request_starts_a_draft(text,kind):
    assert requested_request_type(text)==kind

def test_draft_guidance_remembers_existing_fields_and_requires_saving_before_speech():
    turn=SimpleNamespace(text='My name is Asha',tool_results=[],data={'request_drafts':[{
        'status':'draft','request_type':'callback','required_fields':['name','phone','reason'],
        'fields':{'phone':'+919000000000','reason':'wholesale enquiry'}}]})
    guidance=concierge_guidance(turn)
    assert 'Current missing fields: name.' in guidance
    assert 'BEFORE speaking' in guidance and 'do not ask for them again' in guidance

def test_review_email_keeps_underscore_and_short_greeting_does_not_cut_off_next_step():
    assert normalize_spoken('Your email is jane_doe@example.com.')=='Your email is jane_doe@example.com.'
    assert bounded_reply('Hello! I can help you explore the products. Is this for yourself or a business?')=='I can help you explore the products. Is this for yourself or a business?'


CONTENT_GUIDE = GUIDE + [{'id':key} for key in ['health_benefits','shipping_policy','privacy_policy','product:current']]

@pytest.mark.parametrize('text,expected', [
    ('what is mooringa', 'products'),
    ('आजा तो आप मुझे बताएं अर्थोरा कैसे हेल्प कर सकता है', 'our_story'),
    ('अब मुझे So, what benefits are the kind?', 'health_benefits'),
    ('મોરિંગા ના ફાયદા શું છે?', 'health_benefits'),
    ('इस product में क्या है?', 'product:current'),
    ('તમારા product માં શું છે?', 'product:current'),
    ('What is your shipping policy?', 'shipping_policy'),
    ('Where is my order? My order number is 1234.', None),
    ('My message is I want to discuss benefits', None),
    ('I want your team to call me about the benefits', None),
    ('Do not show the benefits page', None),
    ('benefits मत दिखाना', None),
    ('લાભ બતાવો નહીં', None),
    ('What is the dosage for my child?', None),
    ('My phone number is 9000000000', None),
])
def test_relevant_content_opens_for_questions_without_explicit_navigation_command(text,expected):
    assert contextual_destination(text,CONTENT_GUIDE)==expected

def test_contextual_navigation_uses_manifest_and_does_not_repeat_current_destination():
    assert contextual_destination('What are the benefits?',CONTENT_GUIDE,current='health_benefits') is None
    assert contextual_destination('What are the benefits?',GUIDE) is None
    assert contextual_destination('What are the ingredients?',CONTENT_GUIDE+[{'id':'product:second'}])=='products'

def test_explicit_auto_navigation_preference_is_separate_from_topic_negation():
    assert navigation_preference('Do not change the page') is False
    assert navigation_preference('Please guide me through the website') is True
    assert navigation_preference('I do not know the benefits') is None


@pytest.mark.parametrize('text', [
    'How should I take Earthora Moringa tablets?', 'What dosage should I take?',
    'How many tablets should my child take?', 'मोरिंगा tablet कैसे लेना चाहिए?',
    'મોરિંગા ગોળી ક્યારે લેવી જોઈએ?', 'मेरे cart में क्या है?', 'મારા કાર્ટમાં શું છે?',
    'What ingredients are in the tablets in my cart?', 'How does Earthora help me log in?',
    'Explain my account privacy settings', 'How is my order shipping?',
    'मेरे ऑर्डर की डिलीवरी कब होगी?', 'મારા ઓર્ડરની ડિલિવરી ક્યારે થશે?',
    'Order number 1234 shipping details', 'Can you explain my payment invoice?',
])
def test_personal_actions_cart_order_and_usage_do_not_change_public_page(text):
    assert contextual_destination(text, CONTENT_GUIDE) is None


@pytest.mark.parametrize('text,expected', [
    ('What is in this product?', None),  # Unrecognized English paraphrase stays conversational.
    ('What ingredients does this contain?', 'product:current'),
    ('How long does shipping take for orders?', 'shipping_policy'),
    ('What is the privacy policy?', 'privacy_policy'),
    ('How can your company help me?', 'our_story'),
    ('મોરિંગા ના ફાયદા શું છે?', 'health_benefits'),
])
def test_personal_action_exclusions_keep_general_content_questions(text, expected):
    assert contextual_destination(text, CONTENT_GUIDE) == expected


@pytest.mark.parametrize('text', [
    'પેજ બદલશો નહીં', 'પેજ બદલતા નહીં', 'આ પેજ ન બદલો', 'પેજ ન ખોલો',
    'સ્ક્રોલ કરશો નહીં', 'पेज बदलना मत', 'पेज न बदलें', 'स्क्रीन नहीं बदलना',
    'पेज खोलना मत',
])
def test_explicit_local_language_opt_out_is_obeyed(text):
    assert navigation_preference(text) is False
    assert contextual_destination(text + ' benefits', CONTENT_GUIDE) is None


@pytest.mark.parametrize('text', ['मुझे फायदे नहीं पता', 'મને ફાયદા ખબર નથી', 'What changes on the page?', 'પેજ બદલશો'])
def test_topic_uncertainty_or_positive_statement_does_not_disable_navigation(text):
    assert navigation_preference(text) is None


@pytest.mark.parametrize('text', [
    'Open our story page and tell me how Earthora helps me.',
    'Show benefits and explain which ones are approved.',
    'Open the page and describe the company.',
    'Show me what the products contain.',
    'Story पेज खोलिए और बताइए Earthora कैसे मदद करता है।',
    'Benefits दिखाइए और समझाइए।',
    'Story page ખોલો અને સમજાવો.',
    'પેજ બતાવો અને કહો કે કંપની શું કરે છે.',
])
def test_opening_plus_substantive_question_still_needs_answer(text):
    assert navigation_needs_answer(text)


@pytest.mark.parametrize('text', [
    'Can you show me the products page?', 'Could you please open our story?',
    'Please open the benefits page', 'क्या आप story पेज खोल सकते हैं?',
    'શું તમે story page ખોલી શકો છો?', 'મને products બતાવો',
])
def test_permission_only_opening_is_not_an_extra_question(text):
    assert not navigation_needs_answer(text)
