"""SunPath's provider-builder seam, configured exclusively for Earthora's GPU."""
from __future__ import annotations

import os
from urllib.parse import urlparse


def build_llm():
    from livekit.plugins import openai
    base_url, key = os.getenv("AI_BASE_URL", "").rstrip("/"), os.getenv("AI_API_KEY", "")
    if urlparse(base_url).scheme not in {"https", "http"} or not key:
        raise ValueError("AI_BASE_URL and AI_API_KEY are required; no hosted fallback")
    return openai.LLM(
        model=os.getenv("AI_LLM_MODEL", "qwen3.5:9b"), base_url=base_url, api_key=key,
        temperature=0, parallel_tool_calls=False, max_retries=0,
        extra_body={"max_tokens": 256, "think": False, "thinking": False,
                    "chat_template_kwargs": {"enable_thinking": False},
                    # The installed Open WebUI OpenAI-to-Ollama converter
                    # preserves native options but drops root temperature.
                    "options": {"num_ctx": 8192, "temperature": 0}},
    )


def build_stt():
    from plymaxx import PlymaxxSTT
    return PlymaxxSTT(language="auto")


def build_tts(language: str):
    from plymaxx import PlymaxxTTS
    return PlymaxxTTS(language=language, voice="Neha")
