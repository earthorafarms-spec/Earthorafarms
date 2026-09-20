"""Earthora adaptation of the pinned UniExl LiveKit voice server.

See ../SOURCE.json and ../upstream/server/agent.py for the exact source.
Retains its AgentServer, prewarmed Silero, multilingual turn detection,
AgentSession, interruption guard, speech filters and verbatim-turn bridge.
Only Earthora's authenticated application may decide what the agent says.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, JobRequest, StopResponse, cli
from livekit.agents.voice import room_io
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from earthora_bridge import EarthoraBridge, VoiceContext, normalize_language
from plymaxx import PlymaxxSTT, PlymaxxTTS

load_dotenv(Path(__file__).parent / ".env")
logger = logging.getLogger("earthora.voice")
EVENT_TOPIC = "earthora.voice"
MAX_SESSIONS = max(1, int(os.getenv("VOICE_MAX_ACTIVE_SESSIONS", "2")))
_pending_jobs: dict[str, float] = {}
_admission_lock = asyncio.Lock()


def _occupied_jobs(worker: AgentServer) -> int:
    active = {item.job.id for item in worker.active_jobs}
    now = time.monotonic()
    for job_id, deadline in list(_pending_jobs.items()):
        if job_id in active or deadline <= now:
            _pending_jobs.pop(job_id, None)
    return len(active | _pending_jobs.keys())


def _worker_load(worker: AgentServer) -> float:
    return min(1.0, _occupied_jobs(worker) / MAX_SESSIONS)


server = AgentServer(
    host="127.0.0.1",
    port=int(os.getenv("VOICE_AGENT_HEALTH_PORT", "8081")),
    load_fnc=_worker_load,
    load_threshold=1.0,
    num_idle_processes=1,
)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def admit_job(request: JobRequest) -> None:
    # The worker's normal load report is periodic. Reserve pending acceptances
    # too, so simultaneous room requests cannot exceed the GPU session budget.
    async with _admission_lock:
        if _occupied_jobs(server) >= MAX_SESSIONS:
            await request.reject()
            return
        _pending_jobs[request.id] = time.monotonic() + 120
    try:
        await request.accept(name="Earthora")
    except BaseException:
        _pending_jobs.pop(request.id, None)
        raise


class RoomEvents:
    def __init__(self, room: Any):
        self.room = room
        self.tasks: set[asyncio.Task] = set()

    async def send(self, event_type: str, **payload: Any) -> None:
        try:
            await self.room.local_participant.publish_data(
                json.dumps({"type": event_type, **payload}, ensure_ascii=False).encode("utf-8"),
                reliable=True,
                topic=EVENT_TOPIC,
            )
        except Exception as error:
            # Do not log transcripts, channel credentials or provider bodies.
            logger.warning("Room event unavailable (%s)", type(error).__name__)

    def emit(self, event_type: str, **payload: Any) -> None:
        task = asyncio.create_task(self.send(event_type, **payload))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def flush(self) -> None:
        if self.tasks:
            await asyncio.gather(*tuple(self.tasks), return_exceptions=True)


_RETRY_MESSAGE = {
    "en": "I'm sorry, I couldn't complete that just now. Please try again.",
    "hi": "माफ़ कीजिए, अभी यह पूरा नहीं हो पाया। कृपया फिर से कोशिश कीजिए।",
    "gu": "માફ કરશો, અત્યારે આ પૂરું થઈ શક્યું નથી. કૃપા કરીને ફરી પ્રયત્ન કરો.",
}


class EarthoraAgent(Agent):
    def __init__(self, *, context: VoiceContext, bridge: EarthoraBridge, events: RoomEvents, stt_provider: PlymaxxSTT, tts_provider: PlymaxxTTS, end_call):
        super().__init__(
            instructions="Speak only validated responses supplied by Earthora's application.",
            tools=[],
        )
        self.context = context
        self.bridge = bridge
        self.events = events
        self.end_call = end_call
        # AgentSession may wrap batch providers in a StreamAdapter. Keep the
        # owned plugins themselves for per-turn language updates.
        self.stt_provider = stt_provider
        self.tts_provider = tts_provider
        self.language = context.language
        self.user_speech_epoch = 0
        self.turn_count = 0
        self.max_turns = max(1, int(os.getenv("VOICE_MAX_TURNS_PER_SESSION", "50")))

    def user_started_speaking(self) -> None:
        self.user_speech_epoch += 1

    async def on_enter(self) -> None:
        if self.context.greeting:
            await self.events.send("agent_reply_text", text=self.context.greeting, language=self.language)
            await self.session.say(self.context.greeting)

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        text = (getattr(new_message, "text_content", None) or "").strip()
        if not text:
            raise StopResponse()
        turn_id = uuid.uuid4().hex
        speech_epoch = self.user_speech_epoch
        self.turn_count += 1
        await self.events.send("user_transcript", text=text, transcript=text, is_final=True, turn_id=turn_id)
        await self.events.send("agent_state", state="thinking")

        # StopResponse suppresses the SDK's normal user-message insertion.
        # Keep its detector context coherent; business history stays in Node.
        context = self.chat_ctx.copy()
        context.add_message(role="user", content=text)
        await self.update_chat_ctx(context)
        started = time.monotonic()
        try:
            reply = await self.bridge.turn(
                self.context, text=text, turn_id=turn_id, language=self.language
            )
            self.language = normalize_language(reply.language, self.language)
            self.tts_provider.update_options(language=self.language)
            # Re-detect each utterance so a Gujarati response cannot pin the
            # next English turn to IndicConformer. With
            # AI_STT_REDECODE_GUJARATI=1 the adapter uses Whisper's auto-detected
            # Gujarati as a hint to re-decode that same clip once with Indic.
            self.stt_provider.update_options(language="auto")
            await self.events.send(
                "agent_reply_text", text=reply.text, language=self.language, turn_id=turn_id
            )
            # A fresh utterance while the business request was in flight should
            # not be talked over by its stale audio. The validated turn remains
            # in the application history for the following response.
            speech_interrupted = speech_epoch != self.user_speech_epoch
            if not speech_interrupted:
                speech = self.session.say(reply.text)
                await speech
                speech_interrupted = speech.interrupted or speech_epoch != self.user_speech_epoch
            if (reply.end_session and not speech_interrupted) or self.turn_count >= self.max_turns:
                self.end_call("completed" if reply.end_session else "turn_limit")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("Earthora turn failed (%s)", type(error).__name__)
            message = _RETRY_MESSAGE[self.language]
            await self.events.send("error", message=message, turn_id=turn_id)
            if speech_epoch == self.user_speech_epoch:
                try:
                    await self.session.say(message)
                except Exception as speech_error:
                    logger.warning("Failure message unavailable (%s)", type(speech_error).__name__)
        finally:
            logger.info("Earthora turn completed in %.3fs", time.monotonic() - started)
            await self.events.send("agent_state", state="listening")
        # No local LLM fallback: it could bypass product grounding or checkout.
        raise StopResponse()


@server.rtc_session(on_request=admit_job)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    events = RoomEvents(ctx.room)
    try:
        context = VoiceContext.from_metadata(json.loads(ctx.room.metadata or "{}"))
        endpoint = os.getenv(
            "EARTHORA_VOICE_TURN_URL",
            os.getenv("EARTHORA_API_URL", "http://127.0.0.1:4100").rstrip("/")
            + "/api/platform/voice/internal/turn",
        )
        internal_key = os.getenv("EARTHORA_VOICE_INTERNAL_KEY", "")
        if not internal_key:
            raise ValueError("EARTHORA_VOICE_INTERNAL_KEY is required")
        url = httpx.URL(endpoint)
        if url.scheme not in {"http", "https"} or not url.host:
            raise ValueError("Invalid Earthora turn endpoint")
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(float(os.getenv("VOICE_TURN_TIMEOUT_SECONDS", "30")), connect=5),
            follow_redirects=False,
        )
        bridge = EarthoraBridge(
            client, endpoint=endpoint, key=internal_key
        )
    except Exception as error:
        logger.error("Voice session configuration rejected (%s)", type(error).__name__)
        await events.send("error", message="Voice is temporarily unavailable. Please try again.")
        ctx.shutdown(reason="invalid_configuration")
        return

    # Same session construction and interruption protections as UniExl, with
    # GPU STT/TTS replacing provider plugins and the Earthora bridge owning LLM.
    stt_provider = PlymaxxSTT(language="auto")
    tts_provider = PlymaxxTTS(language=context.language, voice="Neha")
    session = AgentSession(
        stt=stt_provider,
        tts=tts_provider,
        llm=None,
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        min_endpointing_delay=float(os.getenv("VOICE_MIN_ENDPOINTING_DELAY", "0.4")),
        max_endpointing_delay=float(os.getenv("VOICE_MAX_ENDPOINTING_DELAY", "1.2")),
        # UniExl's streaming STT supplied interim words. Completed-utterance
        # GPU STT cannot meet a word threshold until the caller finishes, so
        # this provider uses the SDK's 0.5-second VAD guard for prompt barge-in.
        min_interruption_words=int(os.getenv("VOICE_MIN_INTERRUPT_WORDS", "0")),
        min_interruption_duration=float(os.getenv("VOICE_MIN_INTERRUPT_DURATION", "0.5")),
        resume_false_interruption=False,
        user_away_timeout=None,
        tts_text_transforms=["filter_markdown", "filter_emoji"],
        preemptive_generation=False,
    )
    closing = False

    async def finish(reason: str) -> None:
        await events.send("call_end", reason=reason)
        await session.aclose()
        ctx.shutdown(reason=reason)

    def end_call(reason: str) -> None:
        nonlocal closing
        if not closing:
            closing = True
            # Closing inside the turn callback can wait on that same callback.
            # UniExl also schedules closure outside its turn handler.
            asyncio.create_task(finish(reason))

    agent = EarthoraAgent(
        context=context, bridge=bridge, events=events,
        stt_provider=stt_provider, tts_provider=tts_provider, end_call=end_call,
    )

    @session.on("user_state_changed")
    def user_state_changed(event) -> None:
        if event.new_state == "speaking":
            agent.user_started_speaking()
        events.emit("user_state", state=event.new_state)

    @session.on("agent_state_changed")
    def agent_state_changed(event) -> None:
        events.emit("agent_state", state=event.new_state)

    async def watch_interruption(speech) -> None:
        # A user-state change is VAD onset, before the interruption-duration
        # guard. Notify phone transport only after the SDK actually interrupts
        # this speech; clearing earlier can discard speech the SDK continues.
        while not speech.done() and not speech.interrupted:
            await asyncio.sleep(0.02)
        if speech.interrupted:
            await events.send("agent_interrupted")

    @session.on("speech_created")
    def speech_created(event) -> None:
        # Covers greeting, validated business speech and failure messages.
        # This precedes provider synthesis, giving phone transport a generation
        # boundary before the next audio packets can arrive.
        events.emit("speech_generation")
        task = asyncio.create_task(watch_interruption(event.speech_handle))
        events.tasks.add(task)
        task.add_done_callback(events.tasks.discard)

    @session.on("error")
    def pipeline_error(event) -> None:
        logger.warning("Voice pipeline error (%s)", type(event.error).__name__)
        events.emit("error", message=_RETRY_MESSAGE[agent.language])

    @session.on("close")
    def session_closed(event) -> None:
        if not closing:
            events.emit("call_end", reason=str(event.reason))

    async def cleanup() -> None:
        await events.flush()
        await client.aclose()

    ctx.add_shutdown_callback(cleanup)
    room_options = {}
    if os.getenv("VOICE_NOISE_CANCELLATION", "").lower() == "bvc":
        # UniExl's optional server-side echo/background-voice filter. Enable
        # only on deployments where the LiveKit noise-cancellation service is
        # available; browser echo cancellation remains enabled independently.
        from livekit.plugins import noise_cancellation
        room_options["noise_cancellation"] = noise_cancellation.BVC()
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=room_io.RoomInputOptions(**room_options),
    )


if __name__ == "__main__":
    cli.run_app(server)
