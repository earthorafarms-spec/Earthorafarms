"""Unit tests for lecture_driver.py — run with plain `python test_lecture_driver.py`
(no pytest dependency, same convention as test_opening_marker.py).

These test the DRIVER'S OWN CONTRACT with fakes. They deliberately do not test
livekit internals — the two API facts the driver leans on (AgentSession.say
returning an awaitable SpeechHandle with .interrupted, and events
user_input_transcribed / agent_state_changed) were verified against
livekit-agents 1.3.12 in the running container before this was written.
"""

import asyncio
import json
import sys
import time

from lecture_driver import LectureDriver, extract_lecture, _units, _cue_runs, VB_TOPIC


# --------------------------------------------------------------------------
# fakes
# --------------------------------------------------------------------------
class FakeHandle:
    def __init__(self, interrupted=False, playout=0.01):
        self.interrupted = interrupted
        self._playout = playout

    def __await__(self):
        return asyncio.sleep(self._playout).__await__()


class FakeSession:
    def __init__(self, interrupt_at=(), playout=0.01):
        self.said = []            # every text handed to say(), in order
        self.handlers = {}
        self.playout = playout    # fake audio duration per say()
        self._interrupt_at = set(interrupt_at)  # 0-based say() indices

    def on(self, name):
        def reg(fn):
            self.handlers.setdefault(name, []).append(fn)
            return fn
        return reg

    def fire(self, name, **kw):
        ev = type("Ev", (), kw)()
        for fn in self.handlers.get(name, []):
            fn(ev)

    def say(self, text, allow_interruptions=True, add_to_chat_ctx=True):
        idx = len(self.said)
        self.said.append(text)
        return FakeHandle(interrupted=idx in self._interrupt_at, playout=self.playout)


class FakeParticipant:
    identity = "student@test"


class FakeLocalParticipant:
    def __init__(self):
        self.rpcs = []
        self.frames = []          # control frames sent on the board topic
        # The browser's side of the handshake. A test that drives the board
        # sets these from the lecture, exactly as the real page derives them
        # from the cell it was served.
        self.attempt_id = "attempt-test"
        self.script_digest = "sha256:" + "1" * 64
        self.board_version = 1
        self.topic_id = ""
        self.variant = ""
        # Browser-side handshake gate + what actually reached the board.
        self.handshake_complete = False
        self.applied_cue_ids = []
        # Opt-in: answer the cue carrying this seq with a forward-gap resync
        # request instead of an ack, the way the real client does when a cue
        # never arrived. Off by default so every other test is unaffected.
        self.resync_on_seq = None
        self.snapshots = []

    async def send_text(self, text, topic=None):
        self.frames.append((topic, json.loads(text)))
        return None

    async def perform_rpc(self, destination_identity, method, payload, response_timeout):
        """Stand in for the browser, which answers on the RPC RESPONSE.

        The board's control lane rides tool.call because ToolCallContext.room is
        never populated by the mentor package, so the browser cannot open a lane
        of its own. It therefore answers the init with its hello and every event
        with an ack, and this fake has to do the same or the handshake never
        completes and the driver correctly disables the board.
        """
        call = json.loads(payload)
        self.rpcs.append((method, call))
        name = call.get("name")

        if name == "visual_board_init":
            self.frames.append(("init", call))
            return json.dumps({
                "status": "ok",
                "hello": {
                    "type": "hello",
                    "protocol_version": 1,
                    "board_version": self.board_version,
                    "attempt_id": self.attempt_id,
                    "topic_id": self.topic_id,
                    "variant": self.variant,
                    "script_digest": self.script_digest,
                    "last_applied_seq": 0,
                    "capabilities": ["ack", "snapshot", "resync", "reduced_motion"],
                },
            })

        if name == "visual_board_event":
            frame = call.get("arguments", {}).get("frame")
            self.frames.append((VB_TOPIC, frame))
            kind = (frame or {}).get("type")

            # The browser runs its OWN handshake state machine and applies
            # nothing until it has actually SEEN an accepted ack. This fake
            # used to answer "ok, applied 1" to everything, so it could not
            # tell a delivered ack from an undelivered one — and the driver
            # shipped logging "handshake ACCEPTED" while the real browser
            # dropped every cue as handshake_incomplete. Model the gate.
            if kind == "ack":
                if (frame or {}).get("accepted"):
                    self.handshake_complete = True
                return json.dumps({"status": "ok", "applied": 0,
                                   "last_applied_seq": 0})

            if not self.handshake_complete:
                return json.dumps({"status": "ok", "applied": 0,
                                   "last_applied_seq": 0,
                                   "dropped": ["handshake_incomplete"]})

            if kind == "snapshot":
                self.snapshots.append(frame)
                return json.dumps({"status": "ok", "applied": 0,
                                   "last_applied_seq": (frame or {}).get("seq", 0)})

            if self.resync_on_seq is not None and (frame or {}).get("seq") == self.resync_on_seq:
                self.resync_on_seq = None      # ask exactly once
                return json.dumps({"status": "ok", "applied": 0,
                                   "resync": {"from_seq": (frame or {}).get("seq", 0)}})

            self.applied_cue_ids.append((frame or {}).get("cue_id"))
            return json.dumps({"status": "ok", "applied": 1,
                               "last_applied_seq": (frame or {}).get("seq", 0)})

        return "{}"


