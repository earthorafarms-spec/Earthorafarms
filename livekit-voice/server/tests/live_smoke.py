"""Opt-in synthetic web/Smartflo smoke test; never dials a phone or buys anything.

Run from an environment with the deployed LiveKit credentials and a public voice
channel key. Example (keys stay in environment, never command arguments):

  python tests/live_smoke.py --wav-dir /opt/voice-smoke/audio --mode both \
      --api-url http://127.0.0.1:4100 --smartflo-url ws://127.0.0.1:7860/ws/voice/smartflo \
      --output /opt/voice-smoke/result.json

Without --livekit-connect-url, the browser case uses the public URL returned by
the application's real admission endpoint, exercising its WebRTC/ICE path.
Phone input follows Smartflo's 100 ms / 800-byte G.711 mu-law framing. An observer
in this test's own room records application events; it publishes no microphone.
The final phone call_end is deliberately injected into only that synthetic room
to exercise playback mark/acknowledgment and transport closure. No checkout or
real provider-call endpoint is invoked. This file is not collected by pytest.
"""
from __future__ import annotations

import argparse
import asyncio
import audioop
import base64
import contextlib
import hashlib
import json
import os
import sys
import time
import uuid
import wave
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import aiohttp

TOPIC = 'earthora.voice'
SAMPLES = {
    'en': ('neha-en.wav', 'Hello. I can help you check your order status.'),
    'hi': ('neha-hi.wav', 'नमस्ते। मैं आपके ऑर्डर की जानकारी दे सकती हूँ।'),
    'gu': ('neha-gu.wav', 'નમસ્તે. હું તમારા ઓર્ડરની માહિતી આપી શકું છું.'),
    'hinglish': ('neha-hinglish.wav', 'नमस्ते! मैं आपका order status check कर सकती हूँ।'),
}


class SmokeFailure(Exception):
    """Only fixed, nonsecret diagnostics are included in the result."""


def pcm_for(path: Path, rate: int) -> tuple[bytes, dict]:
    with wave.open(str(path), 'rb') as wav:
        channels, width, source_rate = wav.getnchannels(), wav.getsampwidth(), wav.getframerate()
        count = wav.getnframes()
        if wav.getcomptype() != 'NONE' or channels not in (1, 2):
            raise SmokeFailure('Input must be mono/stereo uncompressed WAV')
        pcm = wav.readframes(count)
    if width != 2:
        pcm = audioop.lin2lin(pcm, width, 2)
    if channels == 2:
        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
    if source_rate != rate:
        pcm, _ = audioop.ratecv(pcm, 2, 1, source_rate, rate, None)
    return pcm, {'file': path.name, 'sample_rate': source_rate, 'channels': channels,
                 'seconds': round(count / source_rate, 3)}


def transcript_script(text: str) -> str:
    if any('\u0a80' <= char <= '\u0aff' for char in text):
        return 'gu'
    if any('\u0900' <= char <= '\u097f' for char in text):
        return 'hi'
    return 'en'


