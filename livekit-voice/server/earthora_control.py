"""UniExl room/token pattern adapted for Earthora and Tata Smartflo ingress.

The browser and the phone publish audio into the SAME LiveKit agent. This
process owns transport only; all conversation decisions stay in Earthora's API.
The original UniExl token server is preserved in ../upstream/server.
"""
import asyncio
import audioop
import base64
import contextlib
import json
import logging
import os
import secrets
import time
import uuid
from datetime import timedelta

import aiohttp
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from livekit import api, rtc
from pydantic import BaseModel, Field
from earthora_bridge import VoiceContext

log = logging.getLogger('earthora.control')
app = FastAPI(title='Earthora UniExl Voice Control')
ACCESS_KEY = os.environ['EARTHORA_VOICE_INTERNAL_KEY']
LK_URL = os.environ['LIVEKIT_URL']
PUBLIC_URL = os.environ['LIVEKIT_PUBLIC_URL']
API_URL = os.environ['EARTHORA_API_URL'].rstrip('/')
PUBLIC_ORIGIN = os.environ['EARTHORA_PUBLIC_ORIGIN'].rstrip('/')
MAX_SESSIONS = int(os.environ.get('VOICE_MAX_SESSIONS', '2'))
_admission_lock = asyncio.Lock()


class StartRequest(BaseModel):
    access_key: str
    metadata: dict = Field(default_factory=dict)


def verify(key):
    if not key or not secrets.compare_digest(key, ACCESS_KEY):
        raise HTTPException(401, 'Unauthorized')


def lk_api():
    return api.LiveKitAPI(LK_URL, os.environ['LIVEKIT_API_KEY'], os.environ['LIVEKIT_API_SECRET'])


@app.get('/health')
async def health():
    async with lk_api() as client:
        await client.room.list_rooms(api.ListRoomsRequest())
    return {'status': 'ok', 'transport': 'livekit', 'max_sessions': MAX_SESSIONS}


@app.post('/api/start')
async def start_session(req: StartRequest):
    verify(req.access_key)
    metadata = {k: req.metadata[k] for k in ('session_id', 'channel_key', 'language', 'channel', 'greeting') if k in req.metadata}
    if not metadata.get('session_id') or not metadata.get('channel_key'):
        raise HTTPException(400, 'Session and channel are required')
    metadata.setdefault('language', 'auto')
    metadata.setdefault('channel', 'web')
    metadata.setdefault('greeting', "Hi, I'm Eva from Earthora Farms. How can I help?")
    try:
        VoiceContext.from_metadata(metadata)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if len(json.dumps(metadata)) > 4096:
        raise HTTPException(400, 'Session metadata is too large')
    room_name = f'earthora-{uuid.uuid4().hex[:16]}'
    identity = f"{metadata['channel']}-{uuid.uuid4().hex[:12]}"
    # Includes rooms waiting for their browser to join; avoids unlimited idle jobs.
    async with _admission_lock:
        async with lk_api() as client:
            rooms = await client.room.list_rooms(api.ListRoomsRequest())
            active = [r for r in rooms.rooms if r.name.startswith('earthora-') and (r.num_participants or time.time() - r.creation_time < 45)]
            if len(active) >= MAX_SESSIONS:
                raise HTTPException(429, 'Both voice lines are busy. Please try again shortly.')
            await client.room.create_room(api.CreateRoomRequest(name=room_name, metadata=json.dumps(metadata), empty_timeout=45, departure_timeout=10, max_participants=3))
    token = (api.AccessToken(os.environ['LIVEKIT_API_KEY'], os.environ['LIVEKIT_API_SECRET'])
             .with_identity(identity).with_name('Earthora caller').with_ttl(timedelta(minutes=20))
             .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=True, can_subscribe=True, can_publish_data=True)))
    return {'token': token.to_jwt(), 'url': PUBLIC_URL, 'room_name': room_name}