class FakeRoom:
    def __init__(self):
        self.remote_participants = {"p": FakeParticipant()}
        self.local_participant = FakeLocalParticipant()
        self.handlers = {}

    def register_text_stream_handler(self, topic, cb):
        self.handlers[topic] = cb


# --------------------------------------------------------------------------
# A. extract_lecture
# --------------------------------------------------------------------------
def test_extract():
    lec = {"v": 1, "beats": [{"n": 1, "say": "hello"}]}
    blob = f"[[SX-LECTURE]]{json.dumps(lec)}[[/SX-LECTURE]]"

    # marker mid-prompt (position independence — lesson L72)
    p, got = extract_lecture(f"PREFIX {blob} SUFFIX")
    assert got == lec, got
    assert p == "PREFIX  SUFFIX", repr(p)

    # no marker → byte-identical, None
    p2, got2 = extract_lecture("plain prompt")
    assert p2 == "plain prompt" and got2 is None

    # malformed JSON → marker stripped, no lecture, no crash
    p3, got3 = extract_lecture("A[[SX-LECTURE]]{oops[[/SX-LECTURE]]B")
    assert got3 is None and p3 == "AB", repr(p3)

    # empty beats → ignored
    _, got4 = extract_lecture('[[SX-LECTURE]]{"beats":[]}[[/SX-LECTURE]]')
    assert got4 is None
    print("A. extract_lecture OK")


# --------------------------------------------------------------------------
# B. _units — cue rendering + sentence chunking
# --------------------------------------------------------------------------
def test_units():
    u = _units("पहला वाक्य। दूसरा वाक्य। [PAUSE 3 sec] तीसरा वाक्य। [SLOW] चौथा [EMPHASIS]ज़रूरी[/EMPHASIS] वाक्य।")
    kinds = [("pause", x["pause"]) if "pause" in x else ("say", x["say"]) for x in u]
    # 2 sentences chunk together, then the REAL 3s pause, then the rest
    assert kinds[0][0] == "say" and "पहला" in kinds[0][1] and "दूसरा" in kinds[0][1], kinds[0]
    assert kinds[1] == ("pause", 3.0), kinds[1]
    assert kinds[2][0] == "say" and "तीसरा" in kinds[2][1] and "चौथा" in kinds[2][1], kinds[2]
    joined = " ".join(x["say"] for x in u if "say" in x)
    assert "[SLOW]" not in joined and "EMPHASIS" not in joined and "ज़रूरी" in joined
    # bare [PAUSE] → short breath
    u2 = _units("एक। [PAUSE] दो।")
    assert {"pause": 1.2} in u2, u2
    print("B. _units OK")


# --------------------------------------------------------------------------
# C. happy path — beats flow with zero LLM involvement
# --------------------------------------------------------------------------
async def test_happy():
    lec = {
        "check_wait": 0.2,
        "opening": "एक पंक्ति का स्वागत।",
        "beats": [
            {"n": 1, "say": "बीट एक का पहला वाक्य। बीट एक का दूसरा वाक्य।"},
            {"n": 2, "say": "बीट दो। [PAUSE 1 sec] रुककर आगे।"},
        ],
    }
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    t0 = time.monotonic()
    await d.run()
    dt = time.monotonic() - t0

    joined = " | ".join(s.said)
    assert s.said[0] == "एक पंक्ति का स्वागत।", s.said[0]
    assert "बीट एक" in joined and "रुककर आगे।" in joined
    boards = [p["arguments"]["beat_id"] for m, p in r.local_participant.rpcs if p["name"] == "board_show"]
    assert boards == [1, 2], boards
    assert dt >= 1.0, f"the authored [PAUSE 1 sec] must be real silence (took {dt:.2f}s)"
    print("C. happy path OK")


# --------------------------------------------------------------------------
# D. CHECK answered — student speaks, LLM reaction cycle runs, then `then`
# --------------------------------------------------------------------------
async def test_check_answered():
    lec = {
        "check_wait": 5.0,
        "beats": [{
            "n": 1, "say": "सवाल से पहले।",
            "ask": "क्या समझ आया?",
            "listen": {"on_silent": "कोई बात नहीं।", "then": "चलो आगे।"},
        }],
    }
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)

    async def student():
        while "क्या समझ आया?" not in s.said:           # wait for the ask itself
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.1)                       # thinking…
        s.fire("user_input_transcribed", is_final=True)  # answers
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="speaking")   # LLM reacts
        await asyncio.sleep(0.1)
        s.fire("agent_state_changed", new_state="listening")  # reaction done

    t0 = time.monotonic()
    await asyncio.gather(d.run(), student())
    dt = time.monotonic() - t0

    assert "क्या समझ आया?" in s.said
    assert "चलो आगे।" in s.said, s.said            # authored `then` delivered
    assert "कोई बात नहीं।" not in s.said, s.said   # on_silent NOT said — they answered
    assert dt < 4.5, f"answered check must not burn the full check_wait ({dt:.2f}s)"
    print("D. check answered OK")


