"""Opt-in synthetic SunPath lifecycle acceptance; never calls a real phone.

Uses real browser admission, named LiveKit dispatch and received RTC audio.
Case one remains silent through greeting, away prompt, grace and closure. Case
two publishes a prerecorded synthetic farewell and waits for native closure.
Without --farewell-wav it replays the fixed closing audio captured in case one;
it does not make a separate TTS request or use any recording of a real person.

Only this run's newly admitted rooms are inspected and cleaned up. Cleanup is
measured before a finally-block safety deletion; forced deletion cannot pass.
Credentials stay in the environment and are never printed or saved. This file
is not automatically run by pytest. Deployment must be ready before invoking.

  python tests/live_sunpath_lifecycle.py --api-url http://api:4100 \
      --output /tmp/voice-smoke/sunpath-lifecycle.json
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live_smoke as smoke
from sunpath_runtime import COPY, is_farewell


class LifecycleTrace:
    """Capture only our room's fixed speech, event ordering and synthetic input."""

    def __init__(self):
        self.started = time.monotonic()
        self.events: list[dict] = []
        self.stages: list[dict] = []
        self.transcripts: list[dict] = []
        self.end: dict | None = None
        self.agent_state = 'initializing'
        self.pipeline_errors = 0
        self.reader_errors = 0
        self.last_audible = 0.0
        self.generation_count = 0

    def event(self, message: Any) -> None:
        if not isinstance(message, dict):
            return
        now = time.monotonic()
        kind = message.get('type')
        self.events.append({'type': kind, 'state': message.get('state'), 'at': now})
        if kind == 'error':
            self.pipeline_errors += 1
        elif kind == 'agent_state':
            self.agent_state = message.get('state', '')
        elif kind == 'speech_generation':
            self.generation_count += 1
        elif kind == 'agent_reply_text':
            text = str(message.get('text', ''))
            stage_kind = next((name for name in ('greeting', 'away', 'closing')
                               if text == COPY['en'][name]), 'unexpected')
            self.stages.append({'kind': stage_kind, 'text_at': now,
                                'turn_id': message.get('turn_id'), 'pcm': bytearray()})
        elif kind == 'user_transcript':
            text = str(message.get('text') or message.get('transcript') or '')
            self.transcripts.append({'at': now, 'turn_id': message.get('turn_id'),
                                     'farewell': is_farewell(text)})
        elif kind == 'call_end':
            if self.end is None:
                self.end = {'at': now, 'reason': message.get('reason')}

    def audio(self, pcm: bytes) -> None:
        if not self.stages or not pcm:
            return
        stage = self.stages[-1]
        # Bounds memory even if a deployment regresses and never closes.
        if len(stage['pcm']) + len(pcm) <= 5_000_000:
            stage['pcm'].extend(pcm)
        else:
            self.reader_errors += 1
        if audioop.rms(pcm, 2) > 80:
            now = time.monotonic()
            self.last_audible = now
            stage.setdefault('first_audio_at', now)
            stage['last_audio_at'] = now
            stage['audible_samples'] = stage.get('audible_samples', 0) + len(pcm) // 2

    def ensure_healthy(self) -> None:
        if self.pipeline_errors or self.reader_errors:
            raise smoke.SmokeFailure('Lifecycle audio or agent pipeline reported an error')

    async def wait_for(self, predicate, timeout: float, failure: str) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.ensure_healthy()
            if predicate():
                return
            if self.end is not None:
                raise smoke.SmokeFailure('Call ended before the expected lifecycle condition')
            await asyncio.sleep(0.025)
        raise smoke.SmokeFailure(failure)

    async def greeting_finished(self, timeout: float) -> None:
        await self.wait_for(
            lambda: len(self.stages) == 1 and self.stages[0]['kind'] == 'greeting'
            and bool(self.stages[0].get('last_audio_at'))
            and self.agent_state in {'listening', 'idle'}
            and time.monotonic() - self.last_audible >= 0.4,
            timeout, 'Timed out waiting for the audible greeting to finish')

    async def drain_after_end(self) -> None:
        # Data and audio use different transports. Let already-sent final audio
        # arrive before simulating the widget's disconnect on call_end.
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            self.ensure_healthy()
            if time.monotonic() - self.end['at'] >= 0.5 and time.monotonic() - self.last_audible >= 0.35:
                return
            await asyncio.sleep(0.025)

    def report(self, case: str, *, grace_seconds: float, reference_closing: dict | None = None) -> dict:
        stages = [{key: value for key, value in stage.items() if key not in {'pcm', 'turn_id'}}
                  for stage in self.stages]
        for stage in stages:
            for key in tuple(stage):
                if key.endswith('_at'):
                    stage[key.removesuffix('_at') + '_seconds'] = round(stage.pop(key) - self.started, 3)
        expected = ['greeting', 'away', 'closing'] if case == 'silence' else ['greeting', 'closing']
        checks = {
            'no_pipeline_or_reader_errors': not self.pipeline_errors and not self.reader_errors,
            'fixed_speech_order': [stage['kind'] for stage in self.stages] == expected,
            'all_fixed_speech_audible': bool(self.stages) and all(stage.get('first_audio_at') for stage in self.stages),
            'speech_generation_events': self.generation_count >= len(expected),
            'native_close_reason': bool(self.end) and self.end['reason'] == ('silence' if case == 'silence' else 'farewell'),
        }
        closing = next((stage for stage in self.stages if stage['kind'] == 'closing'), {})
        # A terminal event may race the last RTC packet by a few milliseconds;
        # it must still follow audible closing speech, not merely its text.
        checks['closing_audio_before_call_end'] = bool(self.end and closing.get('last_audio_at')
                                                      and self.end['at'] >= closing['first_audio_at']
                                                      and self.end['at'] >= closing['last_audio_at'] - 0.35)
        coverage = closing_coverage(closing)
        reference_closing = reference_closing or {}
        # A single received frame does not prove terminal playback. The first
        # fixed nine-word closing needs a useful span and voiced-frame floor;
        # the second is also compared to that captured fixture. Its transcript
        # must recognize the final "Goodbye" before overall acceptance.
        checks['closing_audio_coverage'] = (
            coverage['span_seconds'] >= max(1.5, reference_closing.get('span_seconds', 0) * 0.75)
            and coverage['audible_seconds'] >= max(0.5, reference_closing.get('audible_seconds', 0) * 0.75))
        report = {'case': case, 'checks': checks, 'stages': stages,
                  'speech_generation_count': self.generation_count,
                  'closing_audio_coverage': coverage,
                  'pipeline_error_count': self.pipeline_errors, 'reader_error_count': self.reader_errors,
                  'call_end': {'reason': self.end['reason'], 'seconds': round(self.end['at'] - self.started, 3)} if self.end else None}
        if case == 'silence':
            away = next((stage for stage in self.stages if stage['kind'] == 'away'), {})
            gap = closing.get('text_at', 0) - away.get('last_audio_at', float('inf'))
            report['away_audio_end_to_closing_text_seconds'] = round(gap, 3) if gap != float('-inf') else None
            checks['grace_after_audible_prompt'] = gap >= grace_seconds - 0.35
            checks['no_user_turns'] = not self.transcripts
        else:
            checks['recognized_farewell_correlated_to_closing'] = any(
                item['farewell'] and item['turn_id'] and item['turn_id'] == closing.get('turn_id')
                for item in self.transcripts)
            report['synthetic_transcript_count'] = len(self.transcripts)
        return report


