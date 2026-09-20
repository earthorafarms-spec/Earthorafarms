"""Native SunPath turn scheduling/guard regressions, without provider calls."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from earthora_agent import Agent, EarthoraAgent, StopResponse, llm
import earthora_agent as agent_module
from earthora_bridge import VoiceContext
from sunpath_runtime import instructions

SCHEMA = {"name": "get_cart", "description": "Read cart", "parameters": {"type": "object", "properties": {}}}
DATA = {"persona": {"name": "Eva"}, "language": "en", "catalog": [{"name": "Sample", "price": 599.5}], "knowledge": [], "tools": [SCHEMA], "history": [], "cart": [], "checkout": {}}


class PendingSpeech:
    def __init__(self):
        self.future = asyncio.get_running_loop().create_future()
        self.interrupted = False

    def __await__(self):
        return self.future.__await__()

    def finish(self, *, interrupted=False):
        self.interrupted = interrupted
        self.future.set_result(None)


class Events:
    def __init__(self):
        self.tasks = set()
        self.sent = []

    async def send(self, kind, **payload):
        self.sent.append((kind, payload))


class Bridge:
    def __init__(self):
        self.records, self.tools = [], []

    async def context(self, context):
        return DATA.copy()

    async def record(self, context, **fields):
        self.records.append(fields)

    async def tool(self, context, **fields):
        self.tools.append(fields)
        return {"ok": True, "data": {"total": 799}}


class Provider:
    def update_options(self, **options):
        pass


class Session:
    def __init__(self):
        self.speeches = []

    def say(self, text, **options):
        speech = PendingSpeech()
        self.speeches.append((text, speech))
        return speech


class AgentUnderTest(EarthoraAgent):
    @property
    def session(self):
        return self.test_session


def make_agent():
    events, bridge, closed = Events(), Bridge(), []
    agent = AgentUnderTest(context=VoiceContext("synthetic", "test-key"), bridge=bridge,
                           events=events, stt_provider=Provider(), tts_provider=Provider(),
                           end_call=closed.append, initial_data=DATA.copy())
    agent.test_session = Session()
    return agent, events, bridge, closed


async def completed_turn(agent, text="What is the price?"):
    await asyncio.wait_for(agent.on_user_turn_completed(None, SimpleNamespace(text_content=text)), timeout=0.3)


def test_hook_returns_to_native_llm_without_node_turn_callback_or_playback_wait():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        assert agent.turn.text == "What is the price?"
        assert len(bridge.records) == 1 and bridge.records[0]["role"] == "user"
        assert not agent.test_session.speeches
        assert not closed
        assert agent.turn.id == next(payload["turn_id"] for kind, payload in events.sent if kind == "user_transcript")
    asyncio.run(exercise())


@pytest.mark.parametrize("interrupted,new_speech,expected", [(False, False, ["farewell"]), (True, False, []), (False, True, [])])
def test_terminal_close_waits_for_playback_and_respects_interruption(interrupted, new_speech, expected):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        with pytest.raises(StopResponse):
            await completed_turn(agent, "goodbye")
        assert not closed
        if new_speech:
            agent.user_started_speaking()
        agent.test_session.speeches[0][1].finish(interrupted=interrupted)
        await asyncio.gather(*tuple(events.tasks))
        assert closed == expected
    asyncio.run(exercise())


@pytest.mark.parametrize("interrupted", [False, True])
def test_turn_limit_waits_for_scheduled_speech_completion(interrupted):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        agent.max_turns = 1
        with pytest.raises(StopResponse):
            await completed_turn(agent)
        assert not closed
        agent.test_session.speeches[0][1].finish(interrupted=interrupted)
        await asyncio.gather(*tuple(events.tasks))
        assert closed == ["turn_limit"]
    asyncio.run(exercise())


def test_context_failure_suppresses_generation_and_schedules_retry_without_waiting():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        async def fail(*args):
            raise RuntimeError("synthetic")
        bridge.context = fail
        with pytest.raises(StopResponse):
            await completed_turn(agent)
        assert agent.turn is None
        assert len(agent.test_session.speeches) == 1
        assert not closed
        agent.test_session.speeches[0][1].finish()
    asyncio.run(exercise())


def test_three_context_failures_close_only_after_last_retry_playback():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        async def fail(*args):
            raise RuntimeError("synthetic")
        bridge.context = fail
        for _ in range(3):
            with pytest.raises(StopResponse):
                await completed_turn(agent)
        assert agent.error_streak == 3 and not closed
        for _, speech in agent.test_session.speeches:
            speech.finish()
        await asyncio.gather(*tuple(events.tasks))
        assert closed == ["errors"]
    asyncio.run(exercise())


def test_new_speech_during_record_cancels_stale_farewell():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        async def record(*args, **kwargs):
            agent.user_started_speaking()
        bridge.record = record
        with pytest.raises(StopResponse):
            await completed_turn(agent, "goodbye")
        assert not agent.test_session.speeches and not closed
        assert not events.tasks
    asyncio.run(exercise())


@pytest.mark.parametrize("failure", ["unavailable", "timeout"])
def test_farewell_survives_unavailable_transcript_database(monkeypatch, failure):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        calls = []
        async def record(*args, **kwargs):
            calls.append(kwargs)
            if failure == "timeout":
                await asyncio.Event().wait()
            raise RuntimeError("synthetic database outage")
        bridge.record = record
        monkeypatch.setattr(agent_module, "_TERMINAL_RECORD_TIMEOUT", 0.01)
        with pytest.raises(StopResponse):
            await completed_turn(agent, "goodbye")
        assert len(calls) == 1 and len(agent.test_session.speeches) == 1
        assert not any(kind == "error" for kind, _ in events.sent)
        assert not closed
        agent.test_session.speeches[0][1].finish()
        await asyncio.gather(*tuple(events.tasks))
        assert closed == ["farewell"]
    asyncio.run(exercise())


def test_context_error_after_new_speech_does_not_talk_over_caller():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        async def fail(*args):
            agent.user_started_speaking()
            raise RuntimeError("synthetic")
        bridge.context = fail
        with pytest.raises(StopResponse):
            await completed_turn(agent)
        assert agent.error_streak == 1
        assert not agent.test_session.speeches and not closed
    asyncio.run(exercise())


@pytest.mark.parametrize("draft,expected", [
    ("The price is ₹599.50.", "The price is ₹599.50."),
    ("The price is ₹999.", "I don't have a confirmed answer"),
    ("Your order is confirmed.", "I don't have a confirmed answer"),
    ("नमस्ते! कैसे मदद करूँ?", "I don't have a confirmed answer"),
])
def test_no_text_is_yielded_until_complete_draft_is_validated(monkeypatch, draft, expected):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        parts_finished = False
        async def chunks(*args):
            nonlocal parts_finished
            yield llm.ChatChunk(id="stream", delta=llm.ChoiceDelta(content=draft[:12]))
            await asyncio.sleep(0)
            yield llm.ChatChunk(id="stream", delta=llm.ChoiceDelta(content=draft[12:]))
            parts_finished = True
        monkeypatch.setattr(Agent.default, "llm_node", chunks)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        values = []
        async for text in agent.llm_node(ctx, [], None):
            assert parts_finished
            values.append(text)
        assert len(values) == 1 and values[0].startswith(expected)
        assert bridge.records[-1]["text"] == values[0]
        event = next(payload for kind, payload in events.sent if kind == "agent_reply_text")
        assert event["turn_id"] == agent.turn.id and event["text"] == values[0]
    asyncio.run(exercise())


def test_tool_preamble_is_withheld_and_native_call_is_bound_to_its_turn(monkeypatch):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        original_turn = agent.turn
        async def chunks(*args):
            yield llm.ChatChunk(id="stream", delta=llm.ChoiceDelta(content="The price is ₹999."))
            yield llm.ChatChunk(id="stream", delta=llm.ChoiceDelta(tool_calls=[llm.FunctionToolCall(call_id="call-1", name="get_cart", arguments="{}")]))
        monkeypatch.setattr(Agent.default, "llm_node", chunks)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        values = [value async for value in agent.llm_node(ctx, [], None)]
        assert len(values) == 1 and values[0].delta.content is None
        assert agent._tool_turns["call-1"] is original_turn
        assert len(bridge.records) == 1
        await completed_turn(agent, "Another question please")
        tool = agent._make_tool(SCHEMA)
        result = await tool({}, SimpleNamespace(function_call=SimpleNamespace(call_id="call-1")))
        assert result["ok"] is False and not bridge.tools
    asyncio.run(exercise())


def test_inflight_old_tool_result_does_not_add_prices_to_new_turn():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        old_turn = agent.turn
        agent._tool_turns["old-call"] = old_turn
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(*args, **kwargs):
            entered.set()
            await release.wait()
            return {"ok": True, "data": {"total": 799}}
        bridge.tool = delayed
        tool = agent._make_tool(SCHEMA)
        pending = asyncio.create_task(tool({}, SimpleNamespace(function_call=SimpleNamespace(call_id="old-call"))))
        await entered.wait()
        await completed_turn(agent, "What about a different product?")
        release.set()
        await pending
        assert 799 in old_turn.amounts and 799 not in agent.turn.amounts
    asyncio.run(exercise())


def test_context_keeps_latest_language_after_history_and_current_tool_group():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content="ગુજરાતી પ્રશ્ન")
        ctx.add_message(role="assistant", content="ગુજરાતી જવાબ")
        ctx.add_message(role="user", content="What is the product price?")
        bounded = agent._model_context(ctx, agent.turn, [])
        assert bounded.items[-2].role == "system"
        assert "CURRENT TURN LANGUAGE: en" in bounded.items[-2].text_content
        assert bounded.items[-1].role == "user"
    asyncio.run(exercise())


def test_context_drops_old_turns_before_compacting_static_knowledge():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        agent.turn.data["knowledge"] = [{"title": "APPROVED_KB", "text": "Confirmed Earthora knowledge."}]
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content="OLD_TURN " + "history " * 3500)
        ctx.add_message(role="assistant", content="Old reply")
        ctx.add_message(role="user", content="What is the product price?")
        result = agent._model_context(ctx, agent.turn, [])
        content = " ".join(item.text_content or "" for item in result.items)
        assert "OLD_TURN" not in content and "APPROVED_KB" in content
        assert result.items[-1].text_content == "What is the product price?"
    asyncio.run(exercise())


def test_large_current_tool_chain_compacts_only_kb_and_preserves_call_result_pairs():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        agent.turn.data = {**DATA, "catalog": [{"id": "CANONICAL_CATALOG", "price": 599.5}],
                           "cart": [{"productId": "CURRENT_CART", "quantity": 2}],
                           "knowledge": [{"title": f"STATIC_KB_ENTRY_{i}", "text": "approved fact " * 95} for i in range(20)]}
        initial_prompt = instructions(agent.turn.data, "en")
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content="OLD_TURN")
        ctx.add_message(role="assistant", content="Old response")
        ctx.add_message(role="user", content="What is my cart total?")
        original = []
        for i in range(3):
            call = llm.FunctionCall(id=f"item_call_{i}", call_id=f"call_{i}", name="get_cart", arguments="{}")
            output = llm.FunctionCallOutput(id=f"item_output_{i}", call_id=f"call_{i}", name="get_cart", output=f"CURRENT_RESULT_{i} " + "facts " * 650, is_error=False)
            ctx.items.extend([call, output])
            original.extend([call, output])
        result = agent._model_context(ctx, agent.turn, [])
        prompt = result.items[0].text_content
        assert prompt.count("STATIC_KB_ENTRY_") < initial_prompt.count("STATIC_KB_ENTRY_")
        assert "CANONICAL_CATALOG" in prompt and "CURRENT_CART" in prompt
        assert not any("OLD_TURN" in (getattr(item, "text_content", "") or "") for item in result.items)
        chain = [item for item in result.items if item.type in {"function_call", "function_call_output"}]
        assert chain == original
        assert [(item.type, item.call_id) for item in chain] == [pair for i in range(3) for pair in (("function_call", f"call_{i}"), ("function_call_output", f"call_{i}"))]
    asyncio.run(exercise())


def test_new_speech_during_generation_prevents_stale_reply(monkeypatch):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent)
        async def chunks(*args):
            agent.user_started_speaking()
            yield "The price is ₹599.50."
        monkeypatch.setattr(Agent.default, "llm_node", chunks)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        assert [value async for value in agent.llm_node(ctx, [], None)] == []
        assert len(bridge.records) == 1
    asyncio.run(exercise())


SEARCH_SCHEMA = {"name": "search_knowledge", "description": "Read approved knowledge", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}


def test_missing_gujarati_evidence_executes_one_native_search_before_any_model_or_audio(monkeypatch):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        agent.initial_data = {**DATA, "tools": [SEARCH_SCHEMA]}
        await completed_turn(agent, "Sample કેવી રીતે વાપરવું?")
        model_calls = []
        async def model(*args):
            model_calls.append(True)
            yield "દરરોજ 1 tablet લો."
        monkeypatch.setattr(Agent.default, "llm_node", model)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        chunks = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        assert len(chunks) == 1 and not model_calls
        call = chunks[0].delta.tool_calls[0]
        assert call.name == "search_knowledge" and json.loads(call.arguments) == {"query": "Sample usage directions"}
        assert not chunks[0].delta.content and len(bridge.records) == 1
        async def search(*args, **kwargs):
            bridge.tools.append(kwargs)
            return {"ok": True, "data": [{"title": "Sample", "text": "Suggested use: Take 1 tablet daily."}]}
        bridge.tool = search
        result = await agent._make_tool(SEARCH_SCHEMA)(json.loads(call.arguments), SimpleNamespace(function_call=call))
        assert json.loads(result)["ok"] and len(bridge.tools) == 1
        result = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        assert result == ["દરરોજ 1 tablet લો."] and len(model_calls) == 1
        assert bridge.records[-1]["text"] == result[0]
    asyncio.run(exercise())


@pytest.mark.parametrize("failed", [False, True])
def test_missing_or_failed_search_never_repeats_or_generates_ungrounded_audio(monkeypatch, failed):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        agent.initial_data = {**DATA, "tools": [SEARCH_SCHEMA]}
        await completed_turn(agent, "How should I take Sample?")
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        emitted = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        call = emitted[0].delta.tool_calls[0]
        async def search(*args, **kwargs):
            return {"ok": not failed, "data": []}
        bridge.tool = search
        await agent._make_tool(SEARCH_SCHEMA)(json.loads(call.arguments), SimpleNamespace(function_call=call))
        async def unexpected(*args):
            raise AssertionError("Missing evidence must not reach generation")
            yield "unreachable"
        monkeypatch.setattr(Agent.default, "llm_node", unexpected)
        result = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        assert result == [agent_module.COPY["en"]["knowledge"]]
        assert not any(kind == "error" for kind, _ in events.sent)
    asyncio.run(exercise())


def test_conflicting_directions_are_explained_before_any_inference_or_audio(monkeypatch):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent, "How should I take Sample?")
        agent.turn.data["knowledge"] = [{"title": "Sample", "text": "Take 1 tablet daily."}, {"title": "Sample FAQ", "text": "Take 4 tablets daily."}]
        async def unexpected(*args):
            raise AssertionError("Conflicting doses must not reach generation")
            yield "unreachable"
        monkeypatch.setattr(Agent.default, "llm_node", unexpected)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        result = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        assert result == [agent_module.COPY["en"]["conflict"]]
        assert bridge.records[-1]["text"] == result[0]
        assert not any(kind == "error" for kind, _ in events.sent)
    asyncio.run(exercise())


def test_unrecognized_speech_clarifies_once_per_utterance_without_retrying_tts_errors():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        failure = agent_module.UnrecognizedSpeech("synthetic unsupported speech", retryable=False)
        assert agent.handle_recognition_error(SimpleNamespace(error=failure))
        assert agent.handle_recognition_error(failure)
        await asyncio.gather(*tuple(events.tasks))
        assert [text for text, _ in agent.test_session.speeches] == [agent_module.COPY["en"]["clarify"]]
        assert not agent.handle_recognition_error(RuntimeError("synthetic TTS error"))
        assert not closed and not bridge.records
        agent.user_started_speaking()
        assert agent.handle_recognition_error(failure)
        await asyncio.gather(*tuple(events.tasks))
        assert len(agent.test_session.speeches) == 2
        for _, speech in agent.test_session.speeches:
            speech.finish()
    asyncio.run(exercise())


def test_later_speech_cancels_queued_recognition_clarification():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        assert agent.handle_recognition_error(agent_module.UnrecognizedSpeech("synthetic", retryable=False))
        agent.user_started_speaking()
        await asyncio.gather(*tuple(events.tasks))
        assert not agent.test_session.speeches
    asyncio.run(exercise())


def test_installed_sdk_keeps_session_open_for_recoverable_recognition_miss():
    from livekit.agents import AgentSession, APIConnectionError, stt
    async def exercise():
        agent, events, bridge, closed = make_agent()
        sdk_session = AgentSession()
        error = stt.STTError(timestamp=0, label="synthetic", recoverable=True,
                             error=agent_module.UnrecognizedSpeech("synthetic unsupported speech", retryable=False))
        # This is the actual installed 1.3.12 error policy, not a copied stub
        # or a monkeypatch. AgentActivity emits to our handler before this call.
        assert agent.handle_recognition_error(error)
        sdk_session._on_error(error)
        assert sdk_session._closing_task is None
        await asyncio.gather(*tuple(events.tasks))
        assert len(agent.test_session.speeches) == 1 and not closed
        agent.test_session.speeches[0][1].finish()
        ordinary = stt.STTError(timestamp=0, label="synthetic", recoverable=False,
                                error=APIConnectionError("ordinary transport failure", retryable=False))
        assert not agent.handle_recognition_error(ordinary)
        assert not ordinary.recoverable
        await sdk_session.aclose()
    asyncio.run(exercise())


def test_current_explicit_language_sets_hint_without_disabling_auto_stt():
    async def exercise():
        agent, events, bridge, closed = make_agent()
        options = []
        agent.stt_provider = SimpleNamespace(update_options=lambda **kwargs: options.append(kwargs))
        await completed_turn(agent, "कैन यू स्पीक गुजराती")
        assert agent.turn.language == "gu"
        assert options == [{"language": "auto", "language_hint": "gu"}]
    asyncio.run(exercise())


@pytest.mark.parametrize("question,answer", [
    ("What is your delivery policy?", "Orders are delivered across India."),
    ("How do I use checkout?", "I can help you review your cart before checkout."),
    ("મારે આ લેવું છે.", "તમને કેટલી બોટલ જોઈએ છે?"),
])
def test_non_dosage_intent_reaches_native_model_despite_unrelated_dose_conflict(monkeypatch, question, answer):
    async def exercise():
        agent, events, bridge, closed = make_agent()
        await completed_turn(agent, question)
        agent.turn.data["knowledge"] = [
            {"title": "Sample", "text": "Take 1 tablet daily."},
            {"title": "Sample FAQ", "text": "Take 4 tablets daily."},
            {"title": "Shipping", "text": "Orders are delivered across India. Free shipping."},
        ]
        invoked = []
        async def model(*args):
            invoked.append(True)
            yield answer
        monkeypatch.setattr(Agent.default, "llm_node", model)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=question)
        result = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        assert invoked and result == [answer]
    asyncio.run(exercise())