# --------------------------------------------------------------------------
# E. CHECK silent — authored on_silent, never an improvised nudge
# --------------------------------------------------------------------------
async def test_check_silent():
    lec = {
        "check_wait": 0.3,
        "beats": [{
            "n": 1, "say": "सवाल से पहले।",
            "ask": "क्या समझ आया?",
            "listen": {"on_silent": "कोई बात नहीं, [SLOW] मैं बताती हूँ।", "then": "चलो आगे।"},
        }],
    }
    s, r = FakeSession(), FakeRoom()
    await LectureDriver(s, r, lec).run()
    assert any("कोई बात नहीं" in x for x in s.said), s.said
    assert not any("[SLOW]" in x for x in s.said), "cues must never reach TTS"
    assert s.said[-1] == "चलो आगे।", s.said
    print("E. check silent OK")


# --------------------------------------------------------------------------
# F. interruption — reaction plays out, the SAME unit is re-said
# --------------------------------------------------------------------------
async def test_interruption():
    lec = {"check_wait": 0.2, "beats": [{"n": 1, "say": "टोका गया वाक्य।"}]}
    s, r = FakeSession(interrupt_at={0}), FakeRoom()   # first say() gets interrupted
    d = LectureDriver(s, r, lec)

    async def reactor():
        while not s.said:
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="speaking")
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="listening")

    await asyncio.gather(d.run(), reactor())
    assert s.said.count("टोका गया वाक्य।") == 2, s.said  # said, interrupted, re-said
    print("F. interruption resume OK")


async def test_check_blurt():
    lec = {
        "check_wait": 5.0,
        "beats": [{
            "n": 1, "say": "सवाल से पहले।",
            "ask": "क्या समझ आया?",
            "listen": {"on_silent": "कोई बात नहीं।", "then": "चलो आगे।"},
        }],
    }
    s = FakeSession(interrupt_at={1})   # say#1 is the ask — the kid barges in over it
    r = FakeRoom()
    d = LectureDriver(s, r, lec)

    async def blurter():
        while "क्या समझ आया?" not in s.said:
            await asyncio.sleep(0.02)
        s.fire("user_input_transcribed", is_final=True)     # the blurted answer
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="speaking")
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="listening")

    await asyncio.gather(d.run(), blurter())
    assert s.said.count("क्या समझ आया?") == 1, s.said       # never re-asked
    assert "कोई बात नहीं।" not in s.said, s.said            # counted as answered
    assert s.said[-1] == "चलो आगे।", s.said
    print("G. blurted answer OK")


# --------------------------------------------------------------------------
# H-L. LIVE-VISUAL-BOARD-01 — authored visual cues
# --------------------------------------------------------------------------
def _cues(room):
    """(cue_id, ...) in the order the board received them.

    Reads the sx.visual-board.v1 control frames. The old assertion read a cue
    BODY out of a tool.call; that path is gone — the wire carries only ids.
    """
    return [f["cue_id"] for _t, f in room.local_participant.frames
            if f.get("type") == "cue"]


def _handshake(session, room, attempt="attempt-test"):
    """Align the FAKE BROWSER's identity with the lecture under test.

    The handshake now also rides the RPC bootstrap inside run(). Both are kept:
    the fake browser must answer with the identity the lecture declares (or the
    bootstrap's envelope check rightly refuses it and the board is disabled),
    and the direct hello is what lets the tests that drive internals without
    run() emit a cue at all.
    """
    from visual_board_protocol import BOARD_VERSION, PROTOCOL_VERSION
    lec = session.lec if hasattr(session, "lec") else {}
    lp = getattr(room, "local_participant", None)
    if lp is not None:
        lp.attempt_id = attempt
        lp.script_digest = str(lec.get("script_digest") or "")
        lp.board_version = BOARD_VERSION
        lp.topic_id = str(lec.get("topic_id") or "")
        lp.variant = str(lec.get("variant") or "")
    # Still performed directly, for the tests that drive internals without
    # run(). on_hello is idempotent for a MATCHING hello, so the RPC bootstrap
    # inside run() re-accepts the same attempt rather than refusing it.
    session._vb.on_hello({
        "type": "hello",
        "protocol_version": PROTOCOL_VERSION,
        "board_version": BOARD_VERSION,
        "attempt_id": attempt,
        "topic_id": str(lec.get("topic_id") or ""),
        "variant": str(lec.get("variant") or ""),
        "script_digest": str(lec.get("script_digest") or ""),
        "last_applied_seq": 0,
        "capabilities": ["ack"],
    })


