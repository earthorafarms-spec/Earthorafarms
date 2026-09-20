import asyncio
import base64
import importlib.util
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER))


class FakeSource:
    def __init__(self, *args, **kwargs):
        self.frames = []
        self.closed = False

    async def capture_frame(self, frame):
        self.frames.append(frame)

    async def aclose(self):
        self.closed = True


class FakeRoom:
    def __init__(self):
        self.handlers = {}
        self.publications = []
        async def publish_track(track, options):
            self.publications.append((track, options))
        self.local_participant = SimpleNamespace(publish_track=publish_track)

    def on(self, event):
        def register(fn):
            self.handlers[event] = fn
            return fn
        return register

    async def connect(self, url, token):
        self.connection = (url, token)

    async def disconnect(self):
        self.disconnected = True


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.close_codes = []
        self.on_send = None

    async def send_json(self, value):
        self.sent.append(value)
        if self.on_send:
            self.on_send(value)

    async def close(self, code=1000):
        self.close_codes.append(code)


@pytest.fixture
def control(monkeypatch):
    for key, value in {
        'EARTHORA_VOICE_INTERNAL_KEY': 'test-internal-key',
        'LIVEKIT_URL': 'ws://127.0.0.1:7880',
        'LIVEKIT_PUBLIC_URL': 'wss://voice.example.test',
        'LIVEKIT_API_KEY': 'test-api-key',
        'LIVEKIT_API_SECRET': 'this-is-only-a-32-character-test-secret',
        'EARTHORA_API_URL': 'http://127.0.0.1:4100',
        'EARTHORA_PUBLIC_ORIGIN': 'https://voice.example.test',
        'VOICE_MAX_SESSIONS': '2',
        'VOICE_AGENT_NAME': 'earthora-sunpath',
    }.items():
        monkeypatch.setenv(key, value)
    import livekit
    fake_rtc = SimpleNamespace(Room=FakeRoom, AudioSource=FakeSource, AudioFrame=lambda **kw: SimpleNamespace(**kw),
                               TrackKind=SimpleNamespace(KIND_AUDIO='audio'), TrackSource=SimpleNamespace(SOURCE_MICROPHONE='microphone'),
                               LocalAudioTrack=SimpleNamespace(create_audio_track=lambda name, source: SimpleNamespace(name=name, source=source)),
                               TrackPublishOptions=lambda **kw: SimpleNamespace(**kw))
    monkeypatch.setattr(livekit, 'rtc', fake_rtc, raising=False)
    monkeypatch.setitem(sys.modules, 'livekit.rtc', fake_rtc)
    name = '_earthora_control_tests'
    spec = importlib.util.spec_from_file_location(name, SERVER / 'earthora_control.py')
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


def test_start_rejects_unknown_channel_before_creating_room(control):
    request = control.StartRequest(access_key='test-internal-key', metadata={'session_id': 's', 'channel_key': 'k', 'channel': 'whatsapp'})
    with pytest.raises(HTTPException) as error:
        asyncio.run(control.start_session(request))
    assert error.value.status_code == 400


def test_room_admission_serializes_concurrent_requests(control, monkeypatch):
    rooms = []

    class Rooms:
        async def list_rooms(self, request):
            await asyncio.sleep(0)
            return SimpleNamespace(rooms=rooms.copy())

        async def create_room(self, request):
            rooms.append(SimpleNamespace(name=request.name, num_participants=0, creation_time=time.time()))
            assert request.max_participants == 3
            assert request.empty_timeout == 45
            assert request.departure_timeout == 10
            assert [agent.agent_name for agent in request.agents] == ['earthora-sunpath']
            metadata = json.loads(request.metadata)
            assert metadata['caller_identity'].startswith(metadata['channel'] + '-')
            rooms[-1].caller_identity = metadata['caller_identity']

    class Client:
        room = Rooms()
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass

    monkeypatch.setattr(control, 'lk_api', Client)
    async def exercise():
        request = control.StartRequest(access_key='test-internal-key', metadata={'session_id': 's', 'channel_key': 'k'})
        results = await asyncio.gather(*(control.start_session(request) for _ in range(3)), return_exceptions=True)
        assert sum(isinstance(result, dict) for result in results) == 2
        session = next(result for result in results if isinstance(result, dict))
        payload = session['token'].split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        assert 'roomConfig' not in claims  # Admission already created/dispatched the room.
        assert claims['sub'] in [room.caller_identity for room in rooms]
        errors = [result for result in results if isinstance(result, HTTPException)]
        assert len(errors) == 1 and errors[0].status_code == 429
    asyncio.run(exercise())
    assert len(rooms) == 2


def test_untrusted_access_key_cannot_mint_room(control):
    request = control.StartRequest(access_key='wrong', metadata={'session_id': 's', 'channel_key': 'k'})
    with pytest.raises(HTTPException) as error:
        asyncio.run(control.start_session(request))
    assert error.value.status_code == 401