class Trace:
    def __init__(self):
        self.agent_state = 'initializing'
        self.last_audible = 0.0
        self.total_audio_frames = 0
        self.active: dict | None = None
        self.turns: list[dict] = []
        self.events: list[dict] = []
        self.phone_clear_count = 0
        self.phone_mark_count = 0
        self.phone_bad_frame_count = 0
        self.pipeline_errors = 0

    def event(self, message: Any) -> None:
        if not isinstance(message, dict):
            return
        now = time.monotonic()
        kind = message.get('type')
        self.events.append({'type': kind, 'state': message.get('state'), 'at': now})
        if kind == 'agent_state':
            self.agent_state = message.get('state', '')
        if kind == 'error':
            self.pipeline_errors += 1
        case = self.active
        if case is None:
            return
        if kind == 'user_transcript':
            # A pause inside the prerecorded input may make multiple VAD
            # turns. Time the final segment against its own reply, never the
            # first segment's timestamp with the final segment's transcript.
            if case.get('turn_id') != message.get('turn_id'):
                for field in ('reply_at', 'reply_text', 'reply_language', 'audio_at'):
                    case.pop(field, None)
                case['transcript_at'] = now
                case['transcript_segments'] = case.get('transcript_segments', 0) + 1
            case['turn_id'] = message.get('turn_id')
            case['transcript'] = str(message.get('text') or message.get('transcript') or '')
        elif kind == 'agent_reply_text' and message.get('turn_id') == case.get('turn_id') and case.get('turn_id'):
            case.setdefault('reply_at', now)
            case['reply_language'] = message.get('language')
            case['reply_text'] = str(message.get('text', ''))
            case['reply_characters'] = len(case['reply_text'])
        elif kind == 'agent_interrupted':
            case.setdefault('interrupted_at', now)
        elif kind == 'user_state' and message.get('state') == 'speaking':
            case.setdefault('user_speaking_at', now)
        elif kind == 'error':
            case.setdefault('pipeline_errors', 0)
            case['pipeline_errors'] += 1

    def audio(self, pcm: bytes) -> None:
        self.total_audio_frames += 1
        if not pcm or audioop.rms(pcm, 2) <= 80:
            return
        now = time.monotonic()
        self.last_audible = now
        if self.active and self.active.get('reply_at'):
            self.active.setdefault('audio_at', now)

    def begin(self, language: str, *, interrupted_reply: bool = False) -> dict:
        case = {'case': f'{len(self.turns) + 1}_{language}', 'input_language': language,
                'input_file': SAMPLES[language][0], 'synthetic_input': SAMPLES[language][1],
                'started_at': time.monotonic(), 'interrupting': interrupted_reply}
        self.turns.append(case)
        self.active = case
        return case

    async def settle(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.pipeline_errors:
                raise SmokeFailure('Speech pipeline reported an error')
            if self.last_audible > 0 and self.agent_state in {'listening', 'idle'} and time.monotonic() - self.last_audible >= 0.4:
                return
            await asyncio.sleep(0.04)
        raise SmokeFailure('Agent did not return to listening')

    async def first_reply_audio(self, case: dict, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.pipeline_errors or case.get('pipeline_errors'):
                raise SmokeFailure('Speech pipeline reported an error')
            # Ignore a reply to an early segment while the remainder of this
            # synthetic utterance is still arriving. Small trailing silence
            # in a WAV is allowed; a several-second early reply is not.
            if case.get('audio_at') and case.get('transcript_at', 0) >= case.get('input_stop_at', 0) - 0.6:
                return
            await asyncio.sleep(0.02)
        raise SmokeFailure('Timed out waiting for validated reply audio')

    def report(self) -> dict:
        results = []
        for case in self.turns:
            stop = case.get('input_stop_at')
            output = {key: value for key, value in case.items() if not key.endswith('_at') and key != 'turn_id'}
            output['latency_seconds'] = {
                label: round(case[field] - stop, 3) if stop is not None and field in case else None
                for label, field in [('stop_to_transcript', 'transcript_at'), ('stop_to_reply_text', 'reply_at'),
                                     ('stop_to_first_audible_reply', 'audio_at')]
            }
            if 'user_speaking_at' in case and 'interrupted_at' in case:
                output['vad_to_confirmed_interruption_seconds'] = round(case['interrupted_at'] - case['user_speaking_at'], 3)
            if 'phone_clear_at' in case and 'interrupted_at' in case:
                output['confirmed_interruption_to_phone_clear_seconds'] = round(case['phone_clear_at'] - case['interrupted_at'], 3)
            expected = 'hi' if case['input_language'] == 'hinglish' else case['input_language']
            output['transcript_script_language'] = transcript_script(case.get('transcript', ''))
            output['reply_script_language'] = transcript_script(case.get('reply_text', ''))
            output['language_match'] = bool(case.get('transcript')) and bool(case.get('reply_text')) and output['transcript_script_language'] == expected and output['reply_script_language'] == expected and case.get('reply_language') == expected
            output['audio_received'] = bool(case.get('audio_at'))
            if case['interrupting']:
                output['interruption_confirmed'] = bool(case.get('interrupted_at'))
            results.append(output)
        return {'turns': results, 'received_audio_frames': self.total_audio_frames,
                'pipeline_error_count': self.pipeline_errors,
                'phone_clear_count': self.phone_clear_count, 'phone_mark_count': self.phone_mark_count,
                'phone_invalid_outbound_frame_count': self.phone_bad_frame_count}


async def paced_input(pcm: bytes, *, rate: int, frame_ms: int, send, case: dict, mulaw: bool) -> None:
    data = audioop.lin2ulaw(pcm, 2) if mulaw else pcm
    sample_width = 1 if mulaw else 2
    block_size = rate * frame_ms // 1000 * sample_width
    silence = b'\xff' if mulaw else b'\0'
    start = time.monotonic()
    blocks = (len(data) + block_size - 1) // block_size
    # 1.8 seconds of digital silence closes the VAD turn without disconnecting.
    tail_blocks = (1800 + frame_ms - 1) // frame_ms
    for index in range(blocks + tail_blocks):
        target = start + index * frame_ms / 1000
        await asyncio.sleep(max(0, target - time.monotonic()))
        if index == blocks:
            case['input_stop_at'] = time.monotonic()
        block = data[index * block_size:(index + 1) * block_size]
        await send(block.ljust(block_size, silence))


def configured_api():
    if not all(os.getenv(key) for key in ('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET')):
        raise SmokeFailure('LiveKit service credentials are required for bounded test cleanup and phone observation')
    return api.LiveKitAPI(os.environ['LIVEKIT_URL'], os.environ['LIVEKIT_API_KEY'], os.environ['LIVEKIT_API_SECRET'])


async def delete_owned_room(room_name: str | None) -> None:
    if room_name and room_name.startswith('earthora-'):
        async with configured_api() as client:
            try:
                await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
            except Exception as error:
                # The normal phone bridge also deletes its own room on close.
                if getattr(error, 'code', None) != 'not_found':
                    raise


class RoomObserver:
    def __init__(self, trace: Trace, *, receive_audio: bool):
        self.trace = trace
        self.room = rtc.Room()
        self.tasks: set[asyncio.Task] = set()
        self.receive_audio = receive_audio

        @self.room.on('data_received')
        def data(packet):
            if packet.topic != TOPIC:
                return
            with contextlib.suppress(ValueError, UnicodeDecodeError):
                self.trace.event(json.loads(packet.data.decode()))

        @self.room.on('track_subscribed')
        def track_subscribed(track, publication, participant):
            if receive_audio and track.kind == rtc.TrackKind.KIND_AUDIO:
                task = asyncio.create_task(self.read_audio(track))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

    async def read_audio(self, track) -> None:
        stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        try:
            async for event in stream:
                self.trace.audio(bytes(event.frame.data))
        finally:
            await stream.aclose()

    async def connect(self, url: str, token: str) -> None:
        url = url.replace('http://', 'ws://').replace('https://', 'wss://')
        await asyncio.wait_for(self.room.connect(url, token, options=rtc.RoomOptions(auto_subscribe=self.receive_audio)), timeout=30)

    async def close(self) -> None:
        await self.room.disconnect()
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_cases(args, trace: Trace, send_input) -> None:
    await trace.settle(args.turn_timeout)
    for index, language in enumerate(args.languages):
        case = trace.begin(language)
        await send_input(language, case)
        await trace.first_reply_audio(case, args.turn_timeout)
        # Interrupt the last normal reply while its first audible audio is
        # playing, with another full harmless English synthetic utterance.
        if index == len(args.languages) - 1 and not args.no_interruption:
            interruption = trace.begin('en', interrupted_reply=True)
            await send_input('en', interruption)
            await trace.first_reply_audio(interruption, args.turn_timeout)
        await trace.settle(args.turn_timeout)


async def web_smoke(args) -> dict:
    trace = Trace()
    observer = RoomObserver(trace, receive_audio=True)
    source = None
    room_name = None
    report = {'transport': 'web', 'connection': 'override' if args.livekit_connect_url else 'application_public_url'}
    try:
        channel_key = os.getenv('VOICE_TEST_CHANNEL_KEY') or os.getenv('VOICE_PHONE_CHANNEL_KEY')
        if not channel_key:
            raise SmokeFailure('VOICE_TEST_CHANNEL_KEY or VOICE_PHONE_CHANNEL_KEY is required')
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as http:
            async with http.post(args.api_url.rstrip('/') + '/api/platform/voice/livekit/session', json={
                'channelKey': channel_key, 'conversationId': 'voice_smoke_' + uuid.uuid4().hex, 'language': 'auto',
            }) as response:
                if response.status != 200:
                    raise SmokeFailure('Application browser admission failed')
                session = await response.json()
        room_name = session['room_name']
        await observer.connect(args.livekit_connect_url or session['url'], session['token'])
        source = rtc.AudioSource(16000, 1, queue_size_ms=100)
        track = rtc.LocalAudioTrack.create_audio_track('synthetic-test-input', source)
        await observer.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        async def send_input(language, case):
            pcm, _ = pcm_for(args.wav_dir / SAMPLES[language][0], 16000)
            async def send(block):
                await source.capture_frame(rtc.AudioFrame(data=block, sample_rate=16000, num_channels=1, samples_per_channel=len(block)//2))
            await paced_input(pcm, rate=16000, frame_ms=20, send=send, case=case, mulaw=False)
        await run_cases(args, trace, send_input)
    except Exception as error:
        report['failure'] = str(error) if isinstance(error, SmokeFailure) else type(error).__name__
    finally:
        with contextlib.suppress(Exception):
            await observer.close()
        if source:
            with contextlib.suppress(Exception):
                await source.aclose()
        try:
            await delete_owned_room(room_name)
            report['room_cleanup'] = True
        except Exception:
            report['room_cleanup'] = False
    report.update(trace.report())
    return report


async def find_phone_room(session_id: str, timeout: float = 25) -> str:
    deadline = time.monotonic() + timeout
    async with configured_api() as client:
        while time.monotonic() < deadline:
            rooms = await client.room.list_rooms(api.ListRoomsRequest())
            for room in rooms.rooms:
                with contextlib.suppress(ValueError):
                    metadata = json.loads(room.metadata or '{}')
                    if room.name.startswith('earthora-') and metadata.get('session_id') == session_id and metadata.get('channel') == 'phone':
                        participants = await client.room.list_participants(api.ListParticipantsRequest(room=room.name))
                        # Never become the first remote participant: the agent
                        # must bind input to the actual phone bridge microphone.
                        if any(participant.identity.startswith('phone-') for participant in participants.participants):
                            return room.name
            await asyncio.sleep(0.2)
    raise SmokeFailure('Synthetic phone room was not admitted')


async def phone_smoke(args) -> dict:
    trace = Trace()
    observer = RoomObserver(trace, receive_audio=False)
    report = {'transport': 'synthetic_smartflo', 'input_frame_ms': 100, 'input_encoding': 'mulaw_8000',
              'real_phone_called': False, 'final_call_end_injected_into_own_test_room': True}
    room_name = None
    ws = None
    reader = None
    stream_id = 'synthetic_stream_' + uuid.uuid4().hex
    call_id = 'synthetic_smoke_' + uuid.uuid4().hex
    session_id = 'phone_' + hashlib.sha256(call_id.encode()).hexdigest()[:40]
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None))
    closed = asyncio.Event()
    try:
        ws = await http.ws_connect(args.smartflo_url, heartbeat=20)
        async def read_phone():
            try:
                async for packet in ws:
                    if packet.type == aiohttp.WSMsgType.ERROR:
                        raise SmokeFailure('Phone WebSocket reported a transport error')
                    if packet.type != aiohttp.WSMsgType.TEXT:
                        continue
                    message = json.loads(packet.data)
                    kind = message.get('event')
                    if kind == 'media':
                        raw = base64.b64decode(message['media']['payload'], validate=True)
                        if len(raw) < 160 or len(raw) % 160:
                            trace.phone_bad_frame_count += 1
                        trace.audio(audioop.ulaw2lin(raw, 2))
                    elif kind == 'clear':
                        trace.phone_clear_count += 1
                        if trace.active:
                            trace.active.setdefault('phone_clear_at', time.monotonic())
                    elif kind == 'mark':
                        trace.phone_mark_count += 1
                        await ws.send_json({'event': 'mark', 'streamSid': stream_id, 'mark': message['mark']})
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Do not expose transport URLs or tokens from exception text.
                report['phone_reader_error'] = type(error).__name__
            finally:
                report['phone_close_code'] = ws.close_code
                closed.set()
        reader = asyncio.create_task(read_phone())
        await ws.send_json({'event': 'start', 'streamSid': stream_id, 'start': {
            'streamSid': stream_id, 'callSid': call_id, 'tracks': ['inbound', 'outbound'],
            'mediaFormat': {'encoding': 'audio/x-mulaw', 'sampleRate': 8000, 'channels': 1},
        }})
        room_name = await find_phone_room(session_id)
        token = (api.AccessToken(os.environ['LIVEKIT_API_KEY'], os.environ['LIVEKIT_API_SECRET'])
                 .with_identity('synthetic-observer-' + uuid.uuid4().hex[:12])
                 .with_ttl(timedelta(minutes=15))
                 .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=False, can_subscribe=True, can_publish_data=True)))
        await observer.connect(args.livekit_connect_url or os.environ['LIVEKIT_URL'], token.to_jwt())
        sequence = 0
        async def send_input(language, case):
            pcm, _ = pcm_for(args.wav_dir / SAMPLES[language][0], 8000)
            async def send(block):
                nonlocal sequence
                sequence += 1
                await ws.send_json({'event': 'media', 'streamSid': stream_id, 'sequenceNumber': str(sequence),
                                    'media': {'track': 'inbound', 'chunk': str(sequence), 'timestamp': str((sequence - 1)*100),
                                              'payload': base64.b64encode(block).decode()}})
            await paced_input(pcm, rate=8000, frame_ms=100, send=send, case=case, mulaw=True)
        await run_cases(args, trace, send_input)
        await observer.room.local_participant.publish_data(json.dumps({'type': 'call_end', 'reason': 'synthetic_smoke_complete'}).encode(), reliable=True, topic=TOPIC)
        await asyncio.wait_for(closed.wait(), timeout=10)
        report['phone_close_received'] = ws.closed and ws.close_code == 1000 and not report.get('phone_reader_error')
        if not report['phone_close_received']:
            raise SmokeFailure('Phone did not receive a clean normal WebSocket close')
    except Exception as error:
        report['failure'] = str(error) if isinstance(error, SmokeFailure) else type(error).__name__
    finally:
        if ws and not ws.closed:
            with contextlib.suppress(Exception):
                await ws.send_json({'event': 'stop', 'streamSid': stream_id})
                await ws.close()
        if reader:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
        await http.close()
        with contextlib.suppress(Exception):
            await observer.close()
        try:
            await delete_owned_room(room_name)
            report['room_cleanup'] = True
        except Exception:
            report['room_cleanup'] = False
    report.update(trace.report())
    return report


