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
from plymaxx import UnrecognizedSpeech
from conversation_controls import (DISPATCH_UNKNOWN, dispatch_schedule_missing, language_only_reply, policy_reply,
                                   trim_unsolicited_followup, turn_guidance)
from source_fact_localizations import approved_fact_reply
from browser_actions import BrowserActions
from concierge_controls import requested_destination, requested_request_type, active_request, concierge_guidance
from request_review import request_review_reply, submitted_request_reply
from request_collection import extract_request_field, request_collection_prompt, is_request_confirmation
from sunpath_runtime import (COPY, TurnState, bounded_reply, detect_language, instructions, select_knowledge,
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
                 stt_provider, tts_provider, end_call, initial_data: dict, browser_actions=None):
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
        self._clarified_speech_epoch = -1
        self.browser_actions = browser_actions
        self._blocked_review_tokens: set[str] = set()
        self._review_tokens: dict[str, tuple[str, str]] = {}
        self._request_fields_attempted: dict[str, set[str]] = {}

    def invalidate_review(self, *, request_id=None, turn_id=None):
        for key, (token, reviewed_turn) in tuple(self._review_tokens.items()):
            if key == request_id or reviewed_turn == turn_id:
                self._blocked_review_tokens.add(token)
                del self._review_tokens[key]

    def _concierge_step(self, turn):
        """Choose native actions for unambiguous answers; the API validates writes.

        No model is needed to persist a stated phone number or ask the next
        required field. Ambiguous answers and product questions remain with it.
        """
        names = {schema["name"] for schema in self.initial_data["tools"]}
        destination = requested_destination(turn.text, turn.data.get("site_guide", [])) if self.context.channel == "web" else None
        navigation_results = [r for r in turn.tool_results if r.get("name") == "navigate_site"]
        if destination and "navigate_site" in names and not navigation_results:
            return "navigate_site", {"destination_id": destination}, None
        if destination and navigation_results and navigation_results[-1].get("ok"):
            # A concrete acknowledgement cannot invent product facts after a
            # simple page-opening command. Follow-up questions stay conversational.
            label = next((d.get("label", destination) for d in turn.data.get("site_guide", []) if d.get("id") == destination), destination)
            text = {"en": f"I've opened {label}. What would you like to know about it?",
                    "hi": f"मैंने {label} खोल दिया है। इसके बारे में आप क्या जानना चाहेंगे?",
                    "gu": f"મેં {label} ખોલ્યું છે. તેના વિશે તમે શું જાણવા માંગો છો?"}[turn.language]
            return None, None, text
        draft = active_request(turn)
        kind = requested_request_type(turn.text)
        attempts = [r for r in turn.tool_results if r.get("name") in {"start_request", "set_request_field", "review_request", "submit_request"}]
        if attempts and not attempts[-1].get("ok"):
            return None, None, {"en": "I couldn't save that request detail. Please repeat it, or we can try again later.",
                                "hi": "यह request detail save नहीं हो पाई। कृपया दोबारा बताइए, या हम बाद में फिर कोशिश कर सकते हैं।",
                                "gu": "આ request ની વિગત save થઈ નથી. કૃપા કરીને ફરી કહો, અથવા આપણે પછી પ્રયત્ન કરી શકીએ."}[turn.language]
        if kind and "start_request" in names and not draft and not attempts:
            return "start_request", {"request_type": kind}, None
        if not draft or draft.get("status", "draft") != "draft":
            return None, None, None
        request_id = draft.get("request_id")
        previous_review = self._review_tokens.get(request_id)
        if previous_review and previous_review[1] != turn.id and not is_request_confirmation(turn.text):
            # A later yes must answer the request review, not an intervening
            # product question, correction or other conversation.
            self.invalidate_review(request_id=request_id)
        supplied = extract_request_field(turn.text, draft)
        consumed = self._request_fields_attempted.setdefault(turn.id, set())
        if supplied and supplied[0] not in consumed and "set_request_field" in names:
            field, value = supplied
            consumed.add(field)  # A validation failure must not loop/retry writes.
            return "set_request_field", {"request_id": request_id, "field": field, "value": value}, None
        if is_request_confirmation(turn.text) and request_id in self._review_tokens and "submit_request" in names:
            token, reviewed_turn = self._review_tokens[request_id]
            if reviewed_turn != turn.id and token not in self._blocked_review_tokens:
                return "submit_request", {"request_id": request_id, "confirmation_token": token}, None
        if attempts or supplied or kind or is_request_confirmation(turn.text):
            prompt = request_collection_prompt(draft, turn.language)
            if prompt:
                return None, None, prompt
            if "review_request" in names and not any(r.get("name") == "review_request" for r in attempts):
                return "review_request", {"request_id": request_id}, None
        return None, None, None

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
                failure = {"ok": False, "message": "Invalid or missing arguments; ask the customer to clarify."}
                turn.accept_tool(name, failure)
                return failure
            if name == "submit_request" and raw_arguments.get("confirmation_token") in self._blocked_review_tokens:
                failure = {"ok": False, "message": "The full request was not read back. Collect a shorter message and obtain a new review before confirmation."}
                turn.accept_tool(name, failure)
                return failure
            # Native tool call ID is stable for the server's idempotency boundary.
            try:
                result = await self.bridge.tool(self.context, call_id=call_id, name=name, arguments=raw_arguments)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Earthora tool failed name=%s type=%s", name, type(error).__name__)
                failure = {"ok": False, "message": "The request could not be confirmed. Do not retry a cart, checkout or callback mutation automatically; ask the customer."}
                turn.accept_tool(name, failure)
                return failure
            if name == "search_knowledge":
                turn.knowledge_search_attempted = True
                result = compact_knowledge_result(turn, result)
            if name == "review_request" and result.get("ok"):
                if turn is not self.turn or turn.speech_epoch != self.user_speech_epoch:
                    token = result.get("data", {}).get("confirmation_token")
                    if isinstance(token, str):
                        self._blocked_review_tokens.add(token)
                    failure = {"ok": False, "message": "The visitor interrupted before this review. Review current details again before any submission."}
                    turn.accept_tool(name, failure)
                    return failure
                review = request_review_reply(result, turn.language)
                if review is None or not review.ready_for_confirmation:
                    token = result.get("data", {}).pop("confirmation_token", None)
                    if isinstance(token, str):
                        self._blocked_review_tokens.add(token)
                    result.setdefault("data", {})["review_ready"] = False
                if review:
                    turn.request_speech = review.text
                    if review.ready_for_confirmation:
                        self._review_tokens[review.request_id] = (result["data"]["confirmation_token"], turn.id)
                else:
                    result = {"ok": False, "message": "The exact request details could not be reviewed. Ask the visitor to clarify; do not submit."}
            elif name == "submit_request":
                turn.request_speech = submitted_request_reply(result, turn.language)
                if result.get("ok"):
                    self.invalidate_review(request_id=raw_arguments.get("request_id"))
            elif name == "set_request_field" and result.get("ok"):
                self.invalidate_review(request_id=raw_arguments.get("request_id"))
            if name == "navigate_site" and result.get("ok"):
                navigation = result.get("data", {}).get("navigation")
                if self.context.channel != "web" or self.browser_actions is None or not isinstance(navigation, dict):
                    result = {"ok": False, "message": "Screen navigation is unavailable here. Continue helping by voice."}
                elif turn is self.turn and turn.speech_epoch == self.user_speech_epoch:
                    result = await self.browser_actions.navigate(navigation, turn_id=turn.id)
                    if result.get("ok"):
                        turn.data["current_destination"] = navigation["destination_id"]
                else:
                    result = {"ok": False, "message": "The visitor interrupted. Do not navigate for the earlier request."}
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
        if self.browser_actions:
            self.browser_actions.cancel_pending()

    def handle_recognition_error(self, error) -> bool:
        cause = getattr(error, "error", error)
        if not isinstance(cause, UnrecognizedSpeech):
            return False
        epoch = self.user_speech_epoch
        if self._clarified_speech_epoch == epoch:
            return True
        self._clarified_speech_epoch = epoch
        async def clarify():
            if epoch == self.user_speech_epoch:
                await self.say_fixed("clarify")
        task = asyncio.create_task(clarify())
        self.events.tasks.add(task)
        task.add_done_callback(self.events.tasks.discard)
        return True

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
        if not is_request_confirmation(text):
            # Do this before every early language/policy/navigation path, so a
            # later yes cannot accidentally confirm an older request review.
            for request_id in tuple(self._review_tokens):
                self.invalidate_review(request_id=request_id)
        turn_id = uuid.uuid4().hex
        self.turn_count += 1
        self.language = detect_language(text, self.language, self.detected_language)
        self.tts_provider.update_options(language=self.language)
        self.stt_provider.update_options(language="auto", language_hint=self.language)
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
            data["channel"] = self.context.channel
            if self.browser_actions:
                data["current_destination"] = self.browser_actions.destination_id
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
        knowledge = select_knowledge(turn)

        def base_context():
            base = llm.ChatContext()
            turn.visible_knowledge = []
            base.add_message(role="system", content=instructions({**turn.data, "knowledge": knowledge}, turn.language, included_knowledge=turn.visible_knowledge))
            return base

        base = base_context()
        guard = llm.ChatContext()
        guard.add_message(role="system", content=turn_guidance(turn.text, turn.language, turn.data.get("catalog", [])) + concierge_guidance(turn))
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
            acknowledgement = language_only_reply(turn.text, turn.language) or policy_reply(turn.text, turn.language) or turn.request_speech
            if not acknowledgement:
                direct_name, direct_args, acknowledgement = self._concierge_step(turn)
                if direct_name:
                    call_id = "concierge_" + uuid.uuid4().hex
                    self._tool_turns[call_id] = turn
                    yield llm.ChatChunk(id=call_id, delta=llm.ChoiceDelta(tool_calls=[llm.FunctionToolCall(
                        call_id=call_id, name=direct_name, arguments=json.dumps(direct_args))]))
                    return
            if acknowledgement:
                turn.reply_count += 1
                await self.bridge.record(self.context, message_id=f"{turn.id}:assistant:{turn.reply_count}", role="assistant", text=acknowledgement, language=turn.language)
                if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                    return
                await self.events.send("agent_reply_text", text=acknowledgement, language=turn.language, turn_id=turn.id)
                self.error_streak = 0
                yield acknowledgement
                return
            model_context = self._model_context(chat_ctx, turn, tools)
            if self.turn is not turn or turn.speech_epoch != self.user_speech_epoch:
                return
            kind = requested_request_type(turn.text)
            collecting_request = bool(kind or any(result.get("name") in {"start_request", "set_request_field", "review_request", "submit_request"} for result in turn.tool_results))
            query = None if collecting_request else knowledge_query(turn)
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
            issue = None if collecting_request else knowledge_issue(turn)
            async def no_evidence_reply():
                yield COPY[turn.language]["conflict" if issue == "conflicting-knowledge" else "knowledge"]
            async def no_dispatch_schedule_reply():
                yield DISPATCH_UNKNOWN[turn.language]
            localized_fact = approved_fact_reply(turn) if not issue and not collecting_request else None
            async def localized_fact_reply():
                yield localized_fact
            evidence = list(turn.data.get("knowledge", []))
            for result in turn.tool_results:
                if result.get("name") == "search_knowledge" and result.get("ok") and isinstance(result.get("data"), list):
                    evidence.extend(result["data"])
            missing_dispatch = dispatch_schedule_missing(turn.text, evidence)
            stream = (no_evidence_reply() if issue else localized_fact_reply() if localized_fact
                      else no_dispatch_schedule_reply() if missing_dispatch
                      else Agent.default.llm_node(self, model_context, tools, model_settings))
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
            text = trim_unsolicited_followup(normalize_spoken("".join(draft)), turn.text)
            reason = validate_reply(text, turn, request_collection=collecting_request)
            if reason:
                logger.warning("Speech guard replaced draft reason=%s", reason)
                text = COPY[turn.language]["conflict" if reason == "conflicting-knowledge" else "knowledge" if reason == "missing-knowledge" else "safe"]
            else:
                text = bounded_reply(text, request_review=any(result.get("name") == "review_request" and result.get("ok") for result in turn.tool_results))
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
            logger.warning("Native voice generation failed (%s, status=%s)", type(error).__name__, getattr(error, "status_code", None))
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
        user_away_timeout=float(os.getenv("VOICE_WEB_IDLE_SECONDS", "60") if context.channel == "web"
                                else os.getenv("VOICE_PHONE_IDLE_SECONDS", "30")),
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

    browser_actions = BrowserActions(events, caller_identity) if context.channel == "web" else None
    if browser_actions:
        ctx.room.on("data_received", browser_actions.receive)
    initial_data["channel"] = context.channel
    agent = EarthoraAgent(
        context=context, bridge=bridge, events=events,
        stt_provider=stt_provider, tts_provider=tts_provider, end_call=end_call, initial_data=initial_data,
        browser_actions=browser_actions,
    )
    lifecycle_tasks: set[asyncio.Task] = set()
    away_task: asyncio.Task | None = None

    def background(coro):
        task = asyncio.create_task(coro)
        lifecycle_tasks.add(task)
        task.add_done_callback(lifecycle_tasks.discard)
        return task

    async def away_check():
        if browser_actions and browser_actions.muted:
            return
        speech = await agent.say_fixed("away")
        await speech
        await asyncio.sleep(float(os.getenv("VOICE_WEB_IDLE_GRACE_SECONDS", "90") if context.channel == "web"
                                 else os.getenv("AWAY_GRACE_SECONDS", "20")))
        if session.user_state == "away" and not closing and not (browser_actions and browser_actions.muted):
            await agent.say_fixed("closing", reason="silence")

    async def unmuted_idle_check():
        await asyncio.sleep(float(os.getenv("VOICE_WEB_IDLE_SECONDS", "60")))
        if session.user_state == "away" and not closing and not browser_actions.muted:
            await away_check()

    def mute_changed(muted: bool):
        nonlocal away_task
        if away_task and not away_task.done():
            away_task.cancel()
        if not muted and session.user_state == "away" and not closing:
            away_task = background(unmuted_idle_check())

    if browser_actions:
        browser_actions.on_mute = mute_changed

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
        elif event.new_state == "away" and not closing and not (browser_actions and browser_actions.muted):
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
            agent.invalidate_review(turn_id=turn_id)
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
        if agent.handle_recognition_error(event.error):
            return
        logger.warning("Voice pipeline error (%s)", type(event.error).__name__)
        if agent.turn:
            agent.invalidate_review(turn_id=agent.turn.id)
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
        if browser_actions:
            browser_actions.cancel_pending()
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
    if browser_actions:
        await events.send("request_voice_state")


if __name__ == "__main__":
    cli.run_app(server)