async def test_cues_absent_is_noop():
    """The safety property the rollout rests on: a lesson with no visual_cues
    behaves exactly as before and sends nothing new. True of all 184 live cells."""
    lec = {"check_wait": 0.2, "beats": [
        {"n": 1, "say": "पहला वाक्य। दूसरा वाक्य।",
         "ask": "समझ आया?", "listen": {"on_silent": "ठीक है।", "then": "आगे।"}},
    ]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    await d.run()
    assert _cues(r) == [], _cues(r)
    names = {p["name"] for _m, p in r.local_participant.rpcs}
    assert names == {"board_show"}, names          # beat-level reveal still fires
    assert not d._cues, "no cue task may be left pending"
    print("H. no visual_cues means byte-identical behaviour OK")


async def test_cue_answer_never_precedes_response():
    """THE pedagogical invariant, at the transport layer: an after_response cue
    must not reach the board until the student has actually answered."""
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1", "check_wait": 5.0, "beats": [{
        "n": 1, "say": "दो रास्ते देखो।",
        "ask": "क्या दोनों एक ही जगह पहुँचेंगे?",
        "listen": {"on_silent": "संकेत।", "then": "आगे।"},
        "visual_cues": [
            {"id": "enter", "trigger": {"type": "beat_enter"},
             "actions": [{"type": "show", "object_id": "grid"}]},
            {"id": "reveal", "trigger": {"type": "after_response"},
             "actions": [{"type": "show", "object_id": "end_b"}]},
            {"id": "hint", "trigger": {"type": "on_silent"},
             "actions": [{"type": "point", "object_id": "start_b"}]},
        ],
    }]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    seen_before_answer = []

    async def student():
        while "क्या दोनों एक ही जगह पहुँचेंगे?" not in s.said:
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.1)                    # thinking — board must not reveal
        seen_before_answer.extend(_cues(r))
        s.fire("user_input_transcribed", is_final=True)
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="speaking")
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="listening")

    await asyncio.gather(d.run(), student())

    assert "reveal" not in seen_before_answer, seen_before_answer
    assert "enter" in seen_before_answer, seen_before_answer
    got = _cues(r)
    assert "reveal" in got, got
    assert got.index("enter") < got.index("reveal"), got
    assert "hint" not in got, "on_silent must not fire when the student answered"
    print("I. answer cue never precedes the response OK")


async def test_ack_is_delivered_to_the_browser():
    """The handshake is TWO-SIDED, and the agent accepting it is not enough.

    This is the defect that reached production: the driver called on_hello,
    logged "handshake ACCEPTED" and started sending cues — but never delivered
    the ack to the browser, which runs its own gate and dropped every one of
    them as handshake_incomplete. The board sat blank while both logs claimed
    success. Assert the ack actually goes over the wire, and that cues then
    land, rather than trusting the agent's own view of the handshake.
    """
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t",
        "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": "देखो।", "ask": "क्या लगता है?",
        "listen": {"on_silent": "संकेत।", "then": "आगे।"},
        "visual_cues": [
            {"id": "hint", "trigger": {"type": "on_silent"},
             "actions": [{"type": "point", "object_id": "start_b"}]},
        ],
    }]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    await d.run()

    lp = r.local_participant
    acks = [f for _t, f in lp.frames
            if isinstance(f, dict) and f.get("type") == "ack"]
    assert acks, "the accepted ack never reached the browser"
    assert acks[0].get("accepted") is True, acks[0]
    assert lp.handshake_complete, "the browser never completed its handshake"
    assert lp.applied_cue_ids == ["hint"], lp.applied_cue_ids
    print("J0. the ack reaches the browser and cues then apply OK")


async def test_undelivered_ack_disables_the_board():
    """If the ack cannot be delivered, the board must go UNDRIVEN rather than
    stream cues into a browser that will drop every one of them."""
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t",
        "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": "देखो।", "ask": "क्या लगता है?",
        "listen": {"on_silent": "संकेत।", "then": "आगे।"},
        "visual_cues": [
            {"id": "hint", "trigger": {"type": "on_silent"},
             "actions": [{"type": "point", "object_id": "start_b"}]},
        ],
    }]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)

    lp = r.local_participant
    inner = lp.perform_rpc

    async def refuse_ack(destination_identity, method, payload, response_timeout):
        call = json.loads(payload)
        frame = call.get("arguments", {}).get("frame") or {}
        if call.get("name") == "visual_board_event" and frame.get("type") == "ack":
            return json.dumps({"status": "no_board", "reason": "gone"})
        return await inner(destination_identity, method, payload, response_timeout)

    lp.perform_rpc = refuse_ack
    await d.run()

    assert d._vb is None, "an undeliverable ack must disable the board"
    assert lp.applied_cue_ids == [], lp.applied_cue_ids
    print("J0b. an undeliverable ack disables the board OK")


