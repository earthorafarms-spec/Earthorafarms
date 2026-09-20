"""LIVE-VISUAL-BOARD-01 / brief P2 — agent side of `sx.visual-board.v1`.

The browser owns ordering and recovery; this side owns IDENTITY and HISTORY:

  - it decides whether a hello is compatible, and answers with an exact ack
    BEFORE any cue is sent (no half-driven state);
  - it allocates the monotonic sequence;
  - it keeps an attempt-scoped log so a reconnecting or gapped browser can be
    answered with an authoritative snapshot;
  - it NEVER replays events from an older attempt or a different digest.

Pure: no LiveKit, no asyncio, no timers. The driver hands it facts and sends the
frames it returns, which is what makes the failure cases testable.

The wire carries a cue_id, never a cue body. The browser resolves that id inside
the script it was already served, so nothing on the room can introduce a drawing
instruction the published script does not contain.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from visual_board_contract import VB_CONTRACT

PROTOCOL_TOPIC = "sx.visual-board.v1"
PROTOCOL_VERSION = 1
BOARD_VERSION = int(VB_CONTRACT["contract_version"])

# Bounded so one long lesson cannot grow the log without limit. A snapshot
# carries applied cue ids, so trimming the head costs nothing recoverable.
MAX_LOG_EVENTS = 2000


class VisualBoardSession:
    """One attempt. A new attempt means a new instance — never a reset."""

    def __init__(self, *, script_digest: str, topic_id: str, variant: str) -> None:
        self.script_digest = script_digest
        self.topic_id = topic_id
        self.variant = variant
        self.attempt_id: str | None = None
        self.seq = 0
        self.applied_cue_ids: list[str] = []
        self.log: list[dict[str, Any]] = []
        self.handshake_complete = False
        self.reject_reason: str | None = None

    # -- handshake ---------------------------------------------------------
    def on_hello(self, hello: Any) -> dict[str, Any]:
        """Decide the ack. Any incompatibility is a REFUSAL, never a downgrade.

        A refused ack leaves the browser on its legacy board, which is the
        correct outcome for a mismatch: a partially-driven board is worse than
        an undriven one.
        """
        if isinstance(hello, (str, bytes)):
            try:
                hello = json.loads(hello)
            except (ValueError, TypeError):
                return self._refuse(None, "malformed_hello")
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            return self._refuse(None, "malformed_hello")

        attempt = hello.get("attempt_id")
        if not isinstance(attempt, str) or not attempt:
            return self._refuse(None, "missing_attempt_id")
        if hello.get("protocol_version") != PROTOCOL_VERSION:
            return self._refuse(attempt, "protocol_version_mismatch")
        if hello.get("board_version") != BOARD_VERSION:
            return self._refuse(attempt, "board_version_mismatch")
        if hello.get("script_digest") != self.script_digest:
            return self._refuse(attempt, "digest_mismatch")
        if hello.get("topic_id") != self.topic_id or hello.get("variant") != self.variant:
            return self._refuse(attempt, "content_mismatch")

        self.attempt_id = attempt
        self.handshake_complete = True
        self.reject_reason = None
        return {
            "type": "ack",
            "protocol_version": PROTOCOL_VERSION,
            "board_version": BOARD_VERSION,
            "attempt_id": attempt,
            "script_digest": self.script_digest,
            "accepted": True,
        }

    def _refuse(self, attempt: str | None, reason: str) -> dict[str, Any]:
        self.handshake_complete = False
        self.reject_reason = reason
        return {
            "type": "ack",
            "protocol_version": PROTOCOL_VERSION,
            "board_version": BOARD_VERSION,
            "attempt_id": attempt or "",
            "script_digest": self.script_digest,
            "accepted": False,
            "reason": reason,
        }

    # -- events ------------------------------------------------------------
    def build_cue_event(
        self,
        *,
        cue_id: str,
        beat_no: int,
        unit_index: int,
        sentence_index: int,
        scheduled_at_ms: float,
        sent_at_ms: float,
    ) -> dict[str, Any] | None:
        """Next event, or None when no board is driven.

        Returning None rather than raising matters: the driver calls this on the
        hot path and a lesson must never fail because the board cannot run.
        """
        if not self.handshake_complete or not self.attempt_id:
            return None
        self.seq += 1
        event = {
            "type": "cue",
            "protocol_version": PROTOCOL_VERSION,
            "board_version": BOARD_VERSION,
            "attempt_id": self.attempt_id,
            "script_digest": self.script_digest,
            "event_id": f"{self.attempt_id}:{self.seq}:{uuid.uuid4().hex[:8]}",
            "seq": self.seq,
            "beat_no": int(beat_no),
            "cue_id": str(cue_id),
            "cursor": {
                "beat_no": int(beat_no),
                "unit_index": int(unit_index),
                "sentence_index": int(sentence_index),
            },
            "scheduled_at_ms": round(float(scheduled_at_ms), 3),
            "sent_at_ms": round(float(sent_at_ms), 3),
        }
        self.log.append(event)
        self.applied_cue_ids.append(str(cue_id))
        if len(self.log) > MAX_LOG_EVENTS:
            del self.log[: len(self.log) - MAX_LOG_EVENTS]
        return event

    def build_snapshot(self, requesting_attempt: str | None = None) -> dict[str, Any] | None:
        """Authoritative state for THIS attempt.

        A request naming a different attempt is answered with None — replaying a
        previous attempt's board into a new one is exactly the bug that makes a
        replayed lesson open fully drawn.
        """
        if not self.handshake_complete or not self.attempt_id:
            return None
        if requesting_attempt is not None and requesting_attempt != self.attempt_id:
            return None
        return {
            "type": "snapshot",
            "protocol_version": PROTOCOL_VERSION,
            "board_version": BOARD_VERSION,
            "attempt_id": self.attempt_id,
            "script_digest": self.script_digest,
            "seq": self.seq,
            "applied_cue_ids": list(self.applied_cue_ids),
        }

    def on_client_frame(self, raw: Any) -> dict[str, Any] | None:
        """Handle an inbound browser frame; returns a frame to send, or None."""
        if isinstance(raw, (str, bytes)):
            try:
                raw = json.loads(raw)
            except (ValueError, TypeError):
                return None
        if not isinstance(raw, dict):
            return None
        kind = raw.get("type")
        if kind == "hello":
            return self.on_hello(raw)
        if kind in ("resync", "ack"):
            # An ack is informational; a resync is answered with the snapshot.
            if kind == "resync":
                return self.build_snapshot(raw.get("attempt_id"))
            return None
        return None
