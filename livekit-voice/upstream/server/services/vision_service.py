"""
Vision Service for SchoolEXL Mentor (LiveKit version)
Integrates ShowUI and OmniParser APIs for screen understanding.

This service allows the AI to "see" the user's screen by:
1. Receiving images from the frontend via RPC
2. Calling vision APIs (ShowUI for grounding, OmniParser for parsing)
3. Returning results for the LLM to interpret
"""

import base64
import io
import os
from typing import Optional

import httpx
from loguru import logger
from PIL import Image


# Default endpoints - can be overridden via environment
DEFAULT_SHOWUI_URL = os.getenv(
    "SHOWUI_API_URL",
    "https://1bzo2ldfesj20v-8787.proxy.runpod.net"
)
DEFAULT_OMNIPARSER_URL = os.getenv(
    "OMNIPARSER_API_URL",
    "https://1bzo2ldfesj20v-8686.proxy.runpod.net"
)


class VisionService:
    """
    Vision service that integrates ShowUI and OmniParser APIs.

    - OmniParser: Parse UI screenshot to identify all elements
    - ShowUI: Ground specific elements (find "the submit button")
    """

    def __init__(
        self,
        showui_url: Optional[str] = None,
        omniparser_url: Optional[str] = None,
        timeout: float = 30.0,
    ):
        self._showui_url = showui_url or DEFAULT_SHOWUI_URL
        self._omniparser_url = omniparser_url or DEFAULT_OMNIPARSER_URL
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

        logger.info(f"VisionService initialized:")
        logger.info(f"  ShowUI: {self._showui_url}")
        logger.info(f"  OmniParser: {self._omniparser_url}")

    async def _ensure_client(self):
        """Ensure HTTP client is initialized."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)

    async def close(self):
        """Close HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _compress_image(self, image: Image.Image, scale: float = 0.75, quality: int = 85) -> Image.Image:
        """Compress image for faster API calls while maintaining quality."""
        new_size = (int(image.width * scale), int(image.height * scale))
        resized = image.resize(new_size, Image.LANCZOS)
        return resized

    def _image_to_base64(self, image: Image.Image, compress: bool = True) -> str:
        """Convert PIL Image to base64 string with optional compression."""
        buffer = io.BytesIO()

        if compress:
            compressed = self._compress_image(image)
            compressed.save(buffer, format="JPEG", quality=85)
        else:
            image.save(buffer, format="PNG")

        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    async def parse_ui(self, image_b64: str, max_elements: int = 30) -> dict:
        """
        Parse UI screenshot using OmniParser.
        Returns detected elements with their locations and captions.
        """
        await self._ensure_client()

        try:
            response = await self._client.post(
                f"{self._omniparser_url}/parse",
                json={
                    "image": image_b64,
                    "detect_threshold": 0.3,
                    "caption_elements": True,
                    "max_elements": max_elements,
                },
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"OmniParser error: {e}")
            return {"elements": [], "error": str(e)}

    async def ground_element(self, image_b64: str, task: str) -> dict:
        """
        Ground a task description to coordinates using ShowUI.
        Use this to find specific elements like "the submit button".
        """
        await self._ensure_client()

        try:
            response = await self._client.post(
                f"{self._showui_url}/ground",
                json={
                    "image": image_b64,
                    "task": task,
                },
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"ShowUI error: {e}")
            return {"found": False, "error": str(e)}

    async def health_check(self) -> dict:
        """Check health of both vision services."""
        await self._ensure_client()

        results = {
            "showui": False,
            "omniparser": False,
            "showui_error": None,
            "omniparser_error": None,
        }

        # Check ShowUI health
        try:
            logger.debug(f"Checking ShowUI health at: {self._showui_url}/health")
            resp = await self._client.get(f"{self._showui_url}/health", timeout=5.0)
            results["showui"] = resp.status_code == 200
            if resp.status_code != 200:
                results["showui_error"] = f"Status code: {resp.status_code}"
        except httpx.TimeoutException:
            results["showui_error"] = "Timeout"
        except httpx.ConnectError as e:
            results["showui_error"] = f"Connection failed: {str(e)}"
        except Exception as e:
            results["showui_error"] = str(e)

        # Check OmniParser health
        try:
            logger.debug(f"Checking OmniParser health at: {self._omniparser_url}/health")
            resp = await self._client.get(f"{self._omniparser_url}/health", timeout=5.0)
            results["omniparser"] = resp.status_code == 200
            if resp.status_code != 200:
                results["omniparser_error"] = f"Status code: {resp.status_code}"
        except httpx.TimeoutException:
            results["omniparser_error"] = "Timeout"
        except httpx.ConnectError as e:
            results["omniparser_error"] = f"Connection failed: {str(e)}"
        except Exception as e:
            results["omniparser_error"] = str(e)

        logger.info(f"Vision health: showui={results['showui']}, omniparser={results['omniparser']}")
        return results

    def format_elements_for_llm(self, parse_result: dict) -> str:
        """Format parsed elements as text for the LLM."""
        elements = parse_result.get("elements", [])

        if not elements:
            return "No UI elements detected on the screen."

        lines = [f"I can see {len(elements)} UI elements on the screen:\n"]

        for i, el in enumerate(elements[:20], 1):
            el_type = el.get("type", "element")
            caption = el.get("caption", "")
            center = el.get("center", [0, 0])

            if caption:
                lines.append(f"{i}. {el_type}: \"{caption}\" at position ({center[0]}, {center[1]})")
            else:
                lines.append(f"{i}. {el_type} at position ({center[0]}, {center[1]})")

        if len(elements) > 20:
            lines.append(f"\n... and {len(elements) - 20} more elements")

        return "\n".join(lines)

    async def analyze_image(self, image_b64: str, question: str = "") -> dict:
        """
        Analyze an image — routes to ShowUI or OmniParser based on question.

        Args:
            image_b64: Base64-encoded image
            question: What to look for (e.g., "find the submit button")

        Returns:
            dict with analysis results
        """
        # Determine which API to use based on the question
        if any(kw in question.lower() for kw in ["find", "click", "where", "locate"]):
            # Use ShowUI for grounding (finding specific elements)
            logger.info(f"[Vision] Grounding request: {question[:50]}...")
            result = await self.ground_element(image_b64, question)

            if result.get("error"):
                return {
                    "success": False,
                    "error": result["error"],
                    "type": "ground",
                }

            if result.get("found"):
                description = f"Found the element at coordinates ({result.get('x')}, {result.get('y')}). {result.get('description', '')}"
            else:
                description = f"Could not find the element. {result.get('description', '')}"

            return {
                "success": True,
                "type": "ground",
                "found": result.get("found", False),
                "coordinates": {
                    "x": result.get("x"),
                    "y": result.get("y"),
                } if result.get("found") else None,
                "description": description,
            }
        else:
            # Use OmniParser for general UI parsing
            logger.info(f"[Vision] Parse request: {question[:50] if question else 'general'}...")
            result = await self.parse_ui(image_b64, max_elements=30)

            if result.get("error"):
                return {
                    "success": False,
                    "error": result["error"],
                    "type": "parse",
                }

            elements = result.get("elements", [])
            description = self.format_elements_for_llm(result)

            return {
                "success": True,
                "type": "parse",
                "description": description,
                "element_count": len(elements),
                "elements": [
                    {
                        "type": el.get("type", "element"),
                        "caption": el.get("caption", ""),
                        "center": el.get("center", [0, 0]),
                        "bbox": el.get("bbox"),
                        "confidence": el.get("confidence", 0),
                    }
                    for el in elements[:50]
                ],
            }


# Global singleton for the service
_vision_service: Optional[VisionService] = None


def get_vision_service() -> VisionService:
    """Get or create the global vision service instance."""
    global _vision_service
    if _vision_service is None:
        _vision_service = VisionService()
    return _vision_service
