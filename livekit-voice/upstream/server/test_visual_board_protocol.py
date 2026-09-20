"""BRIEF P2 — agent side of sx.visual-board.v1.

Run with plain `python test_visual_board_protocol.py` (same convention as the
other suites here — no pytest dependency).
"""

import json
import sys

from visual_board_protocol import (
    BOARD_VERSION,
    PROTOCOL_TOPIC,
    PROTOCOL_VERSION,
    VisualBoardSession,
)

DIGEST = "sha256:" + "1" * 64
OTHER = "sha256:" + "2" * 64
TOPIC = "cbse-c9-math-ch01-t01-coordinates-introduction"
VARIANT = "comfortable.vb1"

passed = 0
failed = 0


def t(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))


def session():
    return VisualBoardSession(script_digest=DIGEST, topic_id=TOPIC, variant=VARIANT)


def hello(**over):
    h = {
        "type": "hello",
        "protocol_version": PROTOCOL_VERSION,
        "board_version": BOARD_VERSION,
        "attempt_id": "attempt-a",
        "topic_id": TOPIC,
        "variant": VARIANT,
        "script_digest": DIGEST,
        "last_applied_seq": 0,
        "capabilities": ["ack", "snapshot", "resync"],
    }
    h.update(over)
    return h


print("\nP2 agent — handshake")
t("the control topic is dedicated, never chat", PROTOCOL_TOPIC == "sx.visual-board.v1")

s = session()
t("no cue can be built before a hello", s.build_cue_event(
    cue_id="c1", beat_no=1, unit_index=0, sentence_index=0,
    scheduled_at_ms=0, sent_at_ms=0) is None)

ack = s.on_hello(hello())
t("a compatible hello is accepted", ack["accepted"] is True and s.handshake_complete)
t("the ack echoes attempt and digest exactly",
  ack["attempt_id"] == "attempt-a" and ack["script_digest"] == DIGEST)

for label, over, reason in [
    ("protocol version", {"protocol_version": 2}, "protocol_version_mismatch"),
    ("board version", {"board_version": 99}, "board_version_mismatch"),
    ("digest", {"script_digest": OTHER}, "digest_mismatch"),
    ("topic", {"topic_id": "other-topic"}, "content_mismatch"),
    ("variant", {"variant": "express.vb1"}, "content_mismatch"),
    ("missing attempt", {"attempt_id": ""}, "missing_attempt_id"),
]:
    fresh = session()
    a = fresh.on_hello(hello(**over))
    t(f"{label} mismatch is REFUSED", a["accepted"] is False and a["reason"] == reason,
      json.dumps(a))
    t(f"...and {label} leaves the board undriven", fresh.handshake_complete is False)

t("a malformed hello is refused, not raised",
  session().on_hello("{not json")["reason"] == "malformed_hello")

print("\nP2 agent — events")
s = session()
s.on_hello(hello())
e1 = s.build_cue_event(cue_id="b01-c", beat_no=1, unit_index=0, sentence_index=0,
                       scheduled_at_ms=100.5, sent_at_ms=101.25)
e2 = s.build_cue_event(cue_id="b02-c", beat_no=2, unit_index=0, sentence_index=1,
                       scheduled_at_ms=200, sent_at_ms=201)
t("sequence starts at 1 and increments", e1["seq"] == 1 and e2["seq"] == 2)
t("event ids are unique", e1["event_id"] != e2["event_id"])
t("the event carries a cue_id and NO cue body",
  e1["cue_id"] == "b01-c" and "actions" not in e1 and "cue" not in e1)
t("the event is bound to attempt and digest",
  e1["attempt_id"] == "attempt-a" and e1["script_digest"] == DIGEST)
t("timing fields are carried for the evidence bundle",
  e1["scheduled_at_ms"] == 100.5 and e1["sent_at_ms"] == 101.25)
t("the cursor is explicit",
  e2["cursor"] == {"beat_no": 2, "unit_index": 0, "sentence_index": 1})

print("\nP2 agent — snapshot and resync")
snap = s.build_snapshot()
t("snapshot reports the current sequence", snap["seq"] == 2)
t("snapshot lists applied cue ids in order",
  snap["applied_cue_ids"] == ["b01-c", "b02-c"])
t("a resync for THIS attempt is answered",
  s.on_client_frame({"type": "resync", "attempt_id": "attempt-a"})["type"] == "snapshot")
t("a resync naming a DIFFERENT attempt is refused",
  s.on_client_frame({"type": "resync", "attempt_id": "attempt-old"}) is None)

fresh = session()
t("a snapshot before the handshake is refused", fresh.build_snapshot() is None)

print("\nP2 agent — a new attempt is a new session")
s2 = VisualBoardSession(script_digest=DIGEST, topic_id=TOPIC, variant=VARIANT)
s2.on_hello(hello(attempt_id="attempt-b"))
t("the new attempt starts its sequence at zero", s2.seq == 0)
e = s2.build_cue_event(cue_id="b01-c", beat_no=1, unit_index=0, sentence_index=0,
                       scheduled_at_ms=0, sent_at_ms=0)
t("its first event is seq 1 under the NEW attempt id",
  e["seq"] == 1 and e["attempt_id"] == "attempt-b")
t("it carries no history from the previous attempt", s2.applied_cue_ids == ["b01-c"])

print("\nP2 agent — a digest change forces a refusal")
s3 = session()
a = s3.on_hello(hello(script_digest=OTHER))
t("a browser serving different content cannot drive this board",
  a["accepted"] is False and a["reason"] == "digest_mismatch")

print(f"\n{failed} FAILED" if failed else f"\nall {passed} agent-protocol assertions passed")
sys.exit(1 if failed else 0)