async def test_resync_is_answered_with_a_snapshot():
    """A forward gap must HEAL, or one dropped RPC blanks the board for good.

    `build_snapshot` was reachable only from `on_client_frame`, which is wired to
    the text-stream handler — the lane the browser can never use, because it has
    no Room. So the browser asked for a resync and NOTHING answered: it buffered
    to VB_MAX_BUFFERED_EVENTS and then dropped everything, and the board stopped
    drawing for the rest of the lesson with every log green. `_vb_send` even
    carried a comment claiming it honoured the request; it only logged it.
    """
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t",
        "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": "देखो।", "ask": "क्या लगता है?",
        "listen": {"on_silent": "संकेत।", "then": "आगे।"},
        "visual_cues": [
            {"id": "hint", "trigger": {"type": "on_silent"},
             "actions": [{"type": "point", "object_id": "start_b"}]},
        ],
    }]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)

    lp = r.local_participant
    inner = lp.perform_rpc

    async def gap_once(destination_identity, method, payload, response_timeout):
        call = json.loads(payload)
        frame = call.get("arguments", {}).get("frame") or {}
        if call.get("name") == "visual_board_event" and frame.get("type") == "cue" \
                and not getattr(lp, "_gapped", False):
            lp._gapped = True
            lp.frames.append((VB_TOPIC, frame))
            return json.dumps({"status": "ok", "applied": 0, "last_applied_seq": 0,
                               "resync": {"from_seq": 1, "reason": "gap"}})
        return await inner(destination_identity, method, payload, response_timeout)

    lp.perform_rpc = gap_once
    await d.run()

    snapshots = [f for _t, f in lp.frames
                 if isinstance(f, dict) and f.get("type") == "snapshot"]
    assert snapshots, "the resync request was never answered with a snapshot"
    assert snapshots[0].get("applied_cue_ids") == ["hint"], snapshots[0]
    print("J0c. a resync is answered with the authoritative snapshot OK")


async def test_cue_on_silent():
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": "देखो।", "ask": "क्या लगता है?",
        "listen": {"on_silent": "संकेत।", "then": "आगे।"},
        "visual_cues": [
            {"id": "reveal", "trigger": {"type": "after_response"},
             "actions": [{"type": "show", "object_id": "end_b"}]},
            {"id": "hint", "trigger": {"type": "on_silent"},
             "actions": [{"type": "point", "object_id": "start_b"}]},
        ],
    }]}
    s, r = FakeSession(), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    await d.run()
    got = _cues(r)
    assert got == ["hint"], got     # silence gets the hint, never the answer
    print("J. on_silent cue fires, answer stays hidden OK")


async def test_sentence_cues_scheduled_and_settled():
    """Sentence cues fire in authored order, exactly once each, whether they
    land via the playout timer or via the end-of-unit settle."""
    say = "Ek vaakya. Do vaakya. Teen vaakya."
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": say,
        "visual_cues": [
            {"id": "s0", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 0},
             "actions": [{"type": "show", "object_id": "a"}]},
            {"id": "s1", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 1},
             "actions": [{"type": "show", "object_id": "b"}]},
            {"id": "s2", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 2},
             "actions": [{"type": "show", "object_id": "c"}]},
            {"id": "oob", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 99},
             "actions": [{"type": "show", "object_id": "d"}]},
        ],
    }]}
    # Long enough playout that the scheduled timers genuinely fire mid-speech.
    s, r = FakeSession(playout=1.2), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    await d.run()
    got = _cues(r)
    assert got == ["s0", "s1", "s2"], got          # order preserved, oob skipped
    assert len(got) == len(set(got)), f"a cue was sent twice: {got}"
    assert not d._cues, "no cue task may outlive the lesson"
    print("K. sentence cues scheduled in order, out-of-range skipped OK")


async def test_sentence_cues_survive_interruption():
    """A barge-in cancels pending timers, but the board must still end the unit
    in the right state — otherwise asking a question silently costs the student
    whatever the rest of that unit was supposed to draw."""
    say = "Ek vaakya. Do vaakya. Teen vaakya."
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": say,
        "visual_cues": [
            {"id": f"s{i}", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": i},
             "actions": [{"type": "show", "object_id": f"o{i}"}]}
            for i in range(3)
        ],
    }]}
    s, r = FakeSession(interrupt_at={0}, playout=0.05), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)

    async def reactor():
        while not s.said:
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="speaking")
        await asyncio.sleep(0.05)
        s.fire("agent_state_changed", new_state="listening")

    await asyncio.gather(d.run(), reactor())
    got = _cues(r)
    assert sorted(got) == ["s0", "s1", "s2"], got
    assert len(got) == len(set(got)), f"a cue was sent twice: {got}"
    assert not d._cues
    print("L. cues survive a barge-in without duplicating OK")


async def test_cancel_cues_leaves_nothing_pending():
    """A closing session must not leave a timer alive that draws on a board the
    student has already left."""
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [{
        "n": 1, "say": "Ek. " + "x" * 400 + ". Do vaakya.",
        "visual_cues": [
            {"id": "late", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 2},
             "actions": [{"type": "show", "object_id": "z"}]},
        ],
    }]}
    s, r = FakeSession(playout=0.01), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    # P3: cues schedule only against MEASURED playout, so supply the aligned
    # transcript the way the agent's transcription_node tee would. Without it
    # nothing is scheduled early — which is the point of deleting the
    # character-rate estimate, and is asserted separately below.
    say = lec["beats"][0]["say"]
    d._sync.open_unit(say)
    for i, sent in enumerate(__import__("visual_cue_sync").split_sentences(say)):
        d.on_timed_string(sent + " ", i * 30.0)
    d._sync.on_playback_started(time.monotonic())
    d._schedule_sentence_cues(lec["beats"][0], 0, say)
    assert d._cues, "the late cue should be pending"
    d.cancel_cues()
    await asyncio.sleep(0.05)
    assert not d._cues, "cancel_cues must drain the set"
    assert _cues(r) == [], "a cancelled cue must never reach the board"
    print("M. cancel_cues drops pending timers OK")


