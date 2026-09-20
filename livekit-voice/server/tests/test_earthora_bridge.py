import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from earthora_bridge import EarthoraBridge, VoiceContext, normalize_language


def run(coro):
    return asyncio.run(coro)


def test_channel_credentials_and_verbatim_turn_reach_only_private_endpoint():
    received = []

    async def handler(request):
        received.append(request)
        return httpx.Response(200, json={
            "text": "તમારા કાર્ટમાં મોરિંગા ઉમેર્યું છે.",
            "language": "gu-IN",
            "end_session": False,
        })

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            bridge = EarthoraBridge(client, endpoint="http://127.0.0.1:4100/api/platform/voice/internal/turn", key="test-private-key")
            context = VoiceContext.from_metadata({
                "session_id": "session-42", "channel_key": "scoped-test-key",
                "channel": "phone", "language": "hi-IN",
            })
            reply = await bridge.turn(context, text="Mujhe moringa જોઈએ છે", turn_id="turn-42", language="hi")
            assert reply.language == "gu"
            assert reply.text == "તમારા કાર્ટમાં મોરિંગા ઉમેર્યું છે."
            assert reply.end_session is False

    run(exercise())
    assert len(received) == 1
    assert received[0].headers["authorization"] == "Bearer test-private-key"
    assert json.loads(received[0].content) == {
        "session_id": "session-42", "channel_key": "scoped-test-key",
        "channel": "phone", "language": "hi", "turn_id": "turn-42",
        "text": "Mujhe moringa જોઈએ છે",
    }


@pytest.mark.parametrize("payload", [
    {}, {"text": ""}, {"text": ["unvalidated"]},
    {"text": "x" * 16001}, {"text": "reply", "end_session": "false"},
    ["unexpected envelope"],
])
def test_invalid_application_response_cannot_be_spoken(payload):
    async def exercise():
        transport = httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=transport) as client:
            bridge = EarthoraBridge(client, endpoint="http://127.0.0.1/turn", key="test")
            with pytest.raises(ValueError):
                await bridge.turn(VoiceContext("s", "k"), text="hi", turn_id="t", language="en")
    run(exercise())


def test_unauthorized_turn_is_not_retried_or_fallen_back_to_another_provider():
    attempts = []

    def handler(request):
        attempts.append(request)
        return httpx.Response(401, json={"text": "This text must never be spoken"})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            bridge = EarthoraBridge(client, endpoint="http://127.0.0.1/turn", key="invalid-test")
            with pytest.raises(httpx.HTTPStatusError):
                await bridge.turn(VoiceContext("s", "k"), text="checkout", turn_id="stable", language="en")
    run(exercise())
    assert len(attempts) == 1


def test_mutation_timeout_is_not_retried():
    attempts = []

    def handler(request):
        attempts.append(request)
        raise httpx.ReadTimeout("simulated timeout", request=request)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            bridge = EarthoraBridge(client, endpoint="http://127.0.0.1/turn", key="test")
            with pytest.raises(httpx.ReadTimeout):
                await bridge.turn(VoiceContext("s", "k"), text="add one", turn_id="stable", language="en")
    run(exercise())
    assert len(attempts) == 1


@pytest.mark.parametrize("metadata", [
    [], {}, {"session_id": "s"}, {"session_id": "s", "channel_key": ""},
    {"session_id": "s", "channel_key": "k", "channel": "whatsapp"},
])
def test_unscoped_or_unsupported_room_is_rejected(metadata):
    with pytest.raises(ValueError):
        VoiceContext.from_metadata(metadata)


def test_normalizes_only_the_three_supported_languages():
    assert normalize_language("en-IN") == "en"
    assert normalize_language("HI_in") == "hi"
    assert normalize_language("gu") == "gu"
    assert normalize_language("ar", "gu") == "gu"


def test_validated_end_session_survives_boundary():
    async def exercise():
        transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"text": "  Thank you.  ", "language": "en", "end_session": True}))
        async with httpx.AsyncClient(transport=transport) as client:
            bridge = EarthoraBridge(client, endpoint="http://127.0.0.1/turn", key="test")
            reply = await bridge.turn(VoiceContext("s", "k"), text="bye", turn_id="t", language="en")
            assert reply.text == "Thank you."
            assert reply.end_session is True
    run(exercise())
