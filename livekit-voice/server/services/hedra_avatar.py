"""BeyAvatarSession — Beyond Presence avatar integration.

Beyond Presence joins the LiveKit room as a participant, receives TTS audio
via DataStream, and publishes synced video+audio tracks.

Based on livekit-plugins-bey reference implementation.

Requires env vars:
  BEY_API_KEY — API key from bey.dev
  BEY_AVATAR_ID — Avatar ID (defaults to Ege stock avatar)
"""

from __future__ import annotations

import os

import httpx
from loguru import logger

from livekit import api, rtc
from livekit.agents.voice.avatar import DataStreamAudioOutput

_DEFAULT_API_URL = "https://api.bey.dev"
_AVATAR_IDENTITY = "bey-avatar-agent"
EGE_STOCK_AVATAR_ID = "b9be11b8-89fb-4227-8f86-4a881393cbdb"


class BeyAvatarSession:
    """Connects Beyond Presence avatar to a LiveKit room."""

    def __init__(self) -> None:
        self._api_key = os.getenv("BEY_API_KEY", "")
        self._avatar_id = os.getenv("BEY_AVATAR_ID", EGE_STOCK_AVATAR_ID)
        self._api_url = os.getenv("BEY_API_URL", _DEFAULT_API_URL)
        self._audio_output: DataStreamAudioOutput | None = None

    async def start(self, agent_session, room: rtc.Room) -> None:
        if not self._api_key:
            raise ValueError("BEY_API_KEY must be set")

        local_identity = room.local_participant.identity
        lk_api_key = os.getenv("LIVEKIT_API_KEY", "")
        lk_api_secret = os.getenv("LIVEKIT_API_SECRET", "")
        livekit_url = os.getenv("LIVEKIT_PUBLIC_URL", os.getenv("LIVEKIT_URL", ""))

        logger.info(
            f"[bey] Starting session: avatar_id={self._avatar_id}, "
            f"api_url={self._api_url}, room={room.name}, "
            f"local_identity={local_identity}, livekit_url={livekit_url}"
        )

        # Mint token for Bey avatar participant
        livekit_token = (
            api.AccessToken(lk_api_key, lk_api_secret)
            .with_kind("agent")
            .with_identity(_AVATAR_IDENTITY)
            .with_name("Bey Avatar")
            .with_grants(api.VideoGrants(room_join=True, room=room.name))
            .with_attributes({"lk.publish_on_behalf": local_identity})
            .to_jwt()
        )
        logger.debug(f"[bey] Minted LiveKit token for {_AVATAR_IDENTITY} (publish_on_behalf={local_identity})")

        # POST to Bey API — JSON with livekit_url, livekit_token, avatar_id
        payload = {
            "avatar_id": self._avatar_id,
            "livekit_url": livekit_url,
            "livekit_token": livekit_token,
        }
        logger.info(f"[bey] POST {self._api_url}/v1/session (avatar_id={self._avatar_id})")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._api_url}/v1/session",
                headers={"x-api-key": self._api_key},
                json=payload,
            )
            logger.info(f"[bey] API response: status={resp.status_code}")
            if resp.status_code >= 400:
                body = resp.text
                logger.error(f"[bey] API error body: {body[:500]}")
            resp.raise_for_status()
            resp_data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            logger.info(f"[bey] Session created: {resp_data}")

        # Route TTS audio via DataStream to Bey participant
        logger.info(f"[bey] Setting up DataStreamAudioOutput -> {_AVATAR_IDENTITY} (sample_rate=16000)")
        self._audio_output = DataStreamAudioOutput(
            room,
            destination_identity=_AVATAR_IDENTITY,
            sample_rate=16000,
            wait_remote_track=rtc.TrackKind.KIND_VIDEO,
        )
        agent_session.output.audio = self._audio_output

        logger.info("[bey] Avatar ready (DataStream audio output)")

    async def aclose(self) -> None:
        if self._audio_output:
            try:
                await self._audio_output.aclose()
            except Exception:
                pass
            self._audio_output = None
        logger.info("[bey] Session closed")
