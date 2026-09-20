"""Regression checks for opt-in smoke-test acceptance, with no network calls."""
import asyncio
import importlib.util
import sys
import time
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('live_smoke_checks', Path(__file__).with_name('live_smoke.py'))
smoke = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = smoke
spec.loader.exec_module(smoke)


def completed_trace(language='en', reply='Hello. How can I help?'):
    trace = smoke.Trace()
    case = trace.begin(language)
    case['input_stop_at'] = time.monotonic()
    transcript = {'en': 'Hello', 'hi': 'नमस्ते', 'gu': 'નમસ્તે'}[language]
    trace.event({'type': 'user_transcript', 'text': transcript, 'turn_id': 'turn-1'})
    trace.event({'type': 'agent_reply_text', 'text': reply, 'language': language, 'turn_id': 'turn-1'})
    trace.audio(b'\xff\x1f' * 320)
    return trace, case


def test_reply_script_must_match_language_metadata():
    trace, _ = completed_trace('gu', 'This English reply was mislabeled Gujarati.')
    assert not trace.report()['turns'][0]['language_match']


def test_fallback_audio_cannot_hide_pipeline_error():
    trace, case = completed_trace()
    trace.event({'type': 'error', 'message': 'synthetic failure'})
    with pytest.raises(smoke.SmokeFailure, match='pipeline'):
        asyncio.run(trace.first_reply_audio(case, 0.1))
    report = {**trace.report(), 'transport': 'web', 'room_cleanup': True}
    assert not smoke.passed(report, interruption=False)


def test_greeting_errors_before_active_turn_fail_acceptance():
    trace = smoke.Trace()
    trace.event({'type': 'error'})
    assert trace.report()['pipeline_error_count'] == 1
    with pytest.raises(smoke.SmokeFailure, match='pipeline'):
        asyncio.run(trace.settle(0.1))


def test_new_segment_clears_previous_reply_audio_and_timestamp():
    trace, case = completed_trace()
    original = case['transcript_at']
    trace.event({'type': 'user_transcript', 'text': 'Second segment', 'turn_id': 'turn-2'})
    assert case['transcript_at'] >= original
    assert case['transcript_segments'] == 2
    assert 'reply_at' not in case and 'audio_at' not in case


@pytest.mark.parametrize('changes', [
    {'phone_reader_error': 'ValueError'}, {'phone_close_code': 1006},
    {'phone_close_received': False}, {'pipeline_error_count': 1},
])
def test_phone_requires_no_reader_error_and_normal_remote_close(changes):
    trace, _ = completed_trace()
    report = {**trace.report(), 'transport': 'synthetic_smartflo', 'room_cleanup': True,
              'phone_mark_count': 1, 'phone_close_received': True, 'phone_close_code': 1000}
    assert smoke.passed(report, interruption=False)
    report.update(changes)
    assert not smoke.passed(report, interruption=False)