async def test_no_measurement_means_no_early_cue():
    """P3 — the character-rate scheduler is GONE, with no replacement estimate.

    A sentence with no measured offset must not be scheduled early. It is
    emitted at the unit boundary instead, so the board can lag the voice but can
    never run ahead of it on a guess.
    """
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1",
        "check_wait": 0.2, "beats": [{
        "n": 1, "say": "Ek vaakya. Do vaakya. Teen vaakya.",
        "visual_cues": [
            {"id": "s1", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 1},
             "actions": [{"type": "show", "object_id": "z"}]},
        ],
    }]}
    s, r = FakeSession(playout=0.01), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    say = lec["beats"][0]["say"]
    d._sync.open_unit(say)                      # opened, but NO timed strings
    d._schedule_sentence_cues(lec["beats"][0], 0, say)
    assert not d._cues, "an unmeasured cue must not be scheduled early"
    assert d._unit_cues, "but it must still be settled at the unit boundary"
    await d._settle_unit_cues(lec["beats"][0], 0)
    assert _cues(r) == ["s1"], _cues(r)
    print("P. no measurement means no early cue OK")


async def test_cues_schedule_when_timing_arrives_after_the_pass():
    """LIVE-VISUAL-BOARD-01 — cues must arm in PRODUCTION order.

    Every other timing test feeds the aligned transcript and the playout origin
    BEFORE calling _schedule_sentence_cues. The driver does the opposite: the
    accept pass runs before `await say()`, and the measurements only arrive
    while the audio plays. Read once, up front, delay_for can only answer None
    — so nothing was ever scheduled and every cue fell to the end-of-unit
    settle. Beat 1 therefore left the board blank for the whole opening and then
    painted the unit in one burst, which is what "the board does nothing" looked
    like in production.

    This test asserts the real order, so it fails against a one-shot scheduler.
    """
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1",
        "check_wait": 0.2, "beats": [{
        "n": 1, "say": "Ek vaakya. Do vaakya. Teen vaakya.",
        "visual_cues": [
            {"id": "s0", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 0},
             "actions": [{"type": "show", "object_id": "a"}]},
            {"id": "s2", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 2},
             "actions": [{"type": "show", "object_id": "c"}]},
        ],
    }]}
    s, r = FakeSession(playout=0.01), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    say = lec["beats"][0]["say"]

    # --- production order ---------------------------------------------------
    d._sync.open_unit(say)
    d._schedule_sentence_cues(lec["beats"][0], 0, say)
    assert d._unit_cues, "both cues must be accepted"
    assert not d._cues, "nothing is measurable yet, so nothing may be armed yet"

    # Now the audio actually starts and the aligned chunks land, exactly as
    # agent.py's playback_started hook and transcription_node tee deliver them.
    import visual_cue_sync as vcs
    for i, sent in enumerate(vcs.split_sentences(say)):
        d.on_timed_string(sent + " ", i * 0.05)
    d.on_playback_started()

    assert d._cues, (
        "cues must arm once the measurements arrive — a one-shot scheduler "
        "leaves this empty and the whole unit lands late at settle")
    await asyncio.sleep(0.3)
    assert _cues(r) == ["s0", "s2"], _cues(r)

    # And the settle pass must not double-send what the timers already drew.
    await d._settle_unit_cues(lec["beats"][0], 0)
    assert _cues(r) == ["s0", "s2"], f"settle double-sent: {_cues(r)}"
    print("P2. cues arm when timing arrives after the accept pass OK")


async def test_resync_request_is_answered_with_a_snapshot():
    """LIVE-VISUAL-BOARD-01 — a forward gap must be closed, not just logged.

    The browser buffers a cue that arrives ahead of the sequence and asks for a
    resync. build_snapshot existed but was reachable ONLY from on_client_frame,
    which is wired to the text-stream lane the browser can never use — so the
    request was logged and dropped, the buffered run never drained, and the
    board stopped drawing for the rest of the lesson after a single lost cue.
    """
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t", "variant": "comfortable.vb1",
        "check_wait": 0.2, "beats": [{
        "n": 1, "say": "Ek vaakya. Do vaakya.",
        "visual_cues": [
            {"id": "g1", "trigger": {"type": "beat_enter"},
             "actions": [{"type": "show", "object_id": "a"}]},
        ],
    }]}
    s, r = FakeSession(playout=0.01), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    lp = r.local_participant
    # _handshake primes the AGENT side; this fake also runs the browser's own
    # gate, which only opens on a delivered ack. Open it directly — this test is
    # about what happens to a gap AFTER the handshake, not about the handshake.
    lp.handshake_complete = True
    lp.resync_on_seq = 1                       # the first cue comes back as a gap

    d._fire_cues(lec["beats"][0], "beat_enter")
    await asyncio.sleep(0.25)

    assert lp.snapshots, (
        "a resync request must be answered with a snapshot — logging it leaves "
        "the browser's buffer permanently stuck")
    snap = lp.snapshots[0]
    assert snap.get("attempt_id") == lp.attempt_id, snap
    assert "g1" in (snap.get("applied_cue_ids") or []), snap
    print("P3. a resync request is answered with a snapshot OK")


