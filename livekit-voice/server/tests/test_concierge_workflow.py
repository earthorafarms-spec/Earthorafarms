"""Native SDK agent/tool lifecycle with an in-memory API boundary, no inference/mail."""
import asyncio
import copy
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_agent_scheduling import AgentUnderTest, Events, Provider, Session, DATA, completed_turn
from earthora_agent import Agent, llm
from earthora_bridge import VoiceContext
from browser_actions import BrowserActions


def schema(name, **properties):
    return {"name": name, "description": "Synthetic lifecycle check", "parameters": {
        "type": "object", "properties": {key: {"type": "string"} for key in properties},
        "required": list(properties), "additionalProperties": False}}


SCHEMAS = [schema("start_request", request_type=1), schema("set_request_field", request_id=1, field=1, value=1),
           schema("review_request", request_id=1), schema("submit_request", request_id=1, confirmation_token=1),
           schema("navigate_site", destination_id=1)]
GUIDE = [{"id": "our_story", "label": "Our story", "path": "/our-story", "anchor": None}]
REQUEST_ID = "00000000-0000-4000-8000-000000000001"


class WorkflowEvents(Events):
    def emit(self, kind, **payload):
        self.sent.append((kind, payload))


class RequestBridge:
    """Only models API state; production transaction correctness is tested in Node."""
    def __init__(self, *, existing=False):
        self.draft = self.new_draft("callback") if existing else None
        self.records, self.tools = [], []
        self.fail_name = None
        self.failure_mode = "raise"
        self.review_number = 0

    def new_draft(self, kind):
        return {"request_id": REQUEST_ID, "request_type": kind, "status": "draft", "revision": 0,
                "fields": {}, "required_fields": ["name", "phone", "reason"] if kind == "callback" else ["name", "email", "message"]}

    async def context(self, context):
        return {**copy.deepcopy(DATA), "tools": SCHEMAS, "request_drafts": [copy.deepcopy(self.draft)] if self.draft else [],
                "site_guide": copy.deepcopy(GUIDE), "channel": context.channel}

    async def record(self, context, **fields):
        self.records.append(copy.deepcopy(fields))

    async def tool(self, context, **call):
        self.tools.append(copy.deepcopy(call))
        name, args = call["name"], call["arguments"]
        if name == self.fail_name:
            if self.failure_mode == "raise":
                raise RuntimeError("Synthetic API failure; no external write")
            return {"ok": False, "message": "Synthetic validation refusal"}
        if name == "start_request":
            self.draft = self.new_draft(args["request_type"])
        elif name == "set_request_field":
            value = args["value"]
            if args["field"] == "phone":
                digits = re.sub(r"\D", "", value)
                value = "+91" + digits if len(digits) == 10 else "+" + digits
            self.draft["fields"][args["field"]] = value
            self.draft["revision"] += 1
        elif name == "review_request":
            assert all(self.draft["fields"].get(field) for field in self.draft["required_fields"])
            self.review_number += 1
            return {"ok": True, "data": {**copy.deepcopy(self.draft), "confirmation_token": f"{self.review_number:048x}"}}
        elif name == "submit_request":
            self.draft["status"] = "submitted"
            result = {"request_id": REQUEST_ID, "request_type": self.draft["request_type"], "recorded": True,
                      "notification_queued": True, "notification_status": "queued"}
            self.draft["submission"] = result
            return {"ok": True, "data": result}
        elif name == "navigate_site":
            return {"ok": True, "data": {"navigation": {"destination_id": "our_story", "label": "Our story", "path": "/our-story", "anchor": None}}}
        return {"ok": True, "data": copy.deepcopy(self.draft)}


def make_workflow(*, existing=False):
    bridge, events, closed = RequestBridge(existing=existing), WorkflowEvents(), []
    initial = {**copy.deepcopy(DATA), "tools": SCHEMAS, "site_guide": GUIDE}
    browser = BrowserActions(events, "synthetic-web-caller")
    agent = AgentUnderTest(context=VoiceContext("synthetic-workflow", "test-key"), bridge=bridge, events=events,
                           stt_provider=Provider(), tts_provider=Provider(), end_call=closed.append,
                           initial_data=initial, browser_actions=browser)
    agent.test_session = Session()
    return agent, bridge, events


