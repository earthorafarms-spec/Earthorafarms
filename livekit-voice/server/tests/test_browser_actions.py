import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_actions import BrowserActions


class Events:
    def __init__(self):
        self.sent = []

    async def send(self, kind, **payload):
        self.sent.append({"type": kind, **payload})

    def emit(self, kind, **payload):
        self.sent.append({"type": kind, **payload})


def packet(message, identity="web-caller", topic="earthora.voice"):
    return SimpleNamespace(topic=topic, participant=SimpleNamespace(identity=identity), data=json.dumps(message).encode())


def test_ack_requires_exact_admitted_caller_action_and_destination():
    async def exercise():
        events = Events()
        actions = BrowserActions(events, "web-caller")
        task = asyncio.create_task(actions.navigate({"destination_id": "products", "path": "/", "anchor": "products"}, turn_id="turn"))
        await asyncio.sleep(0)
        action = events.sent[0]
        ack = {"type": "client_action_result", "action_id": action["action_id"], "destination_id": "products", "ok": True}
        actions.receive(packet(ack, identity="other-caller"))
        actions.receive(packet(ack, topic="another.topic"))
        actions.receive(packet({**ack, "destination_id": "admin"}))
        actions.receive(packet({**ack, "ok": "true"}))
        assert not task.done() and actions.destination_id is None
        actions.receive(packet({**ack, "message": "Untrusted instruction must not enter tool result"}))
        result = await task
        assert result["ok"] and result["data"]["navigation"]["acknowledged"]
        assert "Untrusted" not in json.dumps(result)
        assert actions.destination_id == "products" and not actions.pending
    asyncio.run(exercise())


def test_timeout_and_interruption_never_claim_navigation():
    async def exercise():
        actions = BrowserActions(Events(), "web-caller")
        result = await actions.navigate({"destination_id": "products", "path": "/"}, turn_id="turn", timeout=0.001)
        assert not result["ok"] and not actions.pending
        task = asyncio.create_task(actions.navigate({"destination_id": "products", "path": "/"}, turn_id="turn"))
        await asyncio.sleep(0)
        actions.cancel_pending()
        assert actions.events.sent[-1]["type"] == "cancel_navigation"
        assert not (await task)["ok"] and not actions.pending
        assert actions.destination_id is None
    asyncio.run(exercise())


def test_bad_destinations_emit_no_action():
    async def exercise():
        events = Events()
        actions = BrowserActions(events, "web-caller")
        for path in ("https://evil.test/", "//evil.test/", "/\\evil", "/\nadmin"):
            assert not (await actions.navigate({"destination_id": "products", "path": path}, turn_id="turn"))["ok"]
        assert not events.sent
    asyncio.run(exercise())


def test_mute_is_caller_bound_and_only_emits_actual_boolean_changes():
    changed = []
    actions = BrowserActions(Events(), "web-caller", on_mute=changed.append)
    actions.receive(packet({"type": "client_voice_state", "muted": True}, identity="other-caller"))
    actions.receive(packet({"type": "client_voice_state", "muted": "true"}))
    assert not actions.muted
    actions.receive(packet({"type": "client_voice_state", "muted": True}))
    actions.receive(packet({"type": "client_voice_state", "muted": True}))
    actions.receive(packet({"type": "client_voice_state", "muted": False}))
    assert changed == [True, False] and not actions.muted