class LifecycleObserver(smoke.RoomObserver):
    async def read_audio(self, track) -> None:
        try:
            await super().read_audio(track)
        except asyncio.CancelledError:
            raise
        except Exception:
            self.trace.reader_errors += 1


def closing_coverage(stage: dict) -> dict:
    return {'span_seconds': round(max(0, stage.get('last_audio_at', 0) - stage.get('first_audio_at', 0)), 3),
            'audible_seconds': round(stage.get('audible_samples', 0) / 16000, 3)}


def token_room_matches(token: str, room_name: str) -> bool:
    """Inspect room scope only; actual dispatch is verified through the API.

    CreateRoomRequest already dispatches the named agent. A token roomConfig
    is intentionally absent: it only takes effect when joining a new room.
    """
    try:
        encoded = token.split('.')[1]
        payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        return payload.get('video', {}).get('room') == room_name
    except (ValueError, IndexError, TypeError, AttributeError):
        return False


async def verify_dispatch(room_name: str, agent_name: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    async with smoke.configured_api() as client:
        while time.monotonic() < deadline:
            dispatches = await client.agent_dispatch.list_dispatch(room_name)
            matching = [entry for entry in dispatches if entry.agent_name == agent_name and entry.room == room_name]
            if len(matching) == 1 and len(dispatches) == 1:
                return
            await asyncio.sleep(0.2)
    raise smoke.SmokeFailure('Expected named agent dispatch was not found in the admitted room')


async def verify_owned_room(candidate: str, session_id: str, channel_key: str, previous_rooms: set[str]) -> str:
    if not isinstance(candidate, str) or not candidate.startswith('earthora-') or candidate in previous_rooms:
        raise smoke.SmokeFailure('Admission did not return a new synthetic room')
    async with smoke.configured_api() as client:
        response = await client.room.list_rooms(smoke.api.ListRoomsRequest(names=[candidate]))
    for room in response.rooms:
        if room.name != candidate:
            continue
        try:
            metadata = json.loads(room.metadata or '{}')
        except (ValueError, TypeError):
            break
        if (metadata.get('session_id') == session_id and metadata.get('channel') == 'web'
                and metadata.get('channel_key') == channel_key):
            return candidate
    raise smoke.SmokeFailure('Room metadata did not prove ownership by this synthetic run')


async def wait_for_room_removal(room_name: str, timeout: float) -> float:
    started = time.monotonic()
    async with smoke.configured_api() as client:
        while time.monotonic() - started < timeout:
            result = await client.room.list_rooms(smoke.api.ListRoomsRequest(names=[room_name]))
            if not any(room.name == room_name for room in result.rooms):
                return round(time.monotonic() - started, 3)
            await asyncio.sleep(0.25)
    raise smoke.SmokeFailure('Room persisted after native call_end and browser disconnect')


def save_synthetic_closing(trace: LifecycleTrace, path: Path) -> dict:
    closing = next(stage for stage in trace.stages if stage['kind'] == 'closing')
    pcm = bytes(closing['pcm'])
    blocks = [pcm[index:index + 640] for index in range(0, len(pcm), 640)]
    audible = [index for index, block in enumerate(blocks) if audioop.rms(block, 2) > 80]
    if not audible:
        raise smoke.SmokeFailure('No synthetic closing audio was captured')
    # Retain 200 ms around the speech, while excluding potentially long RTP
    # silence before synthesis. The fixture contains only our fixed farewell.
    pcm = b''.join(blocks[max(0, audible[0] - 10):audible[-1] + 11])
    if not 0.4 <= len(pcm) / 32000 <= 12:
        raise smoke.SmokeFailure('Captured synthetic farewell has an unexpected duration')
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm)
    return {'file': path.name, 'provenance': 'Fixed English closing synthesized in this run\'s silence case',
            'synthetic_text': COPY['en']['closing'], 'seconds': round(len(pcm) / 32000, 3),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


async def lifecycle_case(args, case: str, farewell_wav: Path | None = None, reference_closing: dict | None = None) -> tuple[dict, LifecycleTrace]:
    trace = LifecycleTrace()
    observer = LifecycleObserver(trace, receive_audio=True)
    room_name, source = None, None
    closed = False
    report: dict = {'case': case, 'connection': 'override' if args.livekit_connect_url else 'application_public_url',
                    'token_room_scope': False, 'actual_named_dispatch': False, 'agent_participant_joined': False,
                    'automatic_room_cleanup': False, 'safety_cleanup': False}
    try:
        channel_key = os.getenv('VOICE_TEST_CHANNEL_KEY') or os.getenv('VOICE_PHONE_CHANNEL_KEY')
        if not channel_key:
            raise smoke.SmokeFailure('A voice test channel key is required in the environment')
        async with smoke.configured_api() as client:
            prior = await client.room.list_rooms(smoke.api.ListRoomsRequest())
        previous_rooms = {room.name for room in prior.rooms}
        session_id = 'voice_lifecycle_' + uuid.uuid4().hex
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as http:
            async with http.post(args.api_url.rstrip('/') + '/api/platform/voice/livekit/session', json={
                'channelKey': channel_key, 'conversationId': session_id, 'language': 'en',
            }) as response:
                if response.status != 200:
                    raise smoke.SmokeFailure('Application browser admission failed')
                session = await response.json()
        # Do not connect to, inspect dispatches in, or delete a room until both
        # freshness and unique metadata prove it belongs to this exact run.
        room_name = await verify_owned_room(session['room_name'], session_id, channel_key, previous_rooms)
        report['token_room_scope'] = token_room_matches(session['token'], room_name)
        if not report['token_room_scope']:
            raise smoke.SmokeFailure('Admission token was not scoped to the admitted room')
        await observer.connect(args.livekit_connect_url or session['url'], session['token'])
        source = smoke.rtc.AudioSource(16000, 1, queue_size_ms=100)
        track = smoke.rtc.LocalAudioTrack.create_audio_track('synthetic-lifecycle-input', source)
        await observer.room.local_participant.publish_track(track, smoke.rtc.TrackPublishOptions(source=smoke.rtc.TrackSource.SOURCE_MICROPHONE))
        await verify_dispatch(room_name, args.agent_name, args.start_timeout)
        report['actual_named_dispatch'] = True
        await trace.greeting_finished(args.start_timeout)
        report['agent_participant_joined'] = sum(
            participant.kind == smoke.rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
            for participant in observer.room.remote_participants.values()) == 1
        if not report['agent_participant_joined']:
            raise smoke.SmokeFailure('Expected exactly one joined agent participant')
        if case == 'farewell':
            pcm, metadata = smoke.pcm_for(farewell_wav, 16000)
            if not 0.2 <= metadata['seconds'] <= 15:
                raise smoke.SmokeFailure('Synthetic farewell WAV must last between 0.2 and 15 seconds')
            report['input'] = metadata
            async def send(block):
                await source.capture_frame(smoke.rtc.AudioFrame(data=block, sample_rate=16000, num_channels=1, samples_per_channel=len(block) // 2))
            input_case = {}
            await smoke.paced_input(pcm, rate=16000, frame_ms=20, send=send, case=input_case, mulaw=False)
            report['input_stop_seconds'] = round(input_case['input_stop_at'] - trace.started, 3)
        await trace.wait_for(lambda: trace.end is not None, args.case_timeout, 'Native lifecycle did not emit call_end')
        await trace.drain_after_end()
        await observer.close()
        closed = True
        report['room_removed_after_disconnect_seconds'] = await wait_for_room_removal(room_name, args.cleanup_timeout)
        report['automatic_room_cleanup'] = True
    except Exception as error:
        report['failure'] = str(error) if isinstance(error, smoke.SmokeFailure) else type(error).__name__
    finally:
        if not closed:
            with contextlib.suppress(Exception):
                await observer.close()
        if source:
            with contextlib.suppress(Exception):
                await source.aclose()
        if room_name is not None:
            try:
                await smoke.delete_owned_room(room_name)
                report['safety_cleanup'] = True
            except Exception:
                pass
    report.update(trace.report(case, grace_seconds=args.grace_seconds, reference_closing=reference_closing))
    report['passed'] = bool(not report.get('failure') and report['token_room_scope']
                            and report['actual_named_dispatch'] and report['agent_participant_joined'] and report['automatic_room_cleanup']
                            and report['safety_cleanup'] and all(report['checks'].values()))
    return report, trace


async def main(args) -> int:
    from livekit import api, rtc
    smoke.api, smoke.rtc = api, rtc
    async with smoke.configured_api() as client:
        await client.room.list_rooms(api.ListRoomsRequest())
    result = {'timestamp_utc': datetime.now(timezone.utc).isoformat(), 'synthetic_only': True,
              'transport': 'browser_webrtc', 'expected_agent_name': args.agent_name,
              'configured_grace_seconds': args.grace_seconds,
              'method': 'Client monotonic timestamps; grace measured after last audible away-prompt frame. Native call_end is required; browser then disconnects and room removal is observed before safety deletion.',
              'cases': []}
    silence, trace = await lifecycle_case(args, 'silence')
    result['cases'].append(silence)
    if silence['passed']:
        farewell_wav = args.farewell_wav
        if farewell_wav is None:
            farewell_wav = args.output.with_name(args.output.stem + '-synthetic-farewell.wav')
            result['farewell_fixture'] = save_synthetic_closing(trace, farewell_wav)
        else:
            result['farewell_fixture'] = {'file': farewell_wav.name, 'provenance': 'Caller supplied prerecorded synthetic farewell'}
        farewell, _ = await lifecycle_case(args, 'farewell', farewell_wav, reference_closing=silence['closing_audio_coverage'])
        result['cases'].append(farewell)
    else:
        result['farewell_skipped'] = 'Silence lifecycle failed; no further GPU work was started'
    result['passed'] = len(result['cases']) == 2 and all(case['passed'] for case in result['cases'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': result['passed'], 'cases': [{key: case[key] for key in ('case', 'passed', 'checks', 'automatic_room_cleanup', 'failure') if key in case} for case in result['cases']]}))
    return 0 if result['passed'] else 1


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--api-url', default=os.getenv('EARTHORA_API_URL', 'http://127.0.0.1:4100'))
    parser.add_argument('--livekit-connect-url', help='Optional local-signaling override; omit to exercise the application public WebRTC URL')
    parser.add_argument('--agent-name', default=os.getenv('VOICE_AGENT_NAME', 'earthora-sunpath'))
    parser.add_argument('--farewell-wav', type=Path, help='Existing synthetic farewell only; otherwise capture and replay this run\'s own fixed closing audio')
    parser.add_argument('--grace-seconds', type=float, default=float(os.getenv('AWAY_GRACE_SECONDS', '10')))
    parser.add_argument('--start-timeout', type=float, default=35)
    parser.add_argument('--case-timeout', type=float, default=75)
    parser.add_argument('--cleanup-timeout', type=float, default=55)
    parser.add_argument('--output', type=Path, default=Path('sunpath-lifecycle-result.json'))
    args = parser.parse_args()
    if any(getattr(args, name) <= 0 for name in ('grace_seconds', 'start_timeout', 'case_timeout', 'cleanup_timeout')):
        parser.error('All lifecycle timeouts must be positive')
    if args.farewell_wav is not None and not args.farewell_wav.is_file():
        parser.error('farewell-wav must be an existing synthetic WAV file')
    return args


if __name__ == '__main__':
    try:
        raise SystemExit(asyncio.run(main(arguments())))
    except Exception as error:
        print(json.dumps({'fatal': str(error) if isinstance(error, smoke.SmokeFailure) else type(error).__name__}))
        raise SystemExit(1)