def passed(report: dict, *, interruption: bool) -> bool:
    turns = report.get('turns', [])
    if report.get('failure') or report.get('pipeline_error_count') or not report.get('room_cleanup') or not turns:
        return False
    if not all(turn['audio_received'] and turn['language_match'] and not turn.get('pipeline_errors') for turn in turns):
        return False
    if interruption and not any(turn.get('interruption_confirmed') for turn in turns):
        return False
    if report['transport'] == 'synthetic_smartflo':
        if report['phone_invalid_outbound_frame_count'] or not report['phone_mark_count'] or not report.get('phone_close_received') or report.get('phone_reader_error') or report.get('phone_close_code') != 1000:
            return False
        if interruption and not report['phone_clear_count']:
            return False
    return True


async def main(args) -> int:
    global api, rtc
    manifest = {}
    for language, (filename, text) in SAMPLES.items():
        _, metadata = pcm_for(args.wav_dir / filename, 16000)
        manifest[language] = {**metadata, 'synthetic_text': text}
    if args.inspect:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    from livekit import api, rtc
    # Validate cleanup access before any session is created. This does not print
    # credentials or issue any third-party telephony/provider API call.
    async with configured_api() as client:
        await client.room.list_rooms(api.ListRoomsRequest())
    result = {'timestamp_utc': datetime.now(timezone.utc).isoformat(), 'synthetic_only': True,
              'method': 'Client monotonic timestamps; stop_input is final queued synthetic sample, not TTS generation time. Phone observer timestamps include data-channel delivery.',
              'inputs': manifest, 'transports': []}
    modes = ['web', 'phone'] if args.mode == 'both' else [args.mode]
    for mode in modes:
        report = await (web_smoke(args) if mode == 'web' else phone_smoke(args))
        report['passed'] = passed(report, interruption=not args.no_interruption)
        result['transports'].append(report)
        print(json.dumps({'transport': report['transport'], 'passed': report['passed'],
                          'turns': [{'case': turn['case'], 'latency_seconds': turn['latency_seconds'],
                                     'language_match': turn['language_match']} for turn in report['turns']],
                          'failure': report.get('failure')}, ensure_ascii=False))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if all(report['passed'] for report in result['transports']) else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--wav-dir', required=True, type=Path)
    parser.add_argument('--mode', choices=['web', 'phone', 'both'], default='both')
    parser.add_argument('--api-url', default=os.getenv('EARTHORA_API_URL', 'http://127.0.0.1:4100'))
    parser.add_argument('--smartflo-url', default=os.getenv('VOICE_SMOKE_SMARTFLO_URL', 'ws://127.0.0.1:7860/ws/voice/smartflo'))
    parser.add_argument('--livekit-connect-url', help='Optional local-signalling override; omit for public browser ICE verification')
    parser.add_argument('--languages', default='en,hi,gu,en', help='Comma-separated sample identifiers; default verifies switching back after Gujarati')
    parser.add_argument('--turn-timeout', type=float, default=75)
    parser.add_argument('--no-interruption', action='store_true')
    parser.add_argument('--inspect', action='store_true', help='Inspect the synthetic WAV manifest without network access or LiveKit imports')
    parser.add_argument('--output', type=Path, default=Path('live-smoke-result.json'))
    args = parser.parse_args()
    args.languages = args.languages.split(',')
    if not args.languages or any(language not in SAMPLES for language in args.languages):
        parser.error('languages must be en, hi, gu or hinglish')
    try:
        raise SystemExit(asyncio.run(main(args)))
    except Exception as error:
        # Exception text from HTTP/RTC clients may contain URLs or JWTs.
        print(json.dumps({'fatal': str(error) if isinstance(error, SmokeFailure) else type(error).__name__}))
        raise SystemExit(1)
