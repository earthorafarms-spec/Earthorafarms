"""Acknowledged, caller-bound browser actions; no arbitrary browser execution."""
from __future__ import annotations

import asyncio
import json
import uuid


class BrowserActions:
    def __init__(self, events, caller_identity: str, *, on_mute=None):
        self.events = events
        self.caller_identity = caller_identity
        self.on_mute = on_mute
        self.muted = False
        self.destination_id: str | None = None
        self.pending: dict[str, tuple[asyncio.Future, str]] = {}

    def receive(self, packet) -> None:
        if (getattr(packet, "topic", None) != "earthora.voice"
                or getattr(getattr(packet, "participant", None), "identity", None) != self.caller_identity):
            return
        raw = getattr(packet, "data", b"")
        if not isinstance(raw, (bytes, bytearray)) or len(raw) > 4096:
            return
        try:
            message = json.loads(raw)
        except (ValueError, UnicodeError):
            return
        if not isinstance(message, dict):
            return
        if message.get("type") == "client_voice_state" and isinstance(message.get("muted"), bool):
            changed = self.muted != message["muted"]
            self.muted = message["muted"]
            if changed and self.on_mute:
                self.on_mute(self.muted)
        elif message.get("type") == "client_action_result":
            action_id = message.get("action_id")
            if not isinstance(action_id, str) or action_id not in self.pending:
                return
            future, destination_id = self.pending[action_id]
            if (future.done() or message.get("destination_id") != destination_id
                    or not isinstance(message.get("ok"), bool)):
                return
            if message["ok"]:
                self.destination_id = destination_id
            # Never feed arbitrary browser text into the model's tool results.
            future.set_result({"ok": message["ok"], "destination_id": destination_id})

    def cancel_pending(self) -> None:
        for action_id, (future, _) in self.pending.items():
            if not future.done():
                self.events.emit("cancel_navigation", action_id=action_id)
                future.set_result({"ok": False, "message": "Navigation interrupted by the visitor."})

    async def navigate(self, navigation: dict, *, turn_id: str, timeout: float = 10) -> dict:
        destination_id, path = navigation.get("destination_id"), navigation.get("path")
        if (not isinstance(destination_id, str) or not isinstance(path, str)
                or not path.startswith("/") or path.startswith("//")
                or "\\" in path or any(ord(c) < 32 for c in path)):
            return {"ok": False, "message": "Invalid website destination."}
        action_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[action_id] = (future, destination_id)
        try:
            await self.events.send("navigate_site", action_id=action_id, turn_id=turn_id,
                                   **{key: navigation.get(key) for key in ("destination_id", "path", "anchor", "label")})
            result = await asyncio.wait_for(future, timeout=timeout)
            if not result["ok"]:
                return {"ok": False, "message": "The page could not be opened. Continue helping by voice; do not claim the page changed."}
            return {"ok": True, "data": {"navigation": {**navigation, "acknowledged": True}}}
        except asyncio.TimeoutError:
            self.events.emit("cancel_navigation", action_id=action_id)
            return {"ok": False, "message": "The browser did not confirm navigation. Continue by voice without claiming the page changed."}
        except asyncio.CancelledError:
            self.events.emit("cancel_navigation", action_id=action_id)
            raise
        finally:
            self.pending.pop(action_id, None)
