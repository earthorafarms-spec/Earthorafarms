"""Question-driven browser actions preserve the answer and visitor control."""
import asyncio
import json
import pytest
from dataclasses import replace
from types import SimpleNamespace
from test_concierge_workflow import make_workflow, execute_call, completed_turn
from earthora_agent import llm


def test_company_question_navigates_then_continues_answer_instead_of_generic_open_ack():
    async def check():
        agent, bridge, events = make_workflow()
        await completed_turn(agent, "How can Earthora help me?")
        ctx = llm.ChatContext()
        ctx.add_message(role="user", content=agent.turn.text)
        output = [chunk async for chunk in agent.llm_node(ctx, [], None)]
        call = output[0].delta.tool_calls[0]
        assert call.name == "navigate_site"
        pending = asyncio.create_task(execute_call(agent,call))
        await asyncio.sleep(0)
        payload = next(data for kind,data in events.sent if kind == "navigate_site")
        agent.browser_actions.receive(SimpleNamespace(topic="earthora.voice", participant=SimpleNamespace(identity="synthetic-web-caller"), data=json.dumps({
            "type":"client_action_result","action_id":payload["action_id"],"destination_id":"our_story","ok":True}).encode()))
        assert (await pending)["ok"]
        assert agent._concierge_step(agent.turn) == (None,None,None)
        assert agent.turn.request_speech is None
        # A subsequent related question on that page must not jump again.
        await completed_turn(agent, "Tell me about your company")
        assert agent._concierge_step(agent.turn) == (None,None,None)
    asyncio.run(check())


@pytest.mark.parametrize("question", [
    "Open our story page and tell me how Earthora helps me",
    "कहानी वाला पेज खोलिए और बताइए Earthora क्या करता है",
    "અમારા વિશે પેજ ખોલો અને સમજાવો Earthora શું કરે છે",
])
def test_explicit_navigation_with_question_continues_to_answer(question):
    async def check():
        agent, _, _ = make_workflow()
        await completed_turn(agent, question)
        assert agent._concierge_step(agent.turn)[:2] == ("navigate_site", {"destination_id": "our_story"})
        agent.turn.accept_tool("navigate_site", {"ok": True, "data": {"destination_id": "our_story"}})
        assert agent._concierge_step(agent.turn) == (None, None, None)
    asyncio.run(check())


def test_navigation_opt_out_blocks_model_actions_but_allows_later_explicit_open():
    async def check():
        agent,bridge,_ = make_workflow()
        await completed_turn(agent,"Do not change the page")
        await completed_turn(agent,"How can Earthora help me?")
        assert agent._concierge_step(agent.turn) == (None,None,None)
        assert agent.turn.data["auto_navigation"] is False
        call = SimpleNamespace(call_id="unwanted",name="navigate_site",arguments=json.dumps({"destination_id":"our_story"}))
        agent._tool_turns[call.call_id] = agent.turn
        assert (await execute_call(agent,call))["ok"] is False
        assert not bridge.tools
        await completed_turn(agent,"Open our story page")
        assert agent._concierge_step(agent.turn)[:2] == ("navigate_site",{"destination_id":"our_story"})
        await completed_turn(agent,"Please guide me through the website")
        assert agent._auto_navigation is True
    asyncio.run(check())


def test_phone_and_active_enquiry_do_not_auto_navigate():
    async def check():
        agent,bridge,_ = make_workflow(existing=True)
        await completed_turn(agent,"How can Earthora help me?")
        assert agent._concierge_step(agent.turn) == (None,None,None)
        bridge.draft = None
        agent.context = replace(agent.context, channel="phone")
        await completed_turn(agent,"How can Earthora help me?")
        assert agent._concierge_step(agent.turn) == (None,None,None)
    asyncio.run(check())
