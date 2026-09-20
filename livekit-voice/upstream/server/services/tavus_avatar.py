"""TavusAvatarSession — Tavus Conversational Video avatar integration.

Tavus joins the LiveKit room as a participant, receives TTS audio via
DataStream, and publishes synced video+audio tracks.

Based on livekit-plugins-tavus reference implementation.

Requires env vars:
  TAVUS_API_KEY — API key from tavus.io
  TAVUS_REPLICA_ID — Replica ID to use
  TAVUS_PERSONA_ID — (optional) Persona ID; auto-created if not set
"""

from __future__ import annotations

import os
import uuid

import httpx
from loguru import logger

from livekit import api, rtc
from livekit.agents.voice.avatar import DataStreamAudioOutput

_API_URL = "https://tavusapi.com/v2"
SAMPLE_RATE = 24000
_AVATAR_IDENTITY = "tavus-avatar-agent"


class TavusAvatarSession:
    """Connects Tavus avatar to a LiveKit room."""

    def __init__(self) -> None:
        self._api_key = os.getenv("TAVUS_API_KEY", "")
        self._replica_id = os.getenv("TAVUS_REPLICA_ID", "")
        self._persona_id = os.getenv("TAVUS_PERSONA_ID", "")
        self._conversation_id: str | None = None
        self._audio_output: DataStreamAudioOutput | None = None

    async def _tavus_post(self, client: httpx.AsyncClient, endpoint: str, payload: dict) -> dict:
        """POST to Tavus API with logging."""
        url = f"{_API_URL}/{endpoint}"
        logger.info(f"[tavus] POST {url}: {payload}")
        resp = await client.post(
            url,
            headers={"Content-Type": "application/json", "x-api-key": self._api_key},
            json=payload,
        )
        logger.info(f"[tavus] Response {resp.status_code}: {resp.text[:500]}")
        if resp.status_code >= 400:
            logger.error(f"[tavus] API error: {resp.text[:500]}")
        resp.raise_for_status()
        return resp.json()

    async def start(self, agent_session, room: rtc.Room) -> None:
        if not self._api_key or not self._replica_id:
            raise ValueError("TAVUS_API_KEY and TAVUS_REPLICA_ID must be set")

        local_identity = room.local_participant.identity
        lk_api_key = os.getenv("LIVEKIT_API_KEY", "")
        lk_api_secret = os.getenv("LIVEKIT_API_SECRET", "")
        livekit_url = os.getenv("LIVEKIT_PUBLIC_URL", os.getenv("LIVEKIT_URL", ""))

        logger.info(
            f"[tavus] Starting: replica={self._replica_id}, persona={self._persona_id}, "
            f"room={room.name}, local_identity={local_identity}, livekit_url={livekit_url}"
        )

        # Mint token for Tavus avatar participant
        livekit_token = (
            api.AccessToken(lk_api_key, lk_api_secret)
            .with_kind("agent")
            .with_identity(_AVATAR_IDENTITY)
            .with_name("Tavus Avatar")
            .with_grants(api.VideoGrants(room_join=True, room=room.name))
            .with_attributes({"lk.publish_on_behalf": local_identity})
            .to_jwt()
        )
        logger.debug(f"[tavus] Minted token for {_AVATAR_IDENTITY}")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Ensure persona exists with LiveKit transport + echo pipeline
            persona_id = self._persona_id
            if not persona_id:
                logger.info("[tavus] No TAVUS_PERSONA_ID set, creating persona...")
                persona_data = await self._tavus_post(client, "personas", {
                    "persona_name": f"lk_{uuid.uuid4().hex[:8]}",
                    "pipeline_mode": "echo",
                    "layers": {
                        "transport": {"transport_type": "livekit"},
                    },
                })
                persona_id = persona_data["persona_id"]
                logger.info(f"[tavus] Created persona: {persona_id}")

            # Create conversation — LiveKit creds go inside 'properties'
            conv_data = await self._tavus_post(client, "conversations", {
                "replica_id": self._replica_id,
                "persona_id": persona_id,
                "conversation_name": f"lk_{uuid.uuid4().hex[:8]}",
                "properties": {
                    "livekit_ws_url": livekit_url,
                    "livekit_room_token": livekit_token,
                },
            })
            self._conversation_id = conv_data.get("conversation_id")

        logger.info(f"[tavus] Conversation started: {self._conversation_id}")

        # Route TTS audio via DataStream to Tavus participant
        self._audio_output = DataStreamAudioOutput(
            room,
            destination_identity=_AVATAR_IDENTITY,
            sample_rate=SAMPLE_RATE,
            wait_remote_track=rtc.TrackKind.KIND_VIDEO,
        )
        agent_session.output.audio = self._audio_output

        logger.info("[tavus] Avatar ready (DataStream audio output)")

    async def aclose(self) -> None:
        if self._audio_output:
            try:
                await self._audio_output.aclose()
            except Exception:
                pass
            self._audio_output = None

        if self._conversation_id and self._api_key:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.delete(
                        f"{_API_URL}/conversations/{self._conversation_id}",
                        headers={"x-api-key": self._api_key},
                    )
                    logger.info(f"[tavus] Conversation {self._conversation_id} deleted")
            except Exception as e:
                logger.warning(f"[tavus] Error stopping conversation: {e}")
            self._conversation_id = None
