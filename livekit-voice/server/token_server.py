"""
Token server for SchXl-Mntr LiveKit agent.

Generates LiveKit JWT tokens and creates rooms with metadata
so the agent can read system_prompt and tools config.

Also provides vision API endpoints for screen understanding.
"""

import os
import json
import uuid
from datetime import datetime

from dotenv import load_dotenv
from loguru import logger
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from livekit.api import LiveKitAPI, AccessToken, VideoGrants

from services.vision_service import get_vision_service

load_dotenv()

app = FastAPI(title="SchXl-Mntr Token Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://5.78.78.150:3000",
        "https://score-exl-frontend.vercel.app",
        "https://web2.schoolexl.com",
        "https://amber-learn.vercel.app",
        "https://app.amberlearn.ai",
        "https://app.schoolexl.com",
        "https://app.scoreexl.ai",
        "https://cnps.schoolexl.in",
        "https://cnpsadmin.schoolexl.in",
        "https://cask.schoolexl.com",
        "https://caskadmin.schoolexl.com",
        # cask.ai.in — second live hostname for the CASK box (64.227.176.210,
        # same droplet as cask.schoolexl.com). Students browse the .ai.in host,
        # so every voice/mentor probe from it was CORS-rejected: the Learning
        # Center dock's /api/verify reachability fetch failed and the topic page
        # showed "Unable to connect to the mentor server". Added 2026-08-10.
        "https://cask.ai.in",
        "https://ssrvm.schoolexl.in",
        "https://ssrvmadmin.schoolexl.in",
        "https://ssrvmapi.schoolexl.in",
        "https://caskapi.schoolexl.com",
        "https://learn.schoolexl.in",
        "https://studio.schoolexl.in",
        "https://core.schoolexl.in",
        # White-label D2C tenants (WhiteLabelDomainService / school_domains).
        # NOTE: this list is manual — a new active white-label host must be added
        # here or its voice/mentor preflights 400. Added iira 2026-07-08 (was
        # CORS-rejected 237x/4d = voice broken for every iira user). Other active
        # school_domains hosts (learn.opn.school, gurukul.schoolexl.in) show ZERO
        # voice traffic to this box, so not added until they actually need it.
        "https://iira.schoolexl.in",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "wss://lk.scoreexl.com")
LIVEKIT_PUBLIC_URL = os.getenv("LIVEKIT_PUBLIC_URL", LIVEKIT_URL)
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
SERVER_ACCESS_KEY = os.getenv("SERVER_ACCESS_KEY")


class StartRequest(BaseModel):
    access_key: str
    system_prompt: str
    user_id: Optional[str] = None
    tools: Optional[list] = None
    agent_name: Optional[str] = None
    video_mode: Optional[bool] = False
    vision_mode: Optional[bool] = False  # Enable screen analysis capabilities
    camera_mode: Optional[bool] = False  # Enable webcam camera analysis capabilities
    user_idle_timeout: Optional[float] = 30.0  # Seconds before prompting idle user (None to disable)
    avatar_id: Optional[str] = None
    avatar_service: Optional[str] = "ditto"  # "ditto", "tavus", "bey"
    language: Optional[str] = None  # BCP-47 language code e.g. "en-US", "hi-IN", "fr-FR"
    gender: Optional[str] = None  # "female" (default) or "male"
    dom_mode: Optional[bool] = True  # Enable DOM interaction tools (default True). Set False for tool-only agents.
    # 2026-04-27 Wave 0f — per-session turn cap. None defers to agent's env
    # default (VOICE_MAX_TURNS_PER_SESSION, default 50). Consumers can override
    # for special cases (e.g. coding studio long-form sessions).
    max_turns_per_session: Optional[int] = None


class StartResponse(BaseModel):
    token: str
    url: str
    room_name: str


class TokenRequest(BaseModel):
    room_name: str
    participant_identity: str


class TokenResponse(BaseModel):
    token: str
    url: str


def _verify_access_key(key: str):
    if key != SERVER_ACCESS_KEY:
        raise HTTPException(status_code=401, detail="Invalid access key")


