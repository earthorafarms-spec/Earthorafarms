"""Authenticated boundary between the UniExl voice runtime and Earthora's brain.

The application owns conversation history, catalogue grounding, validation and
checkout. This module only carries completed utterances and validated replies.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


def normalize_language(value: Any, default: str = "en") -> str:
    language = str(value or "").lower().replace("_", "-").split("-")[0]
    return language if language in {"en", "hi", "gu"} else default


@dataclass(frozen=True)
class VoiceContext:
    session_id: str
    channel_key: str
    language: str = "en"
    channel: str = "web"
    greeting: str = ""

    @classmethod
    def from_metadata(cls, metadata: Any) -> "VoiceContext":
        if not isinstance(metadata, dict):
            raise ValueError("Room metadata must be an object")
        session_id = metadata.get("session_id")
        channel_key = metadata.get("channel_key")
        if not isinstance(session_id, str) or not session_id.strip():
            raise ValueError("Missing Earthora session")
        if not isinstance(channel_key, str) or not channel_key.strip():
            raise ValueError("Missing Earthora channel credential")
        channel = metadata.get("channel", "web")
        if channel not in {"web", "phone"}:
            raise ValueError("Invalid Earthora voice channel")
        greeting = metadata.get("greeting", "")
        if not isinstance(greeting, str) or len(greeting) > 4000:
            raise ValueError("Invalid greeting")
        return cls(
            session_id=session_id.strip(),
            channel_key=channel_key,
            language=normalize_language(metadata.get("language")),
            channel=channel,
            greeting=greeting.strip(),
        )


@dataclass(frozen=True)
class ValidatedReply:
    text: str
    language: str
    end_session: bool


class EarthoraBridge:
    def __init__(self, client: httpx.AsyncClient, *, endpoint: str, key: str):
        if not key:
            raise ValueError("EARTHORA_VOICE_INTERNAL_KEY is required")
        url = httpx.URL(endpoint)
        if url.scheme not in {"http", "https"} or not url.host:
            raise ValueError("Invalid Earthora turn endpoint")
        self._client = client
        self._endpoint = str(url)
        self._key = key

    async def turn(
        self, context: VoiceContext, *, text: str, turn_id: str, language: str
    ) -> ValidatedReply:
        if not text.strip() or not turn_id:
            raise ValueError("A completed utterance and turn id are required")
        # Do not retry a mutation here. The server uses turn_id for idempotency;
        # an interrupted request may already have advanced the customer's cart.
        response = await self._client.post(
            self._endpoint,
            headers={"Authorization": f"Bearer {self._key}"},
            json={
                "session_id": context.session_id,
                "text": text,
                "language": normalize_language(language, context.language),
                "channel": context.channel,
                "turn_id": turn_id,
                "channel_key": context.channel_key,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid Earthora response")
        reply_text = payload.get("text")
        if not isinstance(reply_text, str) or not reply_text.strip() or len(reply_text) > 16000:
            raise ValueError("Earthora returned no valid speech text")
        end_session = payload.get("end_session", False)
        if not isinstance(end_session, bool):
            raise ValueError("Invalid Earthora session state")
        return ValidatedReply(
            text=reply_text.strip(),
            language=normalize_language(payload.get("language"), language),
            end_session=end_session,
        )