def test_mulaw_input_is_resampled_to_mono_16khz(control):
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        bridge.stream_sid = 'stream-1'
        await bridge.inbound({'streamSid': 'stream-1', 'media': {'payload': base64.b64encode(b'\xff' * 160).decode()}})
        frame = bridge.source.frames[0]
        assert frame.sample_rate == 16000 and frame.num_channels == 1
        assert len(frame.data) == frame.samples_per_channel * 2
        assert frame.data == b'\0' * len(frame.data)
        await bridge.inbound({'media': {'track': 'outbound', 'payload': base64.b64encode(b'\xff' * 160).decode()}})
        assert len(bridge.source.frames) == 1
        with pytest.raises(ValueError):
            await bridge.inbound({'streamSid': 'different', 'media': {'payload': '////'}})
    asyncio.run(exercise())


def test_clear_prevents_a_paced_old_frame_from_following_clear(control):
    async def exercise():
        ws = FakeWebSocket()
        bridge = control.PhoneBridge(ws)
        bridge.stream_sid = 'stream-1'
        bridge.next_audio_at = time.monotonic() + 0.03
        stale = asyncio.create_task(bridge.send_audio(b'\xff' * 160, bridge.audio_epoch))
        await asyncio.sleep(0)
        await bridge.clear()
        assert await stale is False
        assert [event['event'] for event in ws.sent] == ['clear']
    asyncio.run(exercise())


def test_outbound_frames_are_20ms_mulaw_with_pacing(control, monkeypatch):
    clock = [10.0]
    delays = []
    monkeypatch.setattr(control.time, 'monotonic', lambda: clock[0])

    async def sleep(delay):
        delays.append(delay)
        clock[0] += delay

    monkeypatch.setattr(control.asyncio, 'sleep', sleep)

    class Stream:
        def __init__(self, track, **kw):
            assert kw == {'sample_rate': 8000, 'num_channels': 1}
        def __aiter__(self):
            async def events():
                yield SimpleNamespace(frame=SimpleNamespace(data=b'\xe8\x03' * 320))
            return events()
        async def aclose(self): pass

    monkeypatch.setattr(control.rtc, 'AudioStream', Stream, raising=False)
    async def exercise():
        ws = FakeWebSocket()
        bridge = control.PhoneBridge(ws)
        bridge.stream_sid = 'stream-1'
        await bridge.outbound(object())
        assert len(ws.sent) == 2
        assert all(len(base64.b64decode(event['media']['payload'])) == 160 for event in ws.sent)
        assert sum(delays) == pytest.approx(0.02)
        assert [event['media']['chunk'] for event in ws.sent] == ['1', '2']
    asyncio.run(exercise())


def test_call_end_flushes_residual_and_waits_for_matching_mark(control):
    async def exercise():
        ws = FakeWebSocket()
        bridge = control.PhoneBridge(ws)
        bridge.stream_sid = 'stream-1'
        bridge.pending_audio.extend(b'\x80' * 80)
        def acknowledge(event):
            if event['event'] == 'mark':
                bridge.receive_mark({'mark': {'name': 'wrong'}})
                assert not bridge.mark_received.is_set()
                assert ws.close_codes == []
                bridge.receive_mark(event)
        ws.on_send = acknowledge
        await bridge.finish_playback()
        assert [event['event'] for event in ws.sent] == ['media', 'mark']
        block = base64.b64decode(ws.sent[0]['media']['payload'])
        assert block == b'\x80' * 80 + b'\xff' * 80
        assert ws.close_codes == [1000]
        await bridge.finish_playback()
        assert ws.close_codes == [1000]
    asyncio.run(exercise())


def test_malformed_mulaw_payload_is_rejected(control):
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        bridge.stream_sid = 'stream-1'
        with pytest.raises(ValueError):
            await bridge.inbound({'media': {'payload': 'not base64!'}})
    asyncio.run(exercise())


def test_msh_resolver_contract_keeps_existing_static_media_url(control):
    result = asyncio.run(control.endpoint())
    assert result == {'success': True, 'sucess': True, 'wss_url': 'wss://voice.example.test/ws/voice/smartflo'}


def test_smartflo_100ms_input_preserves_continuous_resampler_state(control):
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        bridge.stream_sid = 'stream-1'
        # A provider's 100 ms frames must remain continuous at the 16 kHz
        # LiveKit microphone; resetting ratecv state loses boundary samples.
        raw = bytes(range(256)) * 3 + bytes(range(32))
        for _ in range(2):
            await bridge.inbound({'media': {'payload': base64.b64encode(raw).decode()}})
        expected, _ = control.audioop.ratecv(control.audioop.ulaw2lin(raw * 2, 2), 2, 1, 8000, 16000, None)
        assert b''.join(frame.data for frame in bridge.source.frames) == expected
        assert all(frame.sample_rate == 16000 for frame in bridge.source.frames)
    asyncio.run(exercise())


