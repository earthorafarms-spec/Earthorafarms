import copy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from request_review import request_review_reply, submitted_request_reply


def review(kind="contact", **fields):
    values = ({"name": "Asha Patel", "email": "asha_patel+shop@example.com", "phone": "", "topic": "Wholesale",
               "message": "Please discuss wholesale quantities for my shop.", "marketingConsent": False}
              if kind == "contact" else {"name": "Asha Patel", "phone": "+919000000000", "reason": "Discuss buying for my shop."})
    values.update(fields)
    return {"ok": True, "data": {"request_id": "synthetic-request", "request_type": kind, "status": "draft",
                                 "fields": values, "confirmation_token": "a" * 48}}


@pytest.mark.parametrize("language", ["en", "hi", "gu"])
def test_complete_exact_contact_review_asks_confirmation(language):
    result = review()
    before = copy.deepcopy(result)
    spoken = request_review_reply(result, language)
    assert spoken.ready_for_confirmation and spoken.request_id == "synthetic-request"
    assert "Asha Patel" in spoken.text and "Please discuss wholesale quantities for my shop." in spoken.text
    assert "asha underscore patel plus shop at example dot com" in spoken.text
    assert "Wholesale" in spoken.text and "Marketing updates" in spoken.text
    assert spoken.text.endswith("?") and len(spoken.text.split()) <= 70
    assert "a" * 48 not in spoken.text and result == before


@pytest.mark.parametrize("language,expected", [("en", "plus nine one nine zero zero zero zero zero zero zero zero zero"),
    ("hi", "प्लस नौ एक नौ शून्य शून्य शून्य शून्य शून्य शून्य शून्य शून्य शून्य"),
    ("gu", "પ્લસ નવ એક નવ શૂન્ય શૂન્ય શૂન્ય શૂન્ય શૂન્ય શૂન્ય શૂન્ય શૂન્ય શૂન્ય")])
def test_callback_reads_each_phone_digit_and_exact_reason(language, expected):
    spoken = request_review_reply(review("callback"), language)
    assert spoken.ready_for_confirmation and expected in spoken.text
    assert "Discuss buying for my shop." in spoken.text


@pytest.mark.parametrize("language", ["en", "hi", "gu"])
def test_full_long_message_is_never_silently_truncated_or_confirmed(language):
    spoken = request_review_reply(review(message="A long exact customer message. " * 30), language)
    assert not spoken.ready_for_confirmation and "?" not in spoken.text
    assert "A long exact" not in spoken.text
    assert len(spoken.text.split()) <= 70


def test_character_limit_applies_without_word_boundaries():
    assert not request_review_reply(review(message="x" * 1200), "en").ready_for_confirmation


@pytest.mark.parametrize("patch", [{"ok": False}, {"data": {}}, {"ok": "true"}])
def test_failed_incomplete_results_do_not_narrate(patch):
    result = review()
    result.update(patch)
    assert request_review_reply(result, "en") is None


@pytest.mark.parametrize("field,value", [("confirmation_token", "bad"), ("status", "submitted"), ("request_type", "order")])
def test_wrong_review_state_is_not_confirmation(field, value):
    result = review()
    result["data"][field] = value
    assert request_review_reply(result, "en") is None


@pytest.mark.parametrize("fields", [{"email": "asha"}, {"phone": "9000000000"}, {"marketingConsent": "false"},
                                     {"message": ""}, {"name": "Asha\x00Patel"}, {"unknown": "must not omit me"}])
def test_invalid_or_unknown_fields_cannot_be_omitted(fields):
    assert request_review_reply(review(**fields), "en") is None


@pytest.mark.parametrize("consent,expected", [(True, "Marketing updates: yes"), (False, "Marketing updates: no")])
def test_consent_matches_exact_boolean(consent, expected):
    assert expected in request_review_reply(review(marketingConsent=consent), "en").text


def test_email_preserves_case_digits_and_every_meaningful_separator():
    text = request_review_reply(review(email="A_b-2+shop@example.co.in"), "en").text
    assert "A underscore b hyphen two plus shop at example dot co dot in" in text


def test_spoken_native_digits_phone_has_same_numeric_identity():
    a = request_review_reply(review("callback", phone="+૯૧૯૦૦૦૦૦૦૦૦૦"), "gu")
    b = request_review_reply(review("callback"), "gu")
    assert a.text == b.text


def receipt(**updates):
    data = {"request_id": "synthetic-request", "request_type": "callback", "recorded": True,
            "notification_queued": True, "notification_status": "queued"}
    data.update(updates)
    return {"ok": True, "data": data}


@pytest.mark.parametrize("language", ["en", "hi", "gu"])
def test_exact_submission_receipt_has_no_delivery_or_time_promise(language):
    text = submitted_request_reply(receipt(), language)
    assert text and len(text.split()) <= 70 and "?" not in text
    assert "delivered" not in text.lower() and "within" not in text.lower()


@pytest.mark.parametrize("updates", [{"recorded": False}, {"recorded": "true"}, {"notification_queued": False},
                                     {"notification_status": "sent"}, {"request_type": "order"}])
def test_failed_or_nonqueued_result_is_not_a_receipt(updates):
    assert submitted_request_reply(receipt(**updates), "en") is None


def test_review_is_not_a_submission_receipt():
    assert submitted_request_reply(review(), "en") is None


def test_unsupported_language_does_not_silently_use_english():
    assert request_review_reply(review(), "te") is None
    assert submitted_request_reply(receipt(), "te") is None