async def test_negotiation_matrix():
    """LIVE-VISUAL-BOARD-01 — the browser/agent/script compatibility matrix.

    Any one party saying no must mean zero cues. This is the gate the staged
    deploy rests on: agent-dark and browser-dark must both resolve to LEGACY.
    """
    import lecture_driver as ld

    def lec(client_version, with_cues, board_version=1):
        beat = {"n": 1, "say": "Ek vaakya."}
        if with_cues:
            beat["visual_cues"] = [
                {"id": "c", "trigger": {"type": "beat_enter"},
                 "actions": [{"type": "show", "object_id": "o"}]},
            ]
        out = {"check_wait": 0.2, "beats": [beat], "board_version": board_version}
        if client_version is not None:
            out["client_caps"] = {"visual_board": client_version}
        return out

    async def cues_sent(agent_flag, client_version, with_cues, board_version=1):
        prev = ld._VB_ENABLED
        ld._VB_ENABLED = agent_flag
        try:
            s, r = FakeSession(), FakeRoom()
            d = LectureDriver(s, r, lec(client_version, with_cues, board_version))
            if d._vb is not None:
                _handshake(d, r)
            await d.run()
            return len(_cues(r))
        finally:
            ld._VB_ENABLED = prev

    #        agent, client, cues, board_version -> expected
    matrix = [
        (True,  1,    True,  1, 1, "all four agree"),
        (False, 1,    True,  1, 0, "agent dark (deploy step 2)"),
        (True,  None, True,  1, 0, "browser dark — no client_caps at all (deploy step 3)"),
        (True,  0,    True,  1, 0, "browser advertises 0"),
        (True,  1,    False, 1, 0, "script has no cues — every live cell today"),
        (False, None, False, 1, 0, "nothing enabled anywhere"),
        # Audit P1-6: a future contract must NOT negotiate as driven and then
        # fail to render. An unknown script version is LEGACY.
        (True,  1,    True,  2, 0, "script declares contract v2 — unrenderable here"),
        (True,  1,    True,  0, 0, "script omits board_version entirely"),
    ]
    for agent_flag, client_version, with_cues, board_version, expected, why in matrix:
        got = await cues_sent(agent_flag, client_version, with_cues, board_version)
        assert got == expected, f"{why}: expected {expected} cue(s), got {got}"
    print("N. capability negotiation matrix OK")


async def test_negotiation_survives_garbage_caps():
    """A malformed client_caps must fail CLOSED, not throw and not enable."""
    import lecture_driver as ld
    prev = ld._VB_ENABLED
    ld._VB_ENABLED = True
    try:
        for bad in ["yes", None, {"visual_board": "abc"}, {"visual_board": None}, []]:
            s, r = FakeSession(), FakeRoom()
            lec = {"check_wait": 0.2, "client_caps": bad, "beats": [{
                "n": 1, "say": "Ek.",
                "visual_cues": [{"id": "c", "trigger": {"type": "beat_enter"},
                                 "actions": [{"type": "show", "object_id": "o"}]}],
            }]}
            await LectureDriver(s, r, lec).run()
            assert _cues(r) == [], f"garbage caps {bad!r} enabled the board"
    finally:
        ld._VB_ENABLED = prev
    print("O. malformed client_caps fails closed OK")


async def test_resume_uses_measured_playback():
    """P3 — resume comes from real playback_position, not characters.

    The interrupted unit must resume at the sentence that was IN PROGRESS, and
    with nothing measured it must restart rather than invent a cut point.
    """
    import visual_cue_sync as vcs
    say = "Ek vaakya. Do vaakya. Teen vaakya."
    lec = {"check_wait": 0.2, "beats": [{"n": 1, "say": say}]}
    s_, r = FakeSession(interrupt_at={0}, playout=0.02), FakeRoom()
    d = LectureDriver(s_, r, lec)

    d._sync.open_unit(say)
    for i, sent in enumerate(vcs.split_sentences(say)):
        d.on_timed_string(sent + " ", i * 4.0)
    d._sync.on_playback_started(time.monotonic())
    # The student cut in 5s of audio: inside sentence 1 (starts at 4.0).
    d.on_playback_finished(5.0, True)
    assert d._sync.resume_from(5.0) == 1, d._sync.resume_from(5.0)

    # Nothing measured at all -> restart, never a guessed offset.
    d2 = LectureDriver(FakeSession(), FakeRoom(), lec)
    d2._sync.open_unit(say)
    assert d2._sync.resume_from(3.0) is None
    print("Q. resume uses measured playback OK")