async def execute_call(agent, call):
    definition = next(item for item in SCHEMAS if item["name"] == call.name)
    result = await agent._make_tool(definition)(json.loads(call.arguments), SimpleNamespace(function_call=SimpleNamespace(call_id=call.call_id)))
    return json.loads(result) if isinstance(result, str) else result


async def drive_turn(agent, text):
    await completed_turn(agent, text)
    ctx = llm.ChatContext()
    ctx.add_message(role="user", content=text)
    for _ in range(10):
        output = [item async for item in agent.llm_node(ctx, [], None)]
        calls = [call for item in output if isinstance(item, llm.ChatChunk) and item.delta for call in (item.delta.tool_calls or [])]
        if not calls:
            return output
        for call in calls:
            result = await execute_call(agent, call)
            ctx = llm.ChatContext(items=[*ctx.items,
                llm.FunctionCall(id="item_" + call.call_id, call_id=call.call_id, name=call.name, arguments=call.arguments),
                llm.FunctionCallOutput(id="output_" + call.call_id, call_id=call.call_id, name=call.name, output=json.dumps(result), is_error=not result.get("ok"))])
    pytest.fail("Native concierge loop repeated actions without reaching a spoken response")


@pytest.fixture
def forbid_model(monkeypatch):
    calls = []
    async def unexpected(*args):
        calls.append(True)
        raise AssertionError("Clear form collection must not call the model")
        yield
    monkeypatch.setattr(Agent.default, "llm_node", unexpected)
    return calls


async def complete_callback(agent):
    first = await drive_turn(agent, "I want your team to call me about buying for my shop.")
    second = await drive_turn(agent, "My name is Asha Patel.")
    third = await drive_turn(agent, "My phone number is 9000000000.")
    return first, second, third


def test_callback_persists_each_detail_then_reviews_exactly_without_model(forbid_model):
    async def exercise():
        agent, bridge, events = make_workflow()
        first, second, third = await complete_callback(agent)
        assert "name" in first[0].lower() and "phone" in second[0].lower()
        assert bridge.draft["fields"] == {"reason": "I want your team to call me about buying for my shop.", "name": "Asha Patel", "phone": "+919000000000"}
        assert [call["name"] for call in bridge.tools] == ["start_request", "set_request_field", "set_request_field", "set_request_field", "review_request"]
        assert "Asha Patel" in third[0] and "plus nine one nine zero" in third[0]
        assert bridge.draft["fields"]["reason"] in third[0] and third[0].endswith("?")
        assert not any(call["name"] == "submit_request" for call in bridge.tools)
        assert not forbid_model
    asyncio.run(exercise())


def test_new_explicit_confirmation_submits_once_and_reports_only_queued(forbid_model):
    async def exercise():
        agent, bridge, _ = make_workflow()
        await complete_callback(agent)
        reviewed_turn = agent.turn.id
        token = agent._review_tokens[REQUEST_ID][0]
        result = await drive_turn(agent, "Yes, please submit it.")
        submit = [call for call in bridge.tools if call["name"] == "submit_request"]
        assert agent.turn.id != reviewed_turn and len(submit) == 1
        assert submit[0]["arguments"]["confirmation_token"] == token
        assert "recorded" in result[0] and "team" in result[0]
        assert not re.search(r"\b(?:delivered|sent|within|tomorrow|today)\b", result[0], re.I)
        assert REQUEST_ID not in agent._review_tokens and not forbid_model
    asyncio.run(exercise())


@pytest.mark.parametrize("name", ["start_request", "set_request_field", "review_request", "submit_request"])
@pytest.mark.parametrize("mode", ["raise", "refuse"])
def test_failed_requests_are_not_automatically_retried(name, mode, forbid_model):
    async def exercise():
        agent, bridge, _ = make_workflow()
        if name in {"review_request", "submit_request"}:
            await drive_turn(agent, "I want your team to call me about buying for my shop.")
            await drive_turn(agent, "My name is Asha Patel.")
        if name == "submit_request":
            await drive_turn(agent, "My phone number is 9000000000.")
        bridge.fail_name, bridge.failure_mode = name, mode
        before = len(bridge.tools)
        text = ("Yes, please submit it." if name == "submit_request" else "My phone number is 9000000000." if name == "review_request"
                else "I want your team to call me about buying for my shop.")
        result = await drive_turn(agent, text)
        assert len([call for call in bridge.tools[before:] if call["name"] == name]) == 1
        assert "couldn't save" in result[0]
        assert bridge.draft is None or bridge.draft["status"] != "submitted"
        assert not forbid_model
    asyncio.run(exercise())


