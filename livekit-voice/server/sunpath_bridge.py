"""Earthora data/tools for the native SunPath-style LiveKit agent; no inference."""
from __future__ import annotations

from typing import Any
import httpx

from earthora_bridge import VoiceContext


class SunPathBridge:
    def __init__(self, client: httpx.AsyncClient, *, endpoint: str, key: str):
        url = httpx.URL(endpoint)
        if not key or url.scheme not in {"http", "https"} or not url.host:
            raise ValueError("A private Earthora API endpoint and key are required")
        self.client, self.endpoint, self.key = client, str(url).rstrip("/"), key

    async def _post(self, context: VoiceContext, operation: str, **fields: Any) -> dict:
        # Never blindly retry a tool mutation or follow redirects with a credential.
        response = await self.client.post(
            self.endpoint + "/" + operation,
            headers={"Authorization": "Bearer " + self.key},
            json={"session_id": context.session_id, "channel_key": context.channel_key,
                  "channel": context.channel, **fields},
            follow_redirects=False,
        )
        response.raise_for_status()
        if len(response.content) > 160_000:
            raise ValueError("Earthora response exceeds the context limit")
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid Earthora response")
        return payload

    async def context(self, context: VoiceContext) -> dict:
        payload = await self._post(context, "context")
        for key in ("catalog", "knowledge", "tools", "history", "cart"):
            if not isinstance(payload.get(key), list):
                raise ValueError("Invalid Earthora context")
        if not isinstance(payload.get("checkout"), dict) or not isinstance(payload.get("persona"), dict):
            raise ValueError("Invalid Earthora context")
        for tool in payload["tools"]:
            if not isinstance(tool, dict) or not isinstance(tool.get("name"), str) or not isinstance(tool.get("parameters"), dict):
                raise ValueError("Invalid Earthora tool schema")
        return payload

    async def tool(self, context: VoiceContext, *, call_id: str, name: str, arguments: dict) -> dict:
        result = await self._post(context, "tool", call_id=call_id, name=name, arguments=arguments)
        if not isinstance(result.get("ok"), bool):
            raise ValueError("Invalid Earthora tool result")
        return result

    async def record(self, context: VoiceContext, *, message_id: str, role: str, text: str, language: str) -> None:
        result = await self._post(context, "record", message_id=message_id, role=role, text=text, language=language)
        if result.get("ok") is not True:
            raise ValueError("Earthora did not persist the transcript")
