"""Tests for the demo passcode gate (server/token_server.py).

sun.myscanhub.com is a public URL and every minted token can pull a Chirp STT +
Vertex + Chirp3-HD session into being. The gate is the only thing between the
link and the owner's meter, so the interesting cases here are the ones that would
quietly OPEN it: an unset passcode comparing equal to an empty header, a forged
X-Forwarded-For minting an unlimited number of rate-limit buckets, or a rejected
attempt not costing the attacker any budget.

Sync tests driving asyncio.run(), matching test_fallback_tts.py - the suite has
no pytest-asyncio and a temporary demo is not the place to add a plugin.

Run:  python -m pytest eval/test_token_gate.py -v
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PASSCODE = "482913"


def load_server(passcode: str = PASSCODE, rate_max: str = "10", window: str = "600"):
    """Import token_server with a known config.

    The module reads env at import time (pm2 does not reload it), so the env has
    to be set before the reload, not after.
    """
    import os

    os.environ["DEMO_PASSCODE"] = passcode
    os.environ["DEMO_RATE_MAX"] = rate_max
    os.environ["DEMO_RATE_WINDOW_SECONDS"] = window
    os.environ["LIVEKIT_URL"] = "wss://fake.livekit.cloud"
    os.environ["LIVEKIT_API_KEY"] = "devkey"
    os.environ["LIVEKIT_API_SECRET"] = "secretsecretsecretsecretsecret00"

    import server.token_server as mod

    importlib.reload(mod)
    mod._hits.clear()
    return mod


def hdr(ip: str, code: str | None = None) -> dict[str, str]:
    h = {"X-Forwarded-For": ip}
    if code is not None:
        h["X-Demo-Passcode"] = code
    return h


def run(coro_fn, mod=None):
    """Spin up the app, hand the test an aiohttp client, tear it down."""
    mod = mod or load_server()

    async def _go():
        client = TestClient(TestServer(mod.build_app()))
        await client.start_server()
        try:
            return await coro_fn(client, mod)
        finally:
            await client.close()

    return asyncio.run(_go())


# --- the gate -------------------------------------------------------------


def test_health_stays_open():
    """Monitoring must not have to hold the passcode. /api/health mints nothing."""

    async def go(c, _):
        r = await c.get("/api/health", headers=hdr("1.1.1.1"))
        assert r.status == 200
        assert await r.json() == {"ok": True}

    run(go)


def test_token_without_passcode_is_401():
    async def go(c, _):
        r = await c.get("/api/token", headers=hdr("2.0.0.1"))
        assert r.status == 401
        assert await r.json() == {"error": "bad_passcode"}

    run(go)


def test_token_with_wrong_passcode_is_401():
    async def go(c, _):
        r = await c.get("/api/token", headers=hdr("2.0.0.2", "000000"))
        assert r.status == 401
        assert await r.json() == {"error": "bad_passcode"}

    run(go)


def test_token_with_right_passcode_mints_a_fresh_room():
    async def go(c, _):
        r = await c.get("/api/token", headers=hdr("2.0.0.3", PASSCODE))
        assert r.status == 200
        body = await r.json()
        assert body["token"]
        assert body["url"] == "wss://fake.livekit.cloud"
        assert body["room"].startswith("sunpath-demo-")

        # one fresh room per tap - a reused room would replay the last demo's history
        r2 = await c.get("/api/token", headers=hdr("2.0.0.3", PASSCODE))
        assert (await r2.json())["room"] != body["room"]

    run(go)


def test_post_token_accepts_a_json_body():
    async def go(c, _):
        r = await c.post("/api/token", json={"passcode": PASSCODE}, headers=hdr("2.0.0.4"))
        assert r.status == 200
        r = await c.post("/api/token", json={"passcode": "nope"}, headers=hdr("2.0.0.5"))
        assert r.status == 401

    run(go)


def test_garbage_body_is_401_not_500():
    """A malformed body is a rejection, not a stack trace."""

    async def go(c, _):
        r = await c.post("/api/token", data="not json at all", headers=hdr("2.0.0.6"))
        assert r.status == 401

    run(go)


def test_verify_checks_without_minting():
    async def go(c, _):
        r = await c.post("/api/verify", json={"passcode": PASSCODE}, headers=hdr("3.0.0.1"))
        assert r.status == 200
        assert await r.json() == {"ok": True}  # no token, no room

        r = await c.post("/api/verify", json={"passcode": "482912"}, headers=hdr("3.0.0.2"))
        assert r.status == 401

    run(go)


def test_passcode_is_not_readable_from_the_query_string():
    """Deliberately unsupported: nginx logs full request lines, so a code in a URL
    survives in access.log and in any link that gets pasted around."""

    async def go(c, _):
        r = await c.get(f"/api/token?passcode={PASSCODE}", headers=hdr("3.0.0.3"))
        assert r.status == 401

    run(go)


# --- fail closed ----------------------------------------------------------


def test_unset_passcode_fails_closed_not_open():
    """The regression that matters most.

    With DEMO_PASSCODE unset, a bare hmac.compare_digest("", "") returns True and
    the public URL would hand out free sessions. It must 503 instead.
    """
    mod = load_server(passcode="")

    async def go(c, _):
        r = await c.get("/api/token", headers=hdr("4.0.0.1"))
        assert r.status == 503
        assert await r.json() == {"error": "passcode_not_configured"}

        r = await c.get("/api/token", headers=hdr("4.0.0.2", ""))
        assert r.status == 503, "empty supplied code must not match an empty configured one"

        r = await c.get("/api/health", headers=hdr("4.0.0.3"))
        assert r.status == 200, "health stays open even when the gate is misconfigured"

    run(go, mod)


# --- the rate limit (the actual cost ceiling) -----------------------------


def test_eleventh_request_is_rate_limited():
    async def go(c, _):
        for _i in range(10):
            r = await c.get("/api/token", headers=hdr("5.0.0.1", PASSCODE))
            assert r.status == 200

        r = await c.get("/api/token", headers=hdr("5.0.0.1", PASSCODE))
        assert r.status == 429
        assert await r.json() == {"error": "rate_limited"}

    run(go)


def test_rate_limit_is_per_ip():
    async def go(c, _):
        for _i in range(11):
            await c.get("/api/token", headers=hdr("5.0.0.2", PASSCODE))
        r = await c.get("/api/token", headers=hdr("5.0.0.3", PASSCODE))
        assert r.status == 200, "one spent IP must not lock the room's other phones out"

    run(go)


def test_rejected_attempts_still_cost_budget():
    """This is what bounds passcode guessing to RATE_MAX per window per IP. If
    only successes counted, the code could be brute-forced for free."""

    async def go(c, _):
        for _i in range(10):
            r = await c.get("/api/token", headers=hdr("5.0.0.4", "guess"))
            assert r.status == 401
        r = await c.get("/api/token", headers=hdr("5.0.0.4", PASSCODE))
        assert r.status == 429, "guesses must consume the same budget as mints"

    run(go)


def test_verify_and_token_share_one_budget():
    """Otherwise /api/verify is a free, unlimited brute-force oracle."""

    async def go(c, _):
        for _i in range(10):
            await c.post("/api/verify", json={"passcode": "guess"}, headers=hdr("5.0.0.5"))
        r = await c.get("/api/token", headers=hdr("5.0.0.5", PASSCODE))
        assert r.status == 429

    run(go)


def test_forged_forwarded_for_cannot_mint_new_buckets():
    """nginx APPENDS the real peer to a client-supplied X-Forwarded-For, so only
    the last hop is trustworthy. Reading the first would let one caller rotate
    fake IPs and spend an unlimited budget."""

    async def go(c, _):
        for i in range(10):
            r = await c.get(
                "/api/token",
                headers={"X-Forwarded-For": f"9.9.9.{i}, 6.0.0.1", "X-Demo-Passcode": PASSCODE},
            )
            assert r.status == 200

        r = await c.get(
            "/api/token",
            headers={"X-Forwarded-For": "1.2.3.4, 6.0.0.1", "X-Demo-Passcode": PASSCODE},
        )
        assert r.status == 429, "budget must follow the real last hop, not the forged prefix"

    run(go)


def test_window_rolls_off_and_stale_buckets_are_swept():
    """The sweep is what keeps an in-memory limiter from growing forever on a
    public URL, and what lets a spent IP call again once its window passes."""
    mod = load_server(window="1")
    mod.RATE_WINDOW_SECONDS = 0.25

    async def go(c, m):
        for _i in range(10):
            await c.get("/api/token", headers=hdr("7.0.0.1", PASSCODE))
        r = await c.get("/api/token", headers=hdr("7.0.0.1", PASSCODE))
        assert r.status == 429

        await asyncio.sleep(0.3)
        r = await c.get("/api/token", headers=hdr("7.0.0.1", PASSCODE))
        assert r.status == 200, "the window must roll off"

        # a later request from any IP sweeps stale buckets rather than leaking them
        for _i in range(3):
            await c.get("/api/token", headers=hdr("7.0.0.2", PASSCODE))
        await asyncio.sleep(0.3)
        await c.get("/api/token", headers=hdr("7.0.0.3", PASSCODE))
        assert "7.0.0.1" not in m._hits
        assert "7.0.0.2" not in m._hits

    run(go, mod)