def test_cue_runs_split():
    """CUE-RUN SPLITTING — a unit is spoken as runs that BEGIN at each
    cue-bearing sentence, so mid-unit cues get a real playout origin. A unit
    with no mid-unit cues stays ONE utterance, byte-identical to before."""
    say = "Ek vaakya. Do vaakya. Teen vaakya. Chaar vaakya."
    # No cue sentences -> exactly one run, text unchanged.
    runs = _cue_runs(say, set())
    assert len(runs) == 1 and runs[0][0] == say and runs[0][1] == [0, 1, 2, 3], runs
    # Sentence-0 cue alone must NOT split (it already arms today).
    runs = _cue_runs(say, {0})
    assert len(runs) == 1 and runs[0][0] == say, runs
    # Mid-unit cues split at each cue sentence; indices keep authored numbering.
    runs = _cue_runs(say, {2})
    assert [r[1] for r in runs] == [[0, 1], [2, 3]], runs
    assert runs[1][0] == "Teen vaakya. Chaar vaakya.", runs
    # Multiple + out-of-range cue sentences: dedup, ignore 99.
    runs = _cue_runs(say, {1, 3, 99})
    assert [r[1] for r in runs] == [[0], [1, 2], [3]], runs
    print("R. cue runs split at cue sentences, no-cue unit unchanged OK")


async def test_mid_unit_cue_arms_from_run_playout():
    """THE 2026-08-06 DEFECT, inverted: with utterance-level timing (one
    aligned chunk per say(), start_time 0.0 — exactly what production
    delivers), a cue at sentence 2 must ARM from its own run's playout
    rather than fall to the end-of-unit settle."""
    say = "Ek vaakya. Do vaakya. Teen vaakya."
    beat = {"n": 1, "say": say, "visual_cues": [
        {"id": "late-img", "trigger": {"type": "sentence_start", "speech_unit": 0, "sentence": 2},
         "actions": [{"type": "show", "object_id": "img"}]},
    ]}
    lec = {"client_caps": {"visual_board": 1}, "board_version": 1,
        "script_digest": "sha256:" + "1" * 64, "topic_id": "t",
        "variant": "comfortable.vb1", "check_wait": 0.2, "beats": [beat]}
    s, r = FakeSession(playout=0.05), FakeRoom()
    d = LectureDriver(s, r, lec)
    _handshake(d, r)
    d._schedule_sentence_cues(beat, 0, say)
    runs = _cue_runs(say, d._unit_cue_sentences(beat, 0))
    assert [rn[1] for rn in runs] == [[0, 1], [2]], runs
    # Speak run 2 the way run() does, feeding ONLY utterance-level timing —
    # one chunk for the whole run at start_time 0.0.
    run_text, run_indices = runs[1]
    d._sync.open_unit(run_text, original_indices=run_indices)
    d.on_timed_string(run_text, 0.0)
    d.on_playback_started()
    assert "late-img" in d._unit_scheduled, (
        "a mid-unit cue must arm from its run's playout, not wait for settle")
    await asyncio.sleep(0.05)
    assert _cues(r) == ["late-img"], _cues(r)
    d._sync.close_unit()
    d.cancel_cues()
    print("S. mid-unit cue arms at its run's playout (utterance-level timing) OK")


def main():
    # LIVE-VISUAL-BOARD-01 — the cue tests exercise a NEGOTIATED lesson, so the
    # agent-side rollout flag is on for them. test_negotiation_matrix flips it
    # per-case, and test H proves a lesson without cues is unaffected either way.
    import lecture_driver as ld
    ld._VB_ENABLED = True
    test_extract()
    test_units()
    asyncio.run(test_happy())
    asyncio.run(test_check_answered())
    asyncio.run(test_check_silent())
    asyncio.run(test_interruption())
    asyncio.run(test_check_blurt())
    asyncio.run(test_cues_absent_is_noop())
    asyncio.run(test_cue_answer_never_precedes_response())
    asyncio.run(test_ack_is_delivered_to_the_browser())
    asyncio.run(test_undelivered_ack_disables_the_board())
    asyncio.run(test_resync_is_answered_with_a_snapshot())
    asyncio.run(test_cue_on_silent())
    asyncio.run(test_sentence_cues_scheduled_and_settled())
    asyncio.run(test_sentence_cues_survive_interruption())
    asyncio.run(test_cancel_cues_leaves_nothing_pending())
    asyncio.run(test_no_measurement_means_no_early_cue())
    asyncio.run(test_cues_schedule_when_timing_arrives_after_the_pass())
    asyncio.run(test_resync_request_is_answered_with_a_snapshot())
    asyncio.run(test_resume_uses_measured_playback())
    asyncio.run(test_negotiation_matrix())
    asyncio.run(test_negotiation_survives_garbage_caps())
    test_cue_runs_split()
    asyncio.run(test_mid_unit_cue_arms_from_run_playout())
    print("\nALL LECTURE-DRIVER TESTS PASSED")


if __name__ == "__main__":
    sys.exit(main())