def _create_token(room_name: str, identity: str, metadata: str = "") -> str:
    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(identity)
        .with_metadata(metadata)
        .with_grants(VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        ))
    )
    return token.to_jwt()


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/verify")
async def verify(
    access_key: str = Query(""),
    authorization: Optional[str] = Header(None),
):
    # Accept key from query param or Authorization: Bearer header
    key = access_key
    if not key and authorization and authorization.startswith("Bearer "):
        key = authorization.removeprefix("Bearer ").strip()
    _verify_access_key(key)
    return {"valid": True}


@app.post("/api/start", response_model=StartResponse)
async def start_session(req: StartRequest):
    _verify_access_key(req.access_key)

    logger.info(
        f"[/api/start] video_mode={req.video_mode}, vision_mode={req.vision_mode}, "
        f"camera_mode={req.camera_mode}, avatar_id={req.avatar_id}, "
        f"agent_name={req.agent_name}, avatar_service={req.avatar_service}, "
        f"language={req.language}, tools={len(req.tools or [])}"
    )

    room_name = f"mentor-{uuid.uuid4().hex[:12]}"
    identity = req.user_id or f"user-{uuid.uuid4().hex[:8]}"

    # Store session config in room metadata for the agent to read
    room_metadata_dict = {
        "system_prompt": req.system_prompt,
        "tools": req.tools or [],
        "user_id": identity,
        "agent_name": req.agent_name or "Mentor",
        "vision_mode": req.vision_mode or False,
        "camera_mode": req.camera_mode or False,
        "user_idle_timeout": req.user_idle_timeout,
        "language": req.language or None,
        "gender": req.gender or "female",
        "dom_mode": req.dom_mode if req.dom_mode is not None else True,
        "max_turns_per_session": req.max_turns_per_session,
    }
    if req.video_mode:
        room_metadata_dict["video_mode"] = True
        room_metadata_dict["avatar_service"] = req.avatar_service or "ditto"
        if req.avatar_id:
            room_metadata_dict["avatar_id"] = req.avatar_id
    room_metadata = json.dumps(room_metadata_dict)

    # Create room with metadata via LiveKit API
    async with LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) as api:
        from livekit.api import CreateRoomRequest
        await api.room.create_room(CreateRoomRequest(
            name=room_name,
            metadata=room_metadata,
            empty_timeout=300,
            max_participants=3,
        ))

    # Generate token for the user participant
    token = _create_token(room_name, identity)

    logger.info(f"Created room {room_name} for {identity}")

    return StartResponse(
        token=token,
        url=LIVEKIT_PUBLIC_URL,
        room_name=room_name,
    )


@app.post("/api/token", response_model=TokenResponse)
async def create_token(req: TokenRequest):
    token = _create_token(req.room_name, req.participant_identity)
    return TokenResponse(token=token, url=LIVEKIT_URL)


# =============================================================================
# Vision API endpoints
# =============================================================================

@app.get("/api/vision/health")
async def vision_health():
    """Check if vision APIs (ShowUI, OmniParser) are available."""
    try:
        vision = get_vision_service()
        health = await vision.health_check()
        return {
            "showui": {
                "healthy": health.get("showui", False),
                "error": health.get("showui_error"),
            },
            "omniparser": {
                "healthy": health.get("omniparser", False),
                "error": health.get("omniparser_error"),
            },
        }
    except Exception as e:
        logger.error(f"Vision health check error: {e}")
        return {
            "showui": {"healthy": False, "error": str(e)},
            "omniparser": {"healthy": False, "error": str(e)},
        }


class VisionAnalyzeRequest(BaseModel):
    image: str  # base64-encoded image
    question: Optional[str] = "Describe what you see on the screen"


@app.post("/api/vision/analyze")
async def analyze_image(req: VisionAnalyzeRequest):
    """
    Analyze an image using vision APIs (ShowUI/OmniParser).

    - For "find", "click", "where" questions: Uses ShowUI grounding
    - For general questions: Uses OmniParser UI parsing
    """
    try:
        if not req.image:
            return {"success": False, "error": "No image provided"}

        vision = get_vision_service()
        result = await vision.analyze_image(req.image, req.question or "")
        return result

    except Exception as e:
        logger.error(f"[Vision] Error: {e}")
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
