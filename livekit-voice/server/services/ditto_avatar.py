"""DittoAvatarSession — Ditto GPU avatar using DataStream audio routing.

Like Tavus/Bey, the Ditto GPU server joins the LiveKit room as a separate
participant and publishes its own video+audio tracks. TTS audio is routed
to the Ditto participant via DataStreamAudioOutput.

The GPU server handles its own A/V sync via wall-clock pacing in
_unified_publisher (timestamp_us=0 lets Rust assign RTP timestamps).
"""

from __future__ import annotations

import os

import httpx
from loguru import logger

from livekit import api, rtc
from livekit.agents.voice.avatar import DataStreamAudioOutput

_AVATAR_IDENTITY = "ditto-avatar-agent"
SAMPLE_RATE = 24000


class DittoAvatarSession:
    """Connects Ditto GPU server to a LiveKit room as a separate participant."""

    def __init__(
        self,
        *,
        ditto_api_url: str,
        avatar_id: str = "imogen",
        video_fps: int = 25,
        api_key: str = "",
        **kwargs,
    ) -> None:
        self._ditto_api_url = ditto_api_url.rstrip("/")
        self._avatar_id = avatar_id
        self._video_fps = video_fps
        self._api_key = api_key
        self._session_id: str | None = None
        self._audio_output: DataStreamAudioOutput | None = None

    def _headers(self) -> dict:
        # avatar.scoreexl.com (scxl-avtr API) gates every session endpoint on
        # an API key; the old RunPod tunnel had no auth, so the header is
        # additive and harmless when the key is unset.
        return {"X-API-Key": self._api_key} if self._api_key else {}

    async def start(self, agent_session, room: rtc.Room) -> None:
        """Start the Ditto avatar session.

        1. Mint a LiveKit token for the Ditto participant
        2. POST /start_session to the GPU server with room credentials
        3. Set up DataStreamAudioOutput to route TTS audio to Ditto
        """
        local_identity = room.local_participant.identity
        lk_api_key = os.getenv("LIVEKIT_API_KEY", "")
        lk_api_secret = os.getenv("LIVEKIT_API_SECRET", "")
        livekit_url = os.getenv("LIVEKIT_PUBLIC_URL", os.getenv("LIVEKIT_URL", ""))

        logger.info(
            f"[ditto] Starting: avatar={self._avatar_id}, "
            f"room={room.name}, agent={local_identity}"
        )

        # Mint token for Ditto avatar participant
        livekit_token = (
            api.AccessToken(lk_api_key, lk_api_secret)
            .with_kind("agent")
            .with_identity(_AVATAR_IDENTITY)
            .with_name("Ditto Avatar")
            .with_grants(api.VideoGrants(
                room_join=True,
                room=room.name,
                can_publish=True,
                can_subscribe=True,
            ))
            .with_attributes({"lk.publish_on_behalf": local_identity})
            .to_jwt()
        )

        # Ensure avatar is registered on the GPU server
        await self._ensure_registered()

        # Tell Ditto GPU server to join the room
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self._ditto_api_url}/start_session",
                headers=self._headers(),
                json={
                    "avatar_id": self._avatar_id,
                    "livekit_url": livekit_url,
                    "livekit_token": livekit_token,
                    "fps": self._video_fps,
                    "agent_identity": local_identity,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            self._session_id = data.get("session_id")

        logger.info(f"[ditto] GPU session started: {self._session_id}")

        # Route TTS audio via DataStream to Ditto participant
        self._audio_output = DataStreamAudioOutput(
            room,
            destination_identity=_AVATAR_IDENTITY,
            sample_rate=SAMPLE_RATE,
            wait_remote_track=rtc.TrackKind.KIND_VIDEO,
        )
        agent_session.output.audio = self._audio_output

        logger.info("[ditto] Avatar ready (DataStream audio output)")

    async def _ensure_registered(self) -> None:
        """Register the avatar on the GPU server if not already cached."""
        import base64, pathlib

        async with httpx.AsyncClient(timeout=10.0) as client:
            health = await client.get(f"{self._ditto_api_url}/health")
            body = health.json()
            # scxl-avtr reports `registered_avatars`; the old tunnel said
            # `avatar_ids`. Read both so the cached check works everywhere.
            cached = body.get("registered_avatars") or body.get("avatar_ids") or []

        if self._avatar_id in cached:
            logger.info(f"[ditto] Avatar '{self._avatar_id}' already registered")
            return

        # Find image file relative to this file's location or in known dirs
        search_dirs = [
            pathlib.Path(__file__).parent.parent / "assets",
            pathlib.Path("/workspace/avatar_images"),
        ]
        image_path = None
        for d in search_dirs:
            for ext in ("jpg", "jpeg", "png"):
                candidate = d / f"{self._avatar_id}.{ext}"
                if candidate.exists():
                    image_path = candidate
                    break
            if image_path:
                break

        if not image_path:
            logger.warning(f"[ditto] No image found for avatar '{self._avatar_id}', skipping registration")
            return

        image_b64 = base64.b64encode(image_path.read_bytes()).decode()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                # scxl-avtr calls this /create; the old tunnel said /register.
                f"{self._ditto_api_url}/create",
                headers=self._headers(),
                json={"avatar_id": self._avatar_id, "image_base64": image_b64},
            )
            resp.raise_for_status()
        logger.info(f"[ditto] Registered avatar '{self._avatar_id}'")

    async def aclose(self) -> None:
        if self._audio_output:
            try:
                await self._audio_output.aclose()
            except Exception:
                pass
            self._audio_output = None

        if self._session_id:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        f"{self._ditto_api_url}/stop_session/{self._session_id}",
                        headers=self._headers(),
                    )
                    # A silently-refused stop LEAKS the GPU session: the avatar
                    # participant keeps publishing, so the next session's avatar
                    # doubles the voice (owner-reported echo, 2026-08-05). The
                    # key-gated server 401s an unauthenticated stop, and the
                    # except-block below only logged a warning — raise so the
                    # failure is loud instead of accumulating stale sessions.
                    resp.raise_for_status()
                    logger.info(f"[ditto] Session {self._session_id} stopped")
            except Exception as e:
                logger.warning(f"[ditto] Error stopping session: {e}")
            self._session_id = None