@app.get('/voice/stream/endpoint')
@app.post('/voice/stream/endpoint')
async def endpoint():
    return {'success': True, 'wss_url': PUBLIC_ORIGIN.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/voice/smartflo'}


class PhoneBridge:
    def __init__(self, ws):
        self.ws = ws
        self.room = rtc.Room()
        self.source = rtc.AudioSource(16000, 1, queue_size_ms=200)
        self.stream_sid = None
        self.room_name = None
        self.rate_state = None
        self.tasks = set()
        self.send_lock = asyncio.Lock()
        self.audio_epoch = 0
        self.chunk = 0
        self.closed = False
        self.pending_audio = bytearray()
        self.next_audio_at = 0.0
        self.last_audio_at = 0.0
        self.sending_audio = False
        self.ending = False
        self.end_mark = None
        self.mark_received = asyncio.Event()
        self.drop_audio = False

    def spawn(self, coro):
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def send(self, msg):
        async with self.send_lock:
            if not self.closed:
                await self.ws.send_json(msg)

    async def clear(self):
        # Serialize with a media send: no block from an earlier epoch can land
        # after the provider has received its clear command.
        async with self.send_lock:
            self.audio_epoch += 1
            self.drop_audio = True
            self.pending_audio.clear()
            self.next_audio_at = time.monotonic()
            if not self.closed:
                await self.ws.send_json({'event': 'clear', 'streamSid': self.stream_sid})

    async def send_audio(self, block, epoch):
        delay = self.next_audio_at - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        async with self.send_lock:
            if self.closed or self.drop_audio or epoch != self.audio_epoch:
                return False
            self.chunk += 1
            await self.ws.send_json({'event': 'media', 'streamSid': self.stream_sid,
                                     'media': {'payload': base64.b64encode(block).decode(), 'chunk': str(self.chunk)}})
            self.next_audio_at = max(self.next_audio_at, time.monotonic()) + len(block) / 8000
        return True

    def receive_mark(self, event):
        if (event.get('mark') or {}).get('name') == self.end_mark and self.end_mark:
            self.mark_received.set()

    async def finish_playback(self):
        if self.ending or self.closed:
            return
        self.ending = True
        # Data events and audio use different transport paths. Let the last
        # received frames settle, then wait for Smartflo's playback mark before
        # closing; closing immediately on call_end clips the final sentence.
        deadline = time.monotonic() + 30
        while not self.closed and time.monotonic() < deadline:
            if not self.sending_audio and time.monotonic() - self.last_audio_at >= 0.25:
                break
            await asyncio.sleep(0.02)
        if self.closed:
            return
        if self.pending_audio:
            block = bytes(self.pending_audio)
            self.pending_audio.clear()
            await self.send_audio(block.ljust(160, b'\xff'), self.audio_epoch)
        self.end_mark = f'earthora-end-{uuid.uuid4().hex[:12]}'
        await self.send({'event': 'mark', 'streamSid': self.stream_sid, 'mark': {'name': self.end_mark}})
        try:
            await asyncio.wait_for(self.mark_received.wait(), timeout=3)
        except asyncio.TimeoutError:
            # Paced delivery has already sent the complete audio. The timeout
            # prevents a lost provider acknowledgment keeping the line open.
            log.warning('Smartflo final playback acknowledgment timed out')
        if not self.closed:
            await self.ws.close(code=1000)

    async def start(self, event):
        start = event.get('start') or {}
        self.stream_sid = start.get('streamSid') or event.get('streamSid')
        call_id = start.get('callSid')
        fmt = start.get('mediaFormat') or {}
        encoding = str(fmt.get('encoding', 'audio/x-mulaw')).lower()
        if not self.stream_sid or not call_id or encoding not in ('audio/x-mulaw', 'mulaw', 'audio/pcmu', 'pcmu') or int(fmt.get('sampleRate', 8000)) != 8000:
            raise ValueError('Smartflo start must identify an 8 kHz mulaw stream')
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as http:
            async with http.post(API_URL + '/api/platform/voice/internal/session', headers={'Authorization': 'Bearer ' + ACCESS_KEY}, json={'channel': 'phone', 'provider_call_id': call_id, 'language': 'auto'}) as response:
                if response.status != 200:
                    raise RuntimeError(f'Phone admission failed ({response.status})')
                session = await response.json()
        self.room_name = session['room_name']

        @self.room.on('track_subscribed')
        def on_track(track, publication, participant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                self.spawn(self.outbound(track))

        @self.room.on('data_received')
        def on_data(packet):
            try:
                msg = json.loads(packet.data.decode())
            except (ValueError, UnicodeDecodeError):
                return
            if not isinstance(msg, dict) or getattr(packet, 'topic', '') != 'earthora.voice':
                return
            if msg.get('type') == 'agent_interrupted':
                self.spawn(self.clear())
            if msg.get('type') in ('agent_reply_text', 'speech_generation'):
                self.drop_audio = False
            if msg.get('type') == 'call_end':
                self.spawn(self.finish_playback())

        # Bridge uses local SFU signalling; public clients use the HTTPS URL.
        await self.room.connect(LK_URL, session['token'])
        track = rtc.LocalAudioTrack.create_audio_track('phone-microphone', self.source)
        await self.room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
        log.info('phone room connected')

    async def inbound(self, event):
        if not self.stream_sid:
            return
        if event.get('streamSid') not in (None, self.stream_sid):
            raise ValueError('Media belongs to another stream')
        media = event.get('media') or {}
        if media.get('track') == 'outbound':
            return
        raw = base64.b64decode(media.get('payload', ''), validate=True)
        if len(raw) > 64 * 1024:
            raise ValueError('Media chunk exceeds limit')
        pcm8 = audioop.ulaw2lin(raw, 2)
        pcm16, self.rate_state = audioop.ratecv(pcm8, 2, 1, 8000, 16000, self.rate_state)
        if pcm16:
            await self.source.capture_frame(rtc.AudioFrame(data=pcm16, sample_rate=16000, num_channels=1, samples_per_channel=len(pcm16)//2))

    async def outbound(self, track):
        stream = rtc.AudioStream(track, sample_rate=8000, num_channels=1)
        epoch = self.audio_epoch
        try:
            async for event in stream:
                if self.closed:
                    break
                if self.drop_audio:
                    self.pending_audio.clear()
                    continue
                if epoch != self.audio_epoch:
                    self.pending_audio.clear()
                    epoch = self.audio_epoch
                pcm = bytes(event.frame.data)
                audible = audioop.rms(pcm, 2) > 32
                if audible:
                    self.last_audio_at = time.monotonic()
                # Some receive paths continue to produce silence after playout.
                # It must not keep a completed phone call alive for 30 seconds.
                if self.ending and not audible:
                    continue
                self.pending_audio.extend(audioop.lin2ulaw(pcm, 2))
                self.sending_audio = True
                try:
                    while len(self.pending_audio) >= 160:
                        block = bytes(self.pending_audio[:160])
                        del self.pending_audio[:160]
                        if not await self.send_audio(block, epoch):
                            self.pending_audio.clear()
                            break
                finally:
                    self.sending_audio = False
        finally:
            await stream.aclose()

    async def close(self):
        self.closed = True
        tasks = tuple(task for task in self.tasks if task is not asyncio.current_task())
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.room.disconnect()
        await self.source.aclose()
        if self.room_name:
            with contextlib.suppress(Exception):
                async with lk_api() as client:
                    await client.room.delete_room(api.DeleteRoomRequest(room=self.room_name))


@app.websocket('/ws/voice/smartflo')
async def smartflo(ws: WebSocket):
    await ws.accept()
    bridge = PhoneBridge(ws)
    try:
        async with asyncio.timeout(20 * 60):
            while True:
                message = await asyncio.wait_for(ws.receive_text(), timeout=15 if not bridge.stream_sid else 90)
                if len(message) > 100_000:
                    raise ValueError('Message exceeds limit')
                event = json.loads(message)
                if not isinstance(event, dict):
                    raise ValueError('Invalid stream event')
                kind = event.get('event')
                if kind == 'start' and not bridge.stream_sid:
                    await bridge.start(event)
                elif kind == 'media':
                    await bridge.inbound(event)
                elif kind == 'stop':
                    break
                elif kind == 'mark':
                    bridge.receive_mark(event)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning('phone bridge stopped: %s', type(exc).__name__)
        with contextlib.suppress(Exception): await ws.close(code=1011)
    finally:
        await bridge.close()
