"""Earthora native LiveKit agent adapted from MSH SunPath agent/main.py.

SunPath supplies the provider-builder/tool/lifecycle pattern; Earthora supplies
its own authenticated facts and business tools. All inference uses the GPU.
Generated text is checked before it can reach speech synthesis.
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
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, JobRequest, StopResponse, RunContext, function_tool, llm, cli
from livekit.agents.voice import room_io
from livekit.agents.voice.agent_session import SessionConnectOptions
from livekit.agents.types import APIConnectOptions
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from earthora_bridge import VoiceContext
from sunpath_bridge import SunPathBridge
from sunpath_config import build_llm, build_stt, build_tts
from sunpath_runtime import (COPY, TurnState, bounded_reply, detect_language, instructions,
                             is_farewell, normalize_spoken, token_estimate, validate_arguments, validate_reply,
                             validated_caller_identity, compact_knowledge_result, knowledge_issue, knowledge_query)

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


_RETRY_MESSAGE = {language: copy["retry"] for language, copy in COPY.items()}
_TERMINAL_RECORD_TIMEOUT = 1.0


class EarthoraAgent(Agent):
    def __init__(self, *, context: VoiceContext, bridge: SunPathBridge, events: RoomEvents,
                 stt_provider, tts_provider, end_call, initial_data: dict):
        history = llm.ChatContext()
        for item in initial_data.get("history", [])[-8:]:
            if item.get("role") in {"user", "assistant"} and isinstance(item.get("content"), str):
                history.add_message(role=item["role"], content=item["content"][:2000])
        super().__init__(instructions=instructions(initial_data, context.language), chat_ctx=history,
                         tools=[self._make_tool(schema) for schema in initial_data["tools"]])
        self.context, self.bridge, self.events, self.end_call = context, bridge, events, end_call
        self.stt_provider, self.tts_provider = stt_provider, tts_provider
        self.language = context.language
        self.detected_language = context.language
        self.user_speech_epoch = 0
        self.turn_count = 0
        self.max_turns = max(1, int(os.getenv("VOICE_MAX_TURNS_PER_SESSION", "50")))
        self.turn: TurnState | None = None
        self.initial_data = initial_data
        self.error_streak = 0
        self._tool_turns: dict[str, TurnState] = {}
        self.terminal_turn_id: str | None = None

    def _make_tool(self, schema: dict):
        name = schema["name"]

        async def execute(raw_arguments: dict[str, object], context: RunContext):
            call_id = getattr(context.function_call, "call_id", None) or context.function_call.id
            turn = self._tool_turns.get(call_id)
            if turn is None or turn is not self.turn or turn.speech_epoch != self.user_speech_epoch:
                return {"ok": False, "message": "The customer interrupted; wait for the latest request."}
            try:
                validate_arguments(raw_arguments, schema["parameters"])
            except ValueError:
                return {"ok": False, "message": "Invalid or missing arguments; ask the customer to clarify."}
            # Native tool call ID is stable for the server's idempotency boundary.
            try:
                result = await self.bridge.tool(self.context, call_id=call_id, name=name, arguments=raw_arguments)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Earthora tool failed name=%s type=%s", name, type(error).__name__)
                return {"ok": False, "message": "The request could not be confirmed. Do not retry a cart, checkout or callback mutation automatically; ask the customer."}
            if name == "search_knowledge":
                turn.knowledge_search_attempted = True
                result = compact_knowledge_result(turn, result)
            # No filler speech here: it adds a second expensive GPU TTS request.
            # The whole successful result remains available to the accuracy gate.
            text = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
            if len(text) > 5000:
                result = {"ok": False, "message": "Result too large; ask a more specific question."}
                text = json.dumps(result)
            turn.accept_tool(name, result)
            return text

        return function_tool(execute, raw_schema=schema)

    def user_started_speaking(self) -> None:
        self.user_speech_epoch += 1

    async def stt_node(self, audio, model_settings):
        async for event in Agent.default.stt_node(self, audio, model_settings):
            if getattr(event, "alternatives", None):
                language = event.alternatives[0].language.split("-")[0]
                if language in COPY:
                    self.detected_language = language
            yield event

    async def on_enter(self) -> None:
        # Deterministic greeting, like SunPath's exact greeting script, requires
        # no LLM request and contains no product or payment claims.
        text = COPY[self.language]["greeting"]
        await self.events.send("agent_reply_text", text=text, language=self.language)
        self.session.say(text)

    def _finish_after_speech(self, speech, *, speech_epoch: int, reason: str) -> None:
        async def finish() -> None:
            try:
                await speech
                interrupted = speech.interrupted or speech_epoch != self.user_speech_epoch
                if reason in {"turn_limit", "session_limit", "errors"} or not interrupted:
                    self.end_call(reason)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Terminal speech unavailable (%s)", type(error).__name__)
                self.end_call(reason)
        task = asyncio.create_task(finish())
        self.events.tasks.add(task)
        task.add_done_callback(self.events.tasks.discard)

    async def say_fixed(self, kind: str, *, reason: str | None = None, turn_id: str | None = None):
        text = COPY[self.language][kind]
        await self.events.send("agent_reply_text", text=text, language=self.language, **({"turn_id": turn_id} if turn_id else {}))
        speech = self.session.say(text, allow_interruptions=reason not in {"session_limit", "errors"})
        if reason:
            self._finish_after_speech(speech, speech_epoch=self.user_speech_epoch, reason=reason)
        return speech

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        text = (getattr(new_message, "text_content", None) or "").strip()
        if not text:
            raise StopResponse()
        turn_id = uuid.uuid4().hex
        self.turn_count += 1
        self.language = detect_language(text, self.language, self.detected_language)
        self.tts_provider.update_options(language=self.language)
        self.stt_provider.update_options(language="auto")
        await self.events.send("user_transcript", text=text, transcript=text, is_final=True, turn_id=turn_id)
        await self.events.send("agent_state", state="thinking")
        speech_epoch = self.user_speech_epoch
        self.turn = None
        self._tool_turns.clear()
        try:
            terminal_reason = "turn_limit" if self.turn_count >= self.max_turns else "farewell" if is_farewell(text) else None
            if terminal_reason:
                # Ending a call must not depend on the transcript database.
                # A timeout may still have persisted this stable message ID;
                # do not retry it or delay the caller's requested goodbye.
                try:
                    await asyncio.wait_for(self.bridge.record(self.context, message_id=turn_id + ":user", role="user", text=text, language=self.language), timeout=_TERMINAL_RECORD_TIMEOUT)
                except Exception as error:
                    logger.warning("Terminal transcript unavailable (%s)", type(error).__name__)
            else:
                await self.bridge.record(self.context, message_id=turn_id + ":user", role="user", text=text, language=self.language)
            if speech_epoch != self.user_speech_epoch:
                raise StopResponse()
            if terminal_reason:
                await self.say_fixed("closing", reason=terminal_reason, turn_id=turn_id)
                raise StopResponse()
            data = await self.bridge.context(self.context)
            if speech_epoch != self.user_speech_epoch:
                raise StopResponse()
            self.turn = TurnState(turn_id, self.language, text, speech_epoch, data)
            # Return normally: AgentSession inserts the user message and runs
            # its own LLM -> native tools -> LLM -> TTS loop.
        except (StopResponse, asyncio.CancelledError):
            raise
        except Exception as error:
            logger.warning("Earthora context unavailable (%s)", type(error).__name__)
            self.error_streak += 1
            await self.events.send("error", message=_RETRY_MESSAGE[self.language], turn_id=turn_id)
            if speech_epoch == self.user_speech_epoch:
                await self.say_fixed("retry", turn_id=turn_id, reason="errors" if self.error_streak >= 3 else None)
            elif self.error_streak >= 3:
                self.end_call("errors")
            raise StopResponse()

    def _model_context(self, chat_ctx, turn: TurnState, tools):
        # Keep complete user/tool groups. Never chop a function result away
        # from its function call or rely on the GPU server's silent truncation.
        source = chat_ctx.copy(exclude_instructions=True).items
        groups = []
        for item in source:
            if not groups or (item.type == "message" and item.role == "user"):
                groups.append([])
            groups[-1].append(item)
        groups = groups[-5:]
        # Keep the authoritative live catalogue/cart and current native tool
        # chain intact. Static KB is the only evidence we may compact later.
        knowledge = list(turn.data.get("knowledge", []))

        def base_context():
            base = llm.ChatContext()
            turn.visible_knowledge = []
            base.add_message(role="system", content=instructions({**turn.data, "knowledge": knowledge}, turn.language, included_knowledge=turn.visible_knowledge))
            return base

        base = base_context()
        guard = llm.ChatContext()
        guard.add_message(role="system", content=f"CURRENT TURN LANGUAGE: {turn.language}. This overrides all prior conversation language. Answer only the latest customer question, using the current Earthora facts and successful tools.")
        schema_cost = token_estimate(json.dumps(self.initial_data["tools"], ensure_ascii=False)) + 600
        while True:
            items = list(base.items)
            for index, group in enumerate(groups):
                if index == len(groups) - 1:
                    items.extend(guard.items)
                items.extend(group)
            estimate = schema_cost + sum(token_estimate(item.model_dump_json()) for item in items)
            if estimate <= 7600:
                return llm.ChatContext(items)
            if len(groups) > 1:
                groups.pop(0)
            elif knowledge:
                knowledge.pop()
                base = base_context()
            else:
                raise ValueError("Current voice context exceeds the GPU context window")

    async def llm_node(self, chat_ctx, tools, model_settings):
        turn = self.turn
        if turn is None:
            return
        draft, has_tools = [], False
        try:
            model_context = self._model_context(chat_ctx, turn, tools)
            if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                return
            query = knowledge_query(turn)
            if query and any(schema["name"] == "search_knowledge" for schema in self.initial_data["tools"]):
                # Missing facts are a deterministic retrieval prerequisite in
                # every language. AgentSession executes the SAME native tool
                # handler, call-ID binding and authenticated API validation.
                turn.knowledge_search_attempted = True
                call_id = "knowledge_" + uuid.uuid4().hex
                self._tool_turns[call_id] = turn
                yield llm.ChatChunk(id=call_id, delta=llm.ChoiceDelta(tool_calls=[llm.FunctionToolCall(
                    call_id=call_id, name="search_knowledge", arguments=json.dumps({"query": query}))]))
                return
            issue = knowledge_issue(turn)
            async def no_evidence_reply():
                yield COPY[turn.language]["conflict" if issue == "conflicting-knowledge" else "knowledge"]
            stream = no_evidence_reply() if issue else Agent.default.llm_node(self, model_context, tools, model_settings)
            async for chunk in stream:
                if isinstance(chunk, str):
                    draft.append(chunk)
                elif isinstance(chunk, llm.ChatChunk) and chunk.delta:
                    if chunk.delta.content:
                        draft.append(chunk.delta.content)
                    if chunk.delta.tool_calls:
                        if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                            return
                        has_tools = True
                        for call in chunk.delta.tool_calls:
                            call_id = getattr(call, "call_id", None) or call.id
                            self._tool_turns[call_id] = turn
                        # Forward native tools but withhold ALL text until final
                        # validation. A price can span multiple stream chunks.
                        yield llm.ChatChunk(id=chunk.id, delta=llm.ChoiceDelta(role=chunk.delta.role, tool_calls=chunk.delta.tool_calls))
                if sum(map(len, draft)) > 8000:
                    raise ValueError("Voice completion exceeds the speech limit")
            if has_tools:
                return  # AgentSession continues with the native tool results.
            if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                return
            text = normalize_spoken("".join(draft))
            reason = validate_reply(text, turn)
            if reason:
                logger.warning("Speech guard replaced draft reason=%s", reason)
                text = COPY[turn.language]["conflict" if reason == "conflicting-knowledge" else "knowledge" if reason == "missing-knowledge" else "safe"]
            else:
                text = bounded_reply(text)
            turn.reply_count += 1
            await self.bridge.record(self.context, message_id=f"{turn.id}:assistant:{turn.reply_count}", role="assistant", text=text, language=turn.language)
            if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                return
            await self.events.send("agent_reply_text", text=text, language=turn.language, turn_id=turn.id)
            self.error_streak = 0
            yield text  # First text reaching TTS is already fully validated.
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.warning("Native voice generation failed (%s)", type(error).__name__)
            if self.turn is turn and turn.speech_epoch == self.user_speech_epoch:
                self.error_streak += 1
                await self.events.send("error", message=_RETRY_MESSAGE[turn.language], turn_id=turn.id)
                await self.events.send("agent_reply_text", text=_RETRY_MESSAGE[turn.language], language=turn.language, turn_id=turn.id)
                if self.error_streak >= 3:
                    speech = getattr(self.session, "current_speech", None)
                    if speech is not None:
                        self._finish_after_speech(speech, speech_epoch=self.user_speech_epoch, reason="errors")
                    else:
                        self.terminal_turn_id = turn.id
                yield _RETRY_MESSAGE[turn.language]


@server.rtc_session(agent_name=os.getenv("VOICE_AGENT_NAME", "earthora-sunpath"), on_request=admit_job)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    events = RoomEvents(ctx.room)
    client = None
    try:
        metadata = json.loads(ctx.room.metadata or "{}")
        context = VoiceContext.from_metadata(metadata)
        caller_identity = validated_caller_identity(metadata, context.channel)
        old_endpoint = os.getenv("EARTHORA_VOICE_TURN_URL", "")
        endpoint = os.getenv("EARTHORA_VOICE_DATA_URL", "") or (
            old_endpoint.rsplit("/", 1)[0] if old_endpoint else
            os.getenv("EARTHORA_API_URL", "http://127.0.0.1:4100").rstrip("/") + "/api/platform/voice/internal"
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
        bridge = SunPathBridge(
            client, endpoint=endpoint, key=internal_key
        )
        initial_data = await bridge.context(context)
        llm_provider = build_llm()
        stt_provider = build_stt()
        tts_provider = build_tts(context.language)
    except Exception as error:
        logger.error("Voice session configuration rejected (%s)", type(error).__name__)
        await events.send("error", message="Voice is temporarily unavailable. Please try again.")
        if client is not None:
            await client.aclose()
        ctx.shutdown(reason="invalid_configuration")
        return

    # SunPath's native AgentSession pipeline with GPU-only provider builders.
    session = AgentSession(
        stt=stt_provider,
        tts=tts_provider,
        llm=llm_provider,
        vad=ctx.proc.userdata["vad"],
        turn_detection=MultilingualModel(),
        min_endpointing_delay=float(os.getenv("VOICE_MIN_ENDPOINTING_DELAY", "0.3")),
        max_endpointing_delay=float(os.getenv("VOICE_MAX_ENDPOINTING_DELAY", "2.5")),
        # SunPath's streaming STT supplied interim words. Completed-utterance
        # GPU STT cannot meet a word threshold until the caller finishes, so
        # this provider uses the SDK's 0.5-second VAD guard for prompt barge-in.
        min_interruption_words=int(os.getenv("VOICE_MIN_INTERRUPT_WORDS", "0")),
        min_interruption_duration=float(os.getenv("VOICE_MIN_INTERRUPT_DURATION", "0.5")),
        resume_false_interruption=False,
        user_away_timeout=float(os.getenv("USER_AWAY_TIMEOUT", "10")),
        max_tool_steps=6,
        conn_options=SessionConnectOptions(llm_conn_options=APIConnectOptions(max_retry=0, timeout=20)),
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
            # Closure runs outside the turn handler to avoid awaiting itself.
            asyncio.create_task(finish(reason))

    agent = EarthoraAgent(
        context=context, bridge=bridge, events=events,
        stt_provider=stt_provider, tts_provider=tts_provider, end_call=end_call, initial_data=initial_data,
    )
    lifecycle_tasks: set[asyncio.Task] = set()
    away_task: asyncio.Task | None = None

    def background(coro):
        task = asyncio.create_task(coro)
        lifecycle_tasks.add(task)
        task.add_done_callback(lifecycle_tasks.discard)
        return task

    async def away_check():
        speech = await agent.say_fixed("away")
        await speech
        await asyncio.sleep(float(os.getenv("AWAY_GRACE_SECONDS", "10")))
        if session.user_state == "away" and not closing:
            await agent.say_fixed("closing", reason="silence")

    async def cap_session():
        await asyncio.sleep(float(os.getenv("MAX_SESSION_SECONDS", "900")))
        if not closing:
            await agent.say_fixed("closing", reason="session_limit")

    background(cap_session())

    @session.on("user_state_changed")
    def user_state_changed(event) -> None:
        nonlocal away_task
        if event.new_state == "speaking":
            agent.user_started_speaking()
            if away_task and not away_task.done():
                away_task.cancel()
        elif event.new_state == "away" and not closing:
            if not away_task or away_task.done():
                away_task = background(away_check())
        events.emit("user_state", state=event.new_state)

    @session.on("agent_state_changed")
    def agent_state_changed(event) -> None:
        events.emit("agent_state", state=event.new_state)

    async def watch_interruption(speech, turn_id: str | None) -> None:
        # A user-state change is VAD onset, before the interruption-duration
        # guard. Notify phone transport only after the SDK actually interrupts
        # this speech; clearing earlier can discard speech the SDK continues.
        while not speech.done() and not speech.interrupted:
            await asyncio.sleep(0.02)
        if speech.interrupted:
            await events.send("agent_interrupted")
        await speech
        if turn_id and agent.terminal_turn_id == turn_id:
            end_call("errors")

    @session.on("speech_created")
    def speech_created(event) -> None:
        # Covers greeting, validated business speech and failure messages.
        # This precedes provider synthesis, giving phone transport a generation
        # boundary before the next audio packets can arrive.
        events.emit("speech_generation")
        task = asyncio.create_task(watch_interruption(event.speech_handle, agent.turn.id if agent.turn else None))
        events.tasks.add(task)
        task.add_done_callback(events.tasks.discard)

    @session.on("error")
    def pipeline_error(event) -> None:
        logger.warning("Voice pipeline error (%s)", type(event.error).__name__)
        events.emit("error", message=_RETRY_MESSAGE[agent.language])
        agent.error_streak += 1
        # A failed TTS cannot reliably speak its own error. Do not recurse into
        # an unlimited retry loop; leave the event visible and close on strike 3.
        if agent.error_streak >= 3:
            end_call("errors")

    @session.on("close")
    def session_closed(event) -> None:
        if not closing:
            events.emit("call_end", reason=str(event.reason))

    async def cleanup() -> None:
        for task in tuple(lifecycle_tasks):
            task.cancel()
        await asyncio.gather(*tuple(lifecycle_tasks), return_exceptions=True)
        # Job shutdown can arrive while a speech handle is still pending.
        # Close the session before joining its playback observers.
        await session.aclose()
        try:
            await asyncio.wait_for(events.flush(), timeout=5)
        except asyncio.TimeoutError:
            for task in tuple(events.tasks):
                task.cancel()
            await asyncio.gather(*tuple(events.tasks), return_exceptions=True)
        await client.aclose()

    ctx.add_shutdown_callback(cleanup)
    room_options = {"participant_identity": caller_identity}
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
