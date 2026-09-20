"""Offline checks that the opt-in lifecycle runner rejects false positives."""
import base64
import asyncio
import json
import wave
from types import SimpleNamespace

import live_sunpath_lifecycle as lifecycle
from live_sunpath_lifecycle import LifecycleTrace, save_synthetic_closing, token_room_matches


def trace_for_silence():
    trace = LifecycleTrace()
    trace.started = 100
    trace.stages = [
        {'kind': 'greeting', 'text_at': 101, 'first_audio_at': 103, 'last_audio_at': 106, 'turn_id': None, 'pcm': bytearray()},
        {'kind': 'away', 'text_at': 116, 'first_audio_at': 118, 'last_audio_at': 119, 'turn_id': None, 'pcm': bytearray()},
        {'kind': 'closing', 'text_at': 129, 'first_audio_at': 131, 'last_audio_at': 134, 'audible_samples': 32000, 'turn_id': None, 'pcm': bytearray()},
    ]
    trace.generation_count = 3
    trace.end = {'at': 134.1, 'reason': 'silence'}
    return trace


def test_silence_requires_audible_prompt_then_full_grace():
    trace = trace_for_silence()
    assert all(trace.report('silence', grace_seconds=10)['checks'].values())
    trace.stages[-1]['text_at'] = 126  # Ten seconds after text, seven after audio.
    result = trace.report('silence', grace_seconds=10)
    assert result['away_audio_end_to_closing_text_seconds'] == 7
    assert not result['checks']['grace_after_audible_prompt']


def test_pipeline_failure_cannot_be_replaced_by_audible_apology():
    trace = trace_for_silence()
    trace.pipeline_errors = 1
    assert not trace.report('silence', grace_seconds=10)['checks']['no_pipeline_or_reader_errors']
    trace.pipeline_errors = 0
    trace.reader_errors = 1
    assert not trace.report('silence', grace_seconds=10)['checks']['no_pipeline_or_reader_errors']


def test_text_only_or_early_terminal_event_cannot_pass():
    trace = trace_for_silence()
    trace.end['at'] = 131.1
    assert not trace.report('silence', grace_seconds=10)['checks']['closing_audio_before_call_end']
    trace.stages[-1].pop('first_audio_at')
    trace.stages[-1].pop('last_audio_at')
    result = trace.report('silence', grace_seconds=10)
    assert not result['checks']['all_fixed_speech_audible']
    assert not result['checks']['closing_audio_before_call_end']


def test_farewell_requires_matching_transcript_turn_and_native_reason():
    trace = trace_for_silence()
    trace.stages.pop(1)
    trace.stages[-1]['turn_id'] = 'synthetic-turn'
    trace.end['reason'] = 'farewell'
    trace.transcripts = [{'at': 125, 'turn_id': 'synthetic-turn', 'farewell': True}]
    assert all(trace.report('farewell', grace_seconds=10)['checks'].values())
    trace.transcripts[0]['turn_id'] = 'old-turn'
    assert not trace.report('farewell', grace_seconds=10)['checks']['recognized_farewell_correlated_to_closing']
    trace.end['reason'] = 'silence'
    assert not trace.report('farewell', grace_seconds=10)['checks']['native_close_reason']


def test_room_scoped_token_does_not_require_duplicate_dispatch_configuration():
    payload = base64.urlsafe_b64encode(json.dumps({'video': {'room': 'earthora-synthetic'}}).encode()).decode().rstrip('=')
    token = 'unused.' + payload + '.unused'
    assert token_room_matches(token, 'earthora-synthetic')
    assert not token_room_matches(token, 'earthora-other')
    assert not token_room_matches('invalid', 'earthora-synthetic')


def test_one_closing_frame_and_correct_native_reason_still_fail():
    trace = trace_for_silence()
    trace.stages.pop(1)
    trace.stages[-1].update(turn_id='t', first_audio_at=131, last_audio_at=131.02, audible_samples=320)
    trace.end = {'at': 131.03, 'reason': 'farewell'}
    trace.transcripts = [{'at': 128, 'turn_id': 't', 'farewell': True}]
    result = trace.report('farewell', grace_seconds=10)
    assert result['checks']['native_close_reason']
    assert result['checks']['recognized_farewell_correlated_to_closing']
    assert not result['checks']['closing_audio_coverage']


def test_farewell_closing_must_cover_captured_fixed_reference():
    trace = trace_for_silence()
    result = trace.report('silence', grace_seconds=10, reference_closing={'span_seconds': 5, 'audible_seconds': 4})
    assert not result['checks']['closing_audio_coverage']


def test_admission_metadata_mismatch_never_connects_or_deletes_room(monkeypatch):
    calls = {'room_lists': 0, 'connect': 0, 'delete': 0}

    class Client:
        def __init__(self): self.room = self
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def list_rooms(self, request):
            calls['room_lists'] += 1
            return SimpleNamespace(rooms=[] if calls['room_lists'] == 1 else [SimpleNamespace(
                name='earthora-other-call', metadata=json.dumps({'session_id': 'another-customer', 'channel': 'web', 'channel_key': 'test'}))])

    class Response:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def json(self): return {'room_name': 'earthora-other-call', 'token': 'irrelevant', 'url': 'wss://example.invalid'}

    class Http:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def post(self, *args, **kwargs): return Response()

    class Observer:
        def __init__(self, *args, **kwargs): pass
        async def connect(self, *args): calls['connect'] += 1
        async def close(self): pass

    async def delete(room): calls['delete'] += 1

    monkeypatch.setenv('VOICE_TEST_CHANNEL_KEY', 'test')
    monkeypatch.setattr(lifecycle.smoke, 'api', SimpleNamespace(ListRoomsRequest=lambda **kw: kw), raising=False)
    monkeypatch.setattr(lifecycle.smoke, 'configured_api', Client)
    monkeypatch.setattr(lifecycle.smoke, 'delete_owned_room', delete)
    monkeypatch.setattr(lifecycle.aiohttp, 'ClientSession', Http)
    monkeypatch.setattr(lifecycle, 'LifecycleObserver', Observer)
    args = SimpleNamespace(api_url='http://example.invalid', livekit_connect_url=None, grace_seconds=10)
    report, _ = asyncio.run(lifecycle.lifecycle_case(args, 'silence'))
    assert not report['passed']
    assert 'ownership' in report['failure']
    assert calls == {'room_lists': 2, 'connect': 0, 'delete': 0}


def test_captured_farewell_excludes_long_leading_and_trailing_silence(tmp_path):
    trace = trace_for_silence()
    trace.stages[-1]['pcm'] = bytearray(b'\0\0' * 32000 + b'\xff\x0f' * 16000 + b'\0\0' * 32000)
    path = tmp_path / 'own-synthetic-farewell.wav'
    manifest = save_synthetic_closing(trace, path)
    assert manifest['seconds'] == 1.4
    assert 'this run' in manifest['provenance']
    with wave.open(str(path), 'rb') as wav:
        assert wav.getframerate() == 16000
        assert wav.getnchannels() == 1
