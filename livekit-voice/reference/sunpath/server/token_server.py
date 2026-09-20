"""Tiny token endpoint for the web demo.

The browser cannot hold LiveKit API secrets, so it calls GET /api/token and gets
a short-lived join token for a fresh room. nginx serves web/ and proxies
/api/token here. That is the ONLY backend surface the demo has.

sun.myscanhub.com is a public URL, and every minted token can pull a Chirp STT +
Vertex + Chirp3-HD session into being. So the mint is gated twice:

  1. DEMO_PASSCODE — required, constant-time compared. No code, no token.
  2. Per-IP rate limit — the actual cost ceiling. It counts EVERY attempt,
     including rejected ones, so it bounds passcode guessing as well as spend.

/api/verify exists so the page can check a code once (on unlock) without burning
a room; it shares the same budget. /api/health stays open for monitoring.

Run:  python -m server.token_server        (defaults to 127.0.0.1:8092)
"""

from __future__ import annotations

import datetime
import hmac
import os
import secrets
import time
from collections import deque
from pathlib import Path

from aiohttp import web
from dotenv import load_dotenv
from livekit import api

# pm2 does not load .env; without this every /api/token returns 503
# livekit_not_configured. Must precede the module-level os.environ reads.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Must match agent/main.py's WorkerOptions(agent_name=...) or the agent is never
# dispatched and the caller sits in an empty room.
AGENT_NAME = os.environ.get("AGENT_NAME", "sunpath-receptionist")

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "").strip()

HOST = os.environ.get("TOKEN_SERVER_HOST", "127.0.0.1")
PORT = int(os.environ.get("TOKEN_SERVER_PORT", "8092"))
ROOM_PREFIX = os.environ.get("ROOM_PREFIX", "sunpath-demo")
TOKEN_TTL_MINUTES = int(os.environ.get("TOKEN_TTL_MINUTES", "20"))

DEMO_PASSCODE = os.environ.get("DEMO_PASSCODE", "").strip()

# 10 requests / 10 min per IP. Sized for the real demo shape: one unlock plus a
# re-tap roughly every minute. It is deliberately not generous — an unattended
# public URL is exactly what this exists to bound.
RATE_MAX = int(os.environ.get("DEMO_RATE_MAX", "10"))
RATE_WINDOW_SECONDS = int(os.environ.get("DEMO_RATE_WINDOW_SECONDS", "600"))

# ip -> deque[monotonic timestamps]. In-memory on purpose: a pm2 restart clearing
# the counters is acceptable for a demo, and it keeps the footprint (TEARDOWN.md)
# at zero extra services.
_hits: dict[str, deque[float]] = {}


def client_ip(request: web.Request) -> str:
    """The caller's address, as seen through nginx.

    request.remote is 127.0.0.1 for every caller — nginx proxies from loopback —
    so X-Forwarded-For is what actually separates one demo phone from another.

    DEPLOY REQUIREMENT: the sun.myscanhub.com server block must send
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    Without it every visitor shares one bucket and the 11th request of any kind
    429s the whole demo.

    Only the LAST hop is trusted: $proxy_add_x_forwarded_for APPENDS the real
    peer to whatever the client sent, so the earlier entries are attacker-supplied
    and would otherwise let one IP forge an unlimited number of buckets. (The DNS
    record is grey-cloud/DNS-only per TEARDOWN.md, so nginx is the only proxy in
    front and there is no second legitimate hop to account for.)
    """
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        last = xff.split(",")[-1].strip()
        if last:
            return last
    return request.remote or "unknown"


def rate_limited(ip: str) -> bool:
    """True when this IP has spent its budget. Counts the current request."""
    now = time.monotonic()
    cutoff = now - RATE_WINDOW_SECONDS

    # Sweep expired buckets inline rather than on a timer: this endpoint is touched
    # a handful of times per demo, so the dict never grows enough to make the pass
    # cost anything, and there is no background task to leak or to tear down.
    for stale in [k for k, q in _hits.items() if not q or q[-1] < cutoff]:
        _hits.pop(stale, None)

    q = _hits.setdefault(ip, deque())
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) >= RATE_MAX:
        return True
    q.append(now)
    return False