def test_edit_invalidates_previous_review_and_requires_new_token(forbid_model):
    async def exercise():
        agent, bridge, _ = make_workflow()
        await complete_callback(agent)
        old_token = agent._review_tokens[REQUEST_ID][0]
        await drive_turn(agent, "My name is Asha Shah.")
        assert bridge.draft["fields"]["name"] == "Asha Shah"
        assert old_token in agent._blocked_review_tokens
        assert agent._review_tokens[REQUEST_ID][0] != old_token
        assert not any(call["name"] == "submit_request" for call in bridge.tools)
        assert not forbid_model
    asyncio.run(exercise())


def test_unrelated_turn_invalidates_review_before_a_later_yes(forbid_model):
    async def exercise():
        agent, bridge, _ = make_workflow()
        await complete_callback(agent)
        token = agent._review_tokens[REQUEST_ID][0]
        await completed_turn(agent, "What products do you sell?")
        assert agent._concierge_step(agent.turn) == (None, None, None)
        assert token in agent._blocked_review_tokens and REQUEST_ID not in agent._review_tokens
        result = await drive_turn(agent, "Yes")
        assert not any(call["name"] == "submit_request" for call in bridge.tools)
        assert result[0].endswith("?") and "Asha Patel" in result[0]
        assert not forbid_model
    asyncio.run(exercise())


@pytest.mark.parametrize("text", ["Open our story page", "Please speak Hindi", "Should I tell you my OTP?"])
def test_navigation_and_direct_reply_paths_also_invalidate_old_confirmation(text, forbid_model):
    async def exercise():
        agent, bridge, _ = make_workflow()
        await complete_callback(agent)
        token = agent._review_tokens[REQUEST_ID][0]
        await completed_turn(agent, text)
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=text)
        output = [item async for item in agent.llm_node(ctx, [], None)]
        assert output
        assert token in agent._blocked_review_tokens and REQUEST_ID not in agent._review_tokens
        assert not any(call["name"] == "submit_request" for call in bridge.tools)
        assert not forbid_model
    asyncio.run(exercise())


@pytest.mark.parametrize("text", ["What ingredients are in the product?", "I don't know", "No", "मुझे नाम नहीं बताना", "મને નથી ખબર"])
def test_product_questions_and_refusals_do_not_persist_as_names(text):
    async def exercise():
        agent, bridge, _ = make_workflow(existing=True)
        await completed_turn(agent, text)
        name, args, response = agent._concierge_step(agent.turn)
        assert name is None and not bridge.tools and bridge.draft["fields"] == {}
    asyncio.run(exercise())


def test_navigation_result_is_not_success_until_admitted_browser_ack(forbid_model):
    async def exercise():
        agent, bridge, events = make_workflow()
        await completed_turn(agent, "Open our story page")
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        output = [item async for item in agent.llm_node(ctx, [], None)]
        call = output[0].delta.tool_calls[0]
        pending = asyncio.create_task(execute_call(agent, call))
        await asyncio.sleep(0)
        event = next(data for kind, data in events.sent if kind == "navigate_site")
        assert not pending.done() and not any(kind == "agent_reply_text" for kind, _ in events.sent)
        ack = {"type": "client_action_result", "action_id": event["action_id"], "destination_id": "our_story", "ok": True}
        agent.browser_actions.receive(SimpleNamespace(topic="earthora.voice", participant=SimpleNamespace(identity="unrelated-participant"), data=json.dumps(ack).encode()))
        assert not pending.done()
        agent.browser_actions.receive(SimpleNamespace(topic="earthora.voice", participant=SimpleNamespace(identity="synthetic-web-caller"), data=json.dumps(ack).encode()))
        result = await asyncio.wait_for(pending, 0.3)
        assert result["data"]["navigation"]["acknowledged"] is True
        assert agent.turn.data["current_destination"] == "our_story"
        output = [item async for item in agent.llm_node(ctx, [], None)]
        assert "I've opened Our story" in output[0] and not forbid_model
    asyncio.run(exercise())
