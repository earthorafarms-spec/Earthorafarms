import sys
from pathlib import Path
from types import SimpleNamespace
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from concierge_controls import requested_destination, requested_request_type, concierge_guidance
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