async def read_passcode(request: web.Request) -> str:
    """Header first, then a POST JSON body.

    Deliberately NOT read from the query string: nginx writes full request lines
    to access.log, and a passcode in a URL would be logged, cached, and pasted
    around in shared links.
    """
    supplied = request.headers.get("X-Demo-Passcode", "")
    if not supplied and request.method == "POST":
        try:
            body = await request.json()
        except Exception:
            body = None
        if isinstance(body, dict):
            supplied = str(body.get("passcode") or "")
    return supplied.strip()


def passcode_ok(supplied: str) -> bool:
    # Compare bytes, not str: compare_digest's str form raises TypeError on any
    # non-ASCII, and this value arrives straight off the network.
    return hmac.compare_digest(
        supplied.encode("utf-8"), DEMO_PASSCODE.encode("utf-8")
    )


async def guard(request: web.Request) -> web.Response | None:
    """Returns the rejection Response, or None when the request may proceed."""
    if rate_limited(client_ip(request)):
        return web.json_response({"error": "rate_limited"}, status=429)

    # Fail CLOSED. Without this branch an unset env var makes the compare below
    # "" == "" and hands the public URL a free Chirp + Vertex session — the exact
    # thing the gate exists to prevent. A dead demo beats an open meter.
    if not DEMO_PASSCODE:
        return web.json_response({"error": "passcode_not_configured"}, status=503)

    if not passcode_ok(await read_passcode(request)):
        return web.json_response({"error": "bad_passcode"}, status=401)
    return None


async def health(_: web.Request) -> web.Response:
    # Open by design: monitoring must not hold the passcode, and this mints nothing.
    return web.json_response({"ok": True})


async def verify(request: web.Request) -> web.Response:
    """Check a passcode without minting a room.

    The page calls this once, when the caller unlocks the gate, so a wrong code is
    caught at the input instead of surfacing later as a generic "connection lost"
    after the mic permission prompt.
    """
    denied = await guard(request)
    if denied is not None:
        return denied
    return web.json_response({"ok": True})


async def token(request: web.Request) -> web.Response:
    denied = await guard(request)
    if denied is not None:
        return denied

    if not (LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET):
        return web.json_response({"error": "livekit_not_configured"}, status=503)

    # One fresh room per tap: a demo is repeated back-to-back in a meeting room,
    # and reusing a room would drop the new joiner into the previous session's
    # conversation history.
    room = f"{ROOM_PREFIX}-{secrets.token_hex(4)}"
    identity = f"caller-{secrets.token_hex(3)}"

    grant = api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True)
    # EXPLICIT dispatch. The Sun worker registers with agent_name, so it never
    # auto-joins anything - it has to be named here. This is also what keeps the
    # two agents on this shared LiveKit project apart: the live MyScanHub
    # receptionist is dispatched by its own SIP rule, and this token can only
    # ever pull in the Sun agent.
    room_config = api.RoomConfiguration(
        agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME)],
    )
    jwt = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name("Caller")
        .with_grants(grant)
        .with_room_config(room_config)
        .with_ttl(datetime.timedelta(minutes=TOKEN_TTL_MINUTES))
        .to_jwt()
    )
    return web.json_response({"token": jwt, "url": LIVEKIT_URL, "room": room})


def build_app() -> web.Application:
    app = web.Application()
    app.add_routes([
        web.get("/api/token", token),
        web.post("/api/token", token),
        web.post("/api/verify", verify),
        web.get("/api/health", health),
    ])
    return app


if __name__ == "__main__":
    web.run_app(build_app(), host=HOST, port=PORT)