@pytest.mark.parametrize('failure_step', [None, 'disconnect', 'source'])
def test_teardown_deletes_only_owned_room_even_if_local_cleanup_fails(control, monkeypatch, failure_step):
    deleted = []
    clients_closed = []

    class Client:
        def __init__(self):
            async def delete_room(request):
                deleted.append(request.room)
            self.room = SimpleNamespace(delete_room=delete_room)
        async def __aenter__(self): return self
        async def __aexit__(self, *args): clients_closed.append(True)

    monkeypatch.setattr(control, 'lk_api', Client)
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        bridge.room_name = 'earthora-owned-test-room'
        task_cancelled = asyncio.Event()
        async def pending_media():
            try:
                await asyncio.Event().wait()
            finally:
                task_cancelled.set()
        task = bridge.spawn(pending_media())
        await asyncio.sleep(0)
        async def fail():
            raise ConnectionError('Synthetic cleanup error')
        if failure_step == 'disconnect': bridge.room.disconnect = fail
        if failure_step == 'source': bridge.source.aclose = fail
        await bridge.close()
        await bridge.close()  # socket disconnect may race call_end
        assert bridge.closed and task.done() and task_cancelled.is_set()
        assert deleted == ['earthora-owned-test-room']
        assert clients_closed == [True]
        if failure_step != 'source': assert bridge.source.closed
    asyncio.run(exercise())


def install_phone_admission(control, monkeypatch, *, status=200):
    class Response:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def json(self):
            return {'room_name': 'earthora-owned-test-room', 'token': 'synthetic-join-token'}
    Response.status = status
    class Http:
        def __init__(self, **kwargs):
            assert kwargs['timeout'].total == 20
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def post(self, url, **kwargs):
            assert url.endswith('/api/platform/voice/internal/session')
            assert kwargs['json']['channel'] == 'phone'
            return Response()
    monkeypatch.setattr(control.aiohttp, 'ClientSession', Http)


def test_agent_admission_timeout_closes_when_worker_has_no_audio_track(control, monkeypatch):
    install_phone_admission(control, monkeypatch)
    monkeypatch.setattr(control, 'AGENT_JOIN_TIMEOUT', 0.01)
    async def exercise():
        ws = FakeWebSocket()
        bridge = control.PhoneBridge(ws)
        await bridge.start({'start': {'streamSid': 's', 'callSid': 'synthetic'}})
        await asyncio.wait_for(asyncio.gather(*tuple(bridge.tasks)), timeout=0.2)
        assert ws.close_codes == [1011]
        assert bridge.room.publications[0][1].source == 'microphone'
    asyncio.run(exercise())


def test_agent_track_arrival_cancels_watchdog_even_before_first_tts_audio(control, monkeypatch):
    install_phone_admission(control, monkeypatch)
    monkeypatch.setattr(control, 'AGENT_JOIN_TIMEOUT', 0.01)
    async def exercise():
        ws = FakeWebSocket()
        bridge = control.PhoneBridge(ws)
        async def no_audio_yet(track):
            return
        bridge.outbound = no_audio_yet
        await bridge.start({'start': {'streamSid': 's', 'callSid': 'synthetic'}})
        bridge.room.handlers['track_subscribed'](SimpleNamespace(kind='audio'), None, None)
        await asyncio.wait_for(asyncio.gather(*tuple(bridge.tasks)), timeout=0.2)
        assert ws.close_codes == []
        assert bridge.agent_audio_ready.is_set()
    asyncio.run(exercise())


def test_livekit_signalling_has_bounded_connect_time(control, monkeypatch):
    install_phone_admission(control, monkeypatch)
    monkeypatch.setattr(control, 'CONNECT_TIMEOUT', 0.01)
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        async def never_connect(*args):
            await asyncio.Event().wait()
        bridge.room.connect = never_connect
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(bridge.start({'start': {'streamSid': 's', 'callSid': 'synthetic'}}), timeout=0.2)
        assert bridge.room_name == 'earthora-owned-test-room'
        assert not bridge.tasks
    asyncio.run(exercise())


def test_phone_admission_rejection_never_joins_livekit(control, monkeypatch):
    install_phone_admission(control, monkeypatch, status=429)
    async def exercise():
        bridge = control.PhoneBridge(FakeWebSocket())
        with pytest.raises(RuntimeError, match='429'):
            await bridge.start({'start': {'streamSid': 's', 'callSid': 'synthetic'}})
        assert not hasattr(bridge.room, 'connection')
        assert bridge.room_name is None
        assert not bridge.tasks
    asyncio.run(exercise())
