"""
Camera Vision Service for SchXl-Mntr LiveKit agent.

Integrates with Moondream VLM for analyzing camera frames to understand
what the user is doing, their environment, expressions, etc.
"""

import base64
import os
from typing import Optional

import httpx
from livekit import rtc
from livekit.agents.utils.images import encode, EncodeOptions, ResizeOptions
from loguru import logger


# VLM_URL takes priority, then SMOLVLM_URL, then MOONDREAM_URL (legacy)
DEFAULT_VLM_URL = (
    os.getenv("VLM_URL")
    or os.getenv("SMOLVLM_URL")
    or os.getenv("MOONDREAM_URL", "http://localhost:8282")
)


class CameraVisionService:
    """
    Service for analyzing camera frames using Moondream VLM.

    Handles frame encoding and API communication with the Moondream server.
    """

    def __init__(
        self,
        vlm_url: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self._vlm_url = vlm_url or DEFAULT_VLM_URL
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

        logger.info(f"CameraVisionService initialized: VLM @ {self._vlm_url}")

    async def _ensure_client(self):
        """Ensure HTTP client is initialized."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)

    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def encode_frame(self, frame: rtc.VideoFrame) -> str:
        """
        Encode a VideoFrame to base64 JPEG string.

        Args:
            frame: LiveKit VideoFrame from camera stream

        Returns:
            Base64-encoded JPEG string
        """
        image_bytes = encode(
            frame,
            EncodeOptions(
                format="JPEG",
                resize_options=ResizeOptions(
                    width=768,
                    height=768,
                    strategy="scale_aspect_fit"
                )
            )
        )
        return base64.b64encode(image_bytes).decode("utf-8")

    async def analyze_frame(
        self,
        frame: rtc.VideoFrame,
        question: str = "Describe what you see."
    ) -> dict:
        """
        Send a camera frame to Moondream for analysis.

        Args:
            frame: LiveKit VideoFrame from camera stream
            question: What to look for or analyze in the frame

        Returns:
            dict with 'success', 'response' (if success), or 'error' (if failed)
        """
        await self._ensure_client()

        try:
            logger.info(f"[Camera] Sending frame {frame.width}x{frame.height} type={frame.type} to VLM")
            image_b64 = self.encode_frame(frame)

            response = await self._client.post(
                f"{self._vlm_url}/v1/query",
                json={
                    "image_base64": image_b64,
                    "prompt": question,
                }
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"[Camera] VLM response: {str(data.get('response', data))[:200]}")
            return data

        except httpx.TimeoutException:
            logger.error("VLM request timed out")
            return {"success": False, "error": "Vision analysis timed out"}
        except httpx.ConnectError as e:
            logger.error(f"Could not connect to VLM: {e}")
            return {"success": False, "error": "Vision service unavailable"}
        except Exception as e:
            logger.error(f"Moondream analysis error: {e}")
            return {"success": False, "error": str(e)}

    async def health_check(self) -> bool:
        """Check if Moondream service is available."""
        await self._ensure_client()

        try:
            resp = await self._client.get(
                f"{self._vlm_url}/health",
                timeout=5.0
            )
            data = resp.json()
            return data.get("status") == "ok"
        except Exception as e:
            logger.warning(f"VLM health check failed: {e}")
            return False


# Global singleton
_camera_vision_service: Optional[CameraVisionService] = None


def get_camera_vision_service() -> CameraVisionService:
    """Get or create the global camera vision service instance."""
    global _camera_vision_service
    if _camera_vision_service is None:
        _camera_vision_service = CameraVisionService()
    return _camera_vision_service
