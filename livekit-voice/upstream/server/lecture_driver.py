"""LECTURE-DRIVER (2026-07-28) — deterministic delivery of a v3 teaching script.

WHY THIS EXISTS. The Live Teacher surface fed the whole authored lecture to the
LLM and asked it to read the beats aloud, calling board_show per beat. Measured
against real sessions that architecture cannot stop being a slide deck:

  - every beat boundary is an LLM generation boundary (turn ends, silence,
    the [[SX-AUTOCONTINUE]] timer kicks it onward: 26 beats = 26 stutters);
  - every board_show is an RPC round-trip that pauses generation (~1.5-2s of
    audible seam per beat, measured in the agent log);
  - prompt contracts ("KEEP GOING, only a [CHECK] ends your turn") measured
    2.3-3.8 beats/turn over the bare chat API but did NOT survive the live
    voice pipeline's turn machinery — the 2026-07-28 17:27 session still
    advanced every single beat off the silence timer.

The owner's verdict: "like slides provided to agent... a lecture delivery is
like story telling not a presentation. we need to think and fix it from root."

THE ROOT FIX. A teaching_script.v3 lecture is authored word-for-word, validated
at 130-140 wpm by ts-validate.mjs, with delivery cues. Reading it out is a tape
recorder's job, not an LLM's. So:

  - narration = session.say(authored text) straight through TTS — no LLM, no
    turn boundaries, no tool seams. The voice never stops between beats.
  - the board  = this driver fires the SAME tool.call RPC the LLM used to,
    right as each beat's audio starts. Zero generation pause.
  - [PAUSE n]  = real asyncio.sleep silence (what spec V3.5 always claimed).
  - the LLM    = reactions ONLY: when the student answers a [CHECK] question
    or interrupts mid-lecture. That is what LLMs are for — responding to a
    child, not reciting a fixed script.

By construction this preserves every authored property: the Hinglish register
(TTS reads the exact Devanagari), the word budget (= duration), the chunk
stitching, the check cadence. An entire class of delivery defects — paraphrase,
compression, register drift, per-beat stalls — becomes impossible rather than
discouraged.

TRANSPORT. The client embeds [[SX-LECTURE]]{json}[[/SX-LECTURE]] inside the
system prompt it already fully controls (same position-independent splice as
the other [[SX-*]] directives; NOT the @schoolexl/mentor package or the token
server, both of which are deploy-frozen — see lesson L70). extract_lecture()
strips it before any prepend reaches the model. Surfaces that do not send the
marker are byte-for-byte unaffected. DEPLOY ORDER: this agent must ship BEFORE
the web2 build that emits the marker, or the JSON leaks into the LLM prompt as
literal text (same rule as the other SX markers).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any

from loguru import logger

_OPEN = "[[SX-LECTURE]]"
_CLOSE = "[[/SX-LECTURE]]"

# Delivery cues authored per teach-mode-script-spec.md V3.5. [PAUSE] family
# becomes real silence here; [SLOW]/[EMPHASIS] have no per-utterance TTS lever
# (speaking_rate is fixed at session build) so they are stripped, words kept.
_PAUSE_RE = re.compile(r"\[PAUSE(?: (\d+)(?: sec)?)?\]")
_STRIP_RE = re.compile(r"\[/?EMPHASIS\]|\[SLOW\]")
# Devanagari danda/double-danda end sentences alongside . ! ?
_SENT_RE = re.compile(r"[^।॥.!?]+[।॥.!?]*\s*")

# Backstop only — see _sentences. Real stretches top out near 1300 chars; this
# exists so a malformed script can never hand one unbounded string to say().
_MAX_UNIT = 4000

# LIVE-VISUAL-BOARD-01 / P3: the 11-characters-per-second estimate has been
# REMOVED. Cue scheduling and speech resume both use measured TTS timing now
# (visual_cue_sync.VisualCueSynchronizer), fed by the aligned transcript and
# PlaybackStarted/PlaybackFinished. It is deliberately not kept as a fallback:
# an unmeasured sentence must not fire early, and an unmeasured cut must restart
# the unit rather than land on a guessed offset.

# ── LIVE-VISUAL-BOARD-01: rollout flag + capability negotiation ─────────────
# The agent ships with this OFF and is enabled deliberately, per environment.
# An unset variable must never turn a pilot surface on in production.
_VB_TRUTHY = {"1", "true", "on", "yes"}
_VB_ENABLED = os.getenv("SX_VISUAL_BOARD", "").strip().lower() in _VB_TRUTHY
# The scene-contract version this agent speaks. A browser advertising less than
# this is treated as incapable — we never send a cue a client cannot render.
_VB_AGENT_VERSION = 1

# The dedicated control topic. Board frames never travel on lk.chat, the learner
# transcript, or anything the LLM can see.
try:
    from visual_board_protocol import PROTOCOL_TOPIC as VB_TOPIC, VisualBoardSession
except Exception:  # pragma: no cover - the board simply stays undriven
    VB_TOPIC = "sx.visual-board.v1"
    VisualBoardSession = None  # type: ignore[assignment]

from visual_cue_sync import VisualCueSynchronizer

# Student lesson controls (pause/play, hand-raise, seek) ride their own topic,
# exactly like the board: never lk.chat, never the LLM context.
LECTURE_CONTROL_TOPIC = "sx.lecture.control.v1"


def extract_lecture(system_prompt: str):
    """Return (prompt_without_directive, lecture_dict_or_None).

    Position-independent, delimiter-based (the JSON may contain any characters
    except the literal close marker, which no authored text contains). A prompt
    with no marker — or a malformed one — is returned completely untouched, so
    non-participating surfaces cannot be affected. Same contract as
    _extract_opening (lesson L72: never assume the marker's position).
    """
    if not system_prompt:
        return system_prompt, None
    i = system_prompt.find(_OPEN)
    if i < 0:
        return system_prompt, None
    j = system_prompt.find(_CLOSE, i + len(_OPEN))
    if j < 0:
        return system_prompt, None
    raw = system_prompt[i + len(_OPEN): j]
    cleaned = system_prompt[:i] + system_prompt[j + len(_CLOSE):]
    try:
        lec = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning(f"[lecture] SX-LECTURE present but not valid JSON ({e}) — ignoring")
        return cleaned, None
    if not isinstance(lec, dict) or not isinstance(lec.get("beats"), list) or not lec["beats"]:
        logger.warning("[lecture] SX-LECTURE JSON has no beats — ignoring")
        return cleaned, None
    return cleaned, lec


def _units(say: str) -> list[dict[str, Any]]:
    """Render one beat's authored text into an ordered list of delivery units:
    {"say": text} and {"pause": seconds}.

    Speech is NOT sub-chunked: each authored stretch between [PAUSE] cues is one
    unit, i.e. one session.say(). See _sentences for why, and _say for how an
    interruption is resumed without replaying the whole stretch.
    """
    out: list[dict[str, Any]] = []
    text = _STRIP_RE.sub(" ", str(say or ""))
    pos = 0
    for m in _PAUSE_RE.finditer(text):
        before = text[pos:m.start()]
        out.extend({"say": u} for u in _sentences(before))
        secs = min(5.0, float(m.group(1)) if m.group(1) else 1.2)
        out.append({"pause": secs})
        pos = m.end()
    out.extend({"say": u} for u in _sentences(text[pos:]))
    return out


def _spoken(text: str) -> str:
    """Cue-strip for the fields spoken OUTSIDE _units (ask / on_silent / then):
    a [PAUSE] there has no meaning — the check flow IS the pause — so it must
    never be read aloud."""
    return re.sub(r"\s+", " ", _PAUSE_RE.sub(" ", _STRIP_RE.sub(" ", str(text or "")))).strip()


def _cue_runs(text: str, cue_sentences: set[int]) -> list[tuple[str, list[int]]]:
    """Split one speech unit into say() RUNS that BEGIN at cue sentences.

    WHY (owner report 2026-08-06: "image appears at the end for a micro
    second"): the TTS-aligned transcript delivers ONE timing chunk per say()
    utterance, so VisualCueSynchronizer only ever measures the offset of a
    unit's FIRST sentence — every sentence_start cue deeper in the unit could
    never arm and fell to the end-of-unit settle, where the next beat_enter
    wiped it moments later. Live logs showed exclusively "sentence 0 at
    +0.00s" arms; a probe over the 14 published cells put 182 of 463 authored
    sentence cues (39%) past sentence 0 — all of them settle-flashing.

    Making every cue-bearing sentence the FIRST sentence of its own say()
    reuses the one timing fact production reliably provides (real first-frame
    playout of each utterance) instead of the per-sentence offsets it does
    not. No estimate is introduced — this is the same mechanism that already
    armed sentence 0. The cost is one time-to-first-audio gap at exactly the
    sentences where the teacher draws, which is where a beat of board-silence
    is natural.

    original_indices keep the authored sentence numbering across runs — the
    same contract barge-in resume already relies on — so cue ids keep meaning.
    Sentence splitting must mirror _SENT_RE exactly; the factory authored the
    cue coordinates against this segmentation and the validator pins them.
    """
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t:
        return []
    sents = [s.strip() for s in _SENT_RE.findall(t) if s.strip()]
    if not sents:
        return [(t, [0])]
    starts = sorted(i for i in set(cue_sentences) if 0 < i < len(sents))
    if not starts:
        # No mid-unit cues: keep the exact current single-utterance behavior.
        return [(t, list(range(len(sents))))]
    bounds = [0, *starts, len(sents)]
    runs: list[tuple[str, list[int]]] = []
    for a, z in zip(bounds, bounds[1:]):
        if a >= z:
            continue
        runs.append((" ".join(sents[a:z]), list(range(a, z))))
    return runs


def _sentences(text: str) -> list[str]:
    """ONE utterance per authored stretch. No sub-chunking.

    Owner, 2026-07-29: "it is like someone reading a note, it is not like a
    teacher explaining." Before this, a stretch was cut into <=2-sentence units
    and each unit was its own session.say().

    The mechanism is NOT prosody, and it is worth being exact about that because
    the obvious explanation is wrong. agent.py builds google.TTS with
    use_streaming=False, so capabilities.streaming is False, so LiveKit wraps it
    in tts.StreamAdapter with a blingfire SentenceTokenizer
    (agents/voice/agent.py:431). Whatever text we hand to say() is re-split into
    single sentences before synthesis regardless — one Chirp3 request, and one
    prosodic contour, PER SENTENCE either way. Merging cannot make intonation
    carry across a sentence boundary.

    What merging actually removes is GAPS. Inside one say(), StreamAdapter
    synthesises sentences back-to-back at roughly 6.5x realtime (measured on
    hi-IN-Chirp3-HD-Despina @0.82: synthesis costs ~0.155x the audio duration,
    linear, no fixed per-request overhead), so the emitter buffer runs ahead of
    playback and the audio is continuous. But _say awaits each handle to finish
    before starting the next, so BETWEEN say() calls the whole time-to-first-
    audio is exposed as silence. A beat of 8 sentences used to be 4 handles —
    3 audible stalls mid-explanation. That is the stutter, and that is what the
    owner has been hearing since the "breaks of 2-5 seconds" report.

    The cost model inverts once you know LiveKit re-splits: time-to-first-audio
    depends on the FIRST SENTENCE only, never on the length of the stretch, so a
    long stretch is not slower to start than a short one. There is no reason to
    cap length here, and the earlier 700-char cap was pure downside — it sat at
    the median stretch (published variants: median 677-802 chars, max 1312), so
    ~63% of comfortable beats fell into the fallback and kept stuttering.

    _MAX_UNIT is therefore only a pathological-input backstop, well under the
    5000-BYTE Google TTS request limit (measured: 4500 OK, 5200 rejected) which
    in any case applies per sentence downstream, not to this string.

    Authored [PAUSE] cues still split the beat in _units, so deliberate breaths
    stay under the author's control. Interruption is handled in _say, which
    resumes near the cut instead of replaying the stretch.
    """
    t = re.sub(r"\s+", " ", text).strip()
    if not t:
        return []
    if len(t) <= _MAX_UNIT:
        return [t]
    sents = [s.strip() for s in _SENT_RE.findall(t) if s.strip()]
    if not sents:
        return [t]
    units, cur = [], ""
    for sent in sents:
        if cur and len(cur) + len(sent) + 1 > _MAX_UNIT:
            units.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        units.append(cur)
    return units


class LectureDriver:
    """Owns lesson progress. The AgentSession's LLM never narrates; it only
    reacts (its reaction-only system prompt says so). All waits are bounded —
    there is no path that hangs a lesson forever.
    """

    def __init__(self, session, room, lecture: dict):
        self.session = session
        self.room = room
        self.lec = lecture
        self.check_wait = float(lecture.get("check_wait") or 10.0)
        self._student_spoke = asyncio.Event()   # a FINAL user transcript arrived
        self._agent_speaking = asyncio.Event()  # agent (LLM reply) is talking
        # LIVE-VISUAL-BOARD-01: in-flight visual-cue tasks. Tracked so a closing
        # session, or an interruption, cannot leave a timer alive that draws on
        # the board after the lesson has moved on. Empty for every lesson that
        # carries no visual_cues, which today is all of them.
        self._cues: set[asyncio.Task] = set()
        self._fired: set[str] = set()           # cue ids already sent to the board
        self._unit_cues: list[dict] = []        # cues the scheduler accepted for the current unit
        self._unit_beat_no: int = 0             # beat the open unit belongs to
        self._unit_scheduled: set[str] = set()  # cue ids that already have a timer
        # P3 — real TTS timing, fed by agent.py's transcription_node tee.
        self._sync = VisualCueSynchronizer()
        self._last_playback_position: float = 0.0
        self._last_playback_interrupted: bool = False
        # Resolved once per lesson; every cue path is gated on it.
        self._board_driven: bool = self._negotiate_board()
        # Attempt-scoped protocol session. None whenever the board is not driven,
        # which makes every cue path a no-op without extra checks.
        self._vb = None
        if self._board_driven and VisualBoardSession is not None:
            self._vb = VisualBoardSession(
                script_digest=str(self.lec.get("script_digest") or ""),
                topic_id=str(self.lec.get("topic_id") or ""),
                variant=str(self.lec.get("variant") or ""),
            )
        self._agent_idle = asyncio.Event()
        self._agent_idle.set()
        # Owner 2026-08-04 lesson controls. Flags, not Events: the run loop
        # polls them at unit boundaries, so a control can never tear a
        # sentence in half or race the synchronizer's open unit.
        self._paused: bool = False
        self._handraise_pending: bool = False
        self._jump_to: int | None = None  # 1-based beat to continue from
        self._wire()

    # -- session event plumbing (registered once; read-only observers) --------
    def _wire(self):
        @self.session.on("user_input_transcribed")
        def _on_user(ev):
            if getattr(ev, "is_final", True):
                self._student_spoke.set()

        @self.session.on("agent_state_changed")
        def _on_state(ev):
            st = str(getattr(ev, "new_state", ""))
            if st == "speaking":
                self._agent_speaking.set()
                self._agent_idle.clear()
            elif st == "listening":
                self._agent_speaking.clear()
                self._agent_idle.set()

    # -- board ---------------------------------------------------------------
    async def _board_show(self, beat_no: int):
        """Fire the exact tool.call RPC the LLM tool used to make — but from
        the driver, with no generation pause. Non-fatal by design: a board
        hiccup must never stop the voice."""
        try:
            participants = self.room.remote_participants
            if not participants:
                return
            participant = next(iter(participants.values()))
            await self.room.local_participant.perform_rpc(
                destination_identity=participant.identity,
                method="tool.call",
                payload=json.dumps({"name": "board_show", "arguments": {"beat_id": beat_no}}),
                response_timeout=10.0,
            )
        except Exception as e:
            logger.warning(f"[lecture] board_show({beat_no}) failed (non-fatal): {e}")

    # -- visual board (LIVE-VISUAL-BOARD-01) ---------------------------------
    # Everything below is additive and inert unless a beat carries visual_cues.
    # Beat-level board_show above stays unconditional and untouched.

    def _negotiate_board(self) -> bool:
        """Agree with the browser on whether the visual board can be driven.

        THREE parties must say yes and any one of them saying no means no cue is
        ever sent:
          - this agent's rollout flag (SX_VISUAL_BOARD)
          - the browser's advertised capability (lecture.client_caps.visual_board)
          - the content, which must actually carry cues

        The browser omits client_caps entirely when its own flag is off, so a
        flag-off browser and a flag-on agent still resolve to LEGACY. That is
        what makes the staged deploy in the plan verifiable rather than hopeful:
        ship both sides dark, read this line in the logs, then enable.

        Logged once per lesson at INFO with the deciding values, because
        "capability negotiation resolved correctly in production" is a thing we
        are required to VERIFY, not assume.
        """
        # client_caps is attacker-adjacent in the sense that it arrives inside a
        # prompt blob; a non-dict (or a non-numeric version) must fail CLOSED,
        # never raise. Raising here would kill the driver in its constructor and
        # take the whole lesson down with it.
        caps = self.lec.get("client_caps")
        if not isinstance(caps, dict):
            caps = {}
        try:
            client_version = int(caps.get("visual_board") or 0)
        except (TypeError, ValueError):
            client_version = 0
        # The SCRIPT's contract version, sent alongside the browser's. Audit
        # finding P1-6: this was never transmitted, so a version-2 script
        # negotiated as driven, stripped the legacy tools, and then could not be
        # rendered. An absent or mismatched version now fails closed.
        try:
            board_version = int(self.lec.get("board_version") or 0)
        except (TypeError, ValueError):
            board_version = 0

        has_cues = any((b.get("visual_cues") or []) for b in self.lec.get("beats") or [])
        ok = (
            _VB_ENABLED
            and client_version >= _VB_AGENT_VERSION
            and board_version == _VB_AGENT_VERSION
            and has_cues
        )
        logger.info(
            f"[lecture] visual-board negotiation: {'DRIVEN' if ok else 'LEGACY'} "
            f"(agent_flag={_VB_ENABLED}, agent_version={_VB_AGENT_VERSION}, "
            f"client_version={client_version}, board_version={board_version}, "
            f"script_has_cues={has_cues})"
        )
        return ok

    def _track(self, coro) -> None:
        """Run a cue coroutine as a tracked task so it can be cancelled."""
        task = asyncio.create_task(coro)
        self._cues.add(task)
        task.add_done_callback(self._cues.discard)

    def cancel_cues(self) -> None:
        """Drop every pending cue. Safe to call repeatedly and when empty."""
        for task in list(self._cues):
            task.cancel()
        self._cues.clear()

    def _vb_listen(self) -> None:
        """Handle browser frames (hello, resync) on the control topic.

        Guarded with getattr for the same reason as the send path: the installed
        rtc build decides whether text streams exist, and a missing API must
        leave the board undriven rather than crash the lecture.
        """
        register = getattr(self.room, "register_text_stream_handler", None)
        if not callable(register):
            return

        async def _on_frame(reader, participant_identity=None):  # noqa: ANN001
            try:
                raw = reader
                read_all = getattr(reader, "read_all", None)
                if callable(read_all):
                    raw = await read_all()
                reply = self._vb.on_client_frame(raw) if self._vb else None
                if reply is not None:
                    await self._vb_send(reply)
                    if reply.get("type") == "ack" and reply.get("accepted"):
                        logger.info(
                            f"[lecture] visual-board handshake accepted "
                            f"(attempt={reply.get('attempt_id')})"
                        )
            except Exception as e:
                logger.warning(f"[lecture] visual-board frame failed (non-fatal): {e}")

        try:
            register(VB_TOPIC, _on_frame)
        except Exception as e:
            logger.warning(f"[lecture] visual-board listen failed (non-fatal): {e}")

    def _dispatch_control(self, raw: str) -> None:
        """Parse one control frame and set the loop flags. Shared by every
        transport lane; never raises past the caller's guard."""
        msg = json.loads(raw)
        cmd = str(msg.get("cmd") or "")
        if cmd == "pause":
            self._paused = True
            logger.info("[lecture] control: pause")
        elif cmd == "resume":
            self._paused = False
            self._handraise_pending = False
            logger.info("[lecture] control: resume")
        elif cmd == "handraise":
            self._paused = True
            self._handraise_pending = True
            logger.info("[lecture] control: hand raised")
        elif cmd == "seek":
            n = int(msg.get("beat") or 0)
            if 1 <= n <= len(self.lec.get("beats") or []):
                self._jump_to = n
                self._paused = False
                logger.info(f"[lecture] control: seek -> beat {n}")
            else:
                logger.warning(f"[lecture] control: seek to invalid beat {n} ignored")
        else:
            logger.warning(f"[lecture] control: unknown cmd {cmd!r} ignored")

    def _control_listen(self) -> None:
        """Accept student lesson controls (pause/play, hand-raise, seek).

        Registered for EVERY driven lecture (with or without a visual board).
        PRIMARY lane is an RPC method — RPC interop is proven in this exact
        deployment (board_show has always crossed it, agent->browser); the
        browser->agent text-stream lane was never exercised in production and
        silently dropped frames when first tried (2026-08-04). The stream
        handler stays registered as a secondary lane. Missing rtc APIs leave
        the controls dead, never the lecture.
        """
        lp = getattr(self.room, "local_participant", None)
        register_rpc = getattr(lp, "register_rpc_method", None)
        if callable(register_rpc):
            async def _rpc_control(data):  # noqa: ANN001 - RpcInvocationData
                try:
                    self._dispatch_control(str(getattr(data, "payload", "") or ""))
                    return "ok"
                except Exception as e:
                    logger.warning(f"[lecture] control rpc failed (non-fatal): {e}")
                    return "error"

            try:
                register_rpc("lesson.control", _rpc_control)
                logger.info("[lecture] listening for controls on rpc lesson.control")
            except Exception as e:
                logger.warning(f"[lecture] control rpc listen failed (non-fatal): {e}")
        else:
            logger.warning("[lecture] rtc build has no rpc registration — trying text streams only")

        register = getattr(self.room, "register_text_stream_handler", None)
        if not callable(register):
            return

        async def _on_control(reader, participant_identity=None):  # noqa: ANN001
            try:
                raw = reader
                read_all = getattr(reader, "read_all", None)
                if callable(read_all):
                    raw = await read_all()
                self._dispatch_control(str(raw))
            except Exception as e:
                logger.warning(f"[lecture] control frame failed (non-fatal): {e}")

        try:
            register(LECTURE_CONTROL_TOPIC, _on_control)
            logger.info(f"[lecture] listening for controls on {LECTURE_CONTROL_TOPIC}")
        except Exception as e:
            logger.warning(f"[lecture] control listen failed (non-fatal): {e}")

    async def _control_point(self, beat_no: int) -> bool:
        """Unit-boundary gate for the lesson controls.

        Speaks the hand-raise invite once, then holds while paused (the
        reaction pipeline still answers anything the student says — that is
        the doubt conversation). Returns True when a seek was requested and
        the caller must abandon the current beat.
        """
        if self._handraise_pending:
            self._handraise_pending = False
            try:
                handle = self.session.say(
                    "Haan beta, poochho — kya doubt hai? Main sun rahi hoon.",
                    allow_interruptions=True,
                )
                await handle
            except Exception as e:
                logger.warning(f"[lecture] hand-raise invite failed (non-fatal): {e}")
        while self._paused and self._jump_to is None:
            await asyncio.sleep(0.25)
            if self._handraise_pending:
                # A second hand-raise while already paused re-invites.
                return await self._control_point(beat_no)
        return self._jump_to is not None

    async def _vb_send(self, frame: dict) -> None:
        """Put one control frame on the dedicated topic.

        Non-fatal by design, like board_show: the voice IS the lesson, and a
        board hiccup must never stop it. Guarded with getattr because the
        installed rtc build decides whether text streams exist — a missing API
        degrades to an undriven board, never to a crashed lecture.
        """
        try:
            reply = await self._vb_rpc("visual_board_event", {"frame": frame})
            if reply is None:
                return
            # The browser asks for a resync when it sees a forward gap. Honour
            # it by replaying from that sequence; without this the buffered run
            # never drains and the board silently stalls one cue short.
            #
            # Until now this only LOGGED. build_snapshot was reachable only from
            # on_client_frame, which is wired to the text-stream lane the browser
            # can never use (it has no Room — the premise of the RPC lane), so a
            # single dropped cue left an unfillable hole: the browser buffered
            # every later cue behind it and the board stopped drawing for the
            # rest of the lesson. The snapshot is the authoritative cue-id list
            # for this attempt, so it closes any gap in one frame.
            resync = reply.get("resync")
            if resync:
                await self._vb_answer_resync(resync)
            for reason in reply.get("dropped") or []:
                logger.info(f"[lecture] visual-board dropped a frame: {reason}")
        except Exception as e:
            logger.warning(f"[lecture] visual-board send failed (non-fatal): {e}")

    async def _vb_answer_resync(self, resync: dict) -> None:
        """Answer a browser resync with the authoritative snapshot.

        This path used to be DEAD. `build_snapshot` was reachable only from
        `on_client_frame`, which is wired to the text-stream handler — the lane
        the browser can never use, because it has no Room. So a single dropped
        cue RPC left a forward gap the browser could never close: it buffered to
        VB_MAX_BUFFERED_EVENTS and then dropped everything, and the board stopped
        drawing for the rest of the lesson while every log stayed green.

        Deliberately NOT recursive: a snapshot is the authoritative state, so if
        answering one somehow produces another resync request there is nothing
        further to replay and retrying would only spin.
        """
        from_seq = resync.get("from_seq")
        logger.info(f"[lecture] visual-board resync requested from seq {from_seq}")
        if self._vb is None:
            return
        snapshot = self._vb.build_snapshot(self._vb.attempt_id)
        if not snapshot:
            logger.warning("[lecture] visual-board: no snapshot to answer the resync")
            return
        reply = await self._vb_rpc("visual_board_event", {"frame": snapshot})
        applied = (reply or {}).get("applied")
        logger.info(
            f"[lecture] visual-board snapshot delivered at seq {snapshot.get('seq')} "
            f"({applied} objects applied)"
        )

    async def _vb_rpc(self, name: str, arguments: dict) -> dict | None:
        """One tool.call RPC to the browser; returns its parsed RESPONSE.

        The response is the board's return path. @coreexl/mentor's RPC entry
        point invokes the page's handler with a single argument, so the
        documented `ToolCallContext.room` is always undefined and the browser
        cannot open a lane of its own. LiveKit does hand the handler's return
        value back to us, which is all this protocol needs: the browser answers
        the init with its hello and every event with an ack.
        """
        participants = self.room.remote_participants
        if not participants:
            logger.warning("[lecture] visual-board: no remote participant to address")
            return None
        participant = next(iter(participants.values()))
        raw = await self.room.local_participant.perform_rpc(
            destination_identity=participant.identity,
            method="tool.call",
            payload=json.dumps({"name": name, "arguments": arguments}),
            response_timeout=10.0,
        )
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            logger.warning(f"[lecture] visual-board: unparseable {name} response")
            return None

    async def _vb_bootstrap(self) -> None:
        """Ask the browser to introduce itself, and complete the handshake.

        Logs the OUTCOME either way. The first version logged only on failure,
        so a silent no-op — which is exactly what happened when the room was
        unreachable — was indistinguishable from success, and the board sat
        empty with nothing anywhere saying why.
        """
        try:
            # The session id is what lets the browser tell a NEW lecture from a
            # re-arm of the same one. `attempt_id` cannot: it is derived from
            # content (`<digest>#<variant>`), so two sessions on the same lesson
            # share it, the lane keeps its old client state, and the agent — which
            # restarts at seq 0 — has every cue rejected as `stale_seq`. The room
            # name is unique per lecture run, which is exactly the boundary.
            session_id = str(getattr(self.room, "name", "") or "")
            reply = await self._vb_rpc("visual_board_init", {"session_id": session_id})
            hello = (reply or {}).get("hello")
            if not hello:
                logger.warning(
                    "[lecture] visual-board: browser returned no hello "
                    f"({(reply or {}).get('reason') or reply}) — board stays undriven"
                )
                self._vb = None
                return
            ack = self._vb.on_hello(json.dumps(hello)) if self._vb else None
            if not (ack and ack.get("accepted")):
                logger.warning(
                    f"[lecture] visual-board: hello REFUSED ({(ack or {}).get('reason')})"
                )
                self._vb = None
                return
            # The handshake is TWO-SIDED. Accepting it here only moves the AGENT
            # out of its pre-handshake state; the browser holds its own state
            # machine and applies nothing until it has actually SEEN the ack.
            # Without this delivery the agent logged "ACCEPTED" and then every
            # cue it sent came back `handshake_incomplete` — an accepted board
            # that draws nothing, which is the worst of both outcomes.
            delivered = await self._vb_rpc("visual_board_event", {"frame": ack})
            if not delivered or delivered.get("status") != "ok":
                logger.warning(
                    "[lecture] visual-board: ack did not reach the browser "
                    f"({delivered}) — board stays undriven"
                )
                self._vb = None
                return
            logger.info(
                "[lecture] visual-board handshake ACCEPTED "
                f"(attempt={hello.get('attempt_id')}, digest={str(hello.get('script_digest'))[:19]})"
            )
        except Exception as e:
            logger.warning(f"[lecture] visual-board bootstrap failed (non-fatal): {e}")
            self._vb = None

    async def _visual_cue(self, beat_no: int, cue: dict) -> None:
        """Emit ONE cue as a protocol event.

        The wire carries a cue_id, never the cue body: the browser resolves the
        id inside the script it was already served, so nothing on the room can
        introduce a drawing instruction the published script does not contain.
        """
        cue_id = str(cue.get("id") or "")
        if cue_id and cue_id in self._fired:
            return                              # settle pass must not double-send
        if cue_id:
            # Claimed BEFORE the await so a concurrent settle cannot double-send.
            # Released again on failure below, so a claim can never swallow a cue.
            self._fired.add(cue_id)
        try:
            if self._vb is None:
                return
            trig = cue.get("trigger") or {}
            event = self._vb.build_cue_event(
                cue_id=cue_id,
                beat_no=beat_no,
                unit_index=int(trig.get("speech_unit") or 0),
                sentence_index=int(trig.get("sentence") or 0),
                scheduled_at_ms=float(cue.get("_scheduled_at_ms") or 0.0),
                sent_at_ms=time.monotonic() * 1000.0,
            )
            if event is None:
                return
            await self._vb_send(event)
        except asyncio.CancelledError:
            # Cancelled before delivery — release the claim so the end-of-unit
            # settle can still send it.
            self._fired.discard(cue_id)
            raise
        except Exception as e:
            self._fired.discard(cue_id)
            logger.warning(f"[lecture] visual cue {cue_id} failed (non-fatal): {e}")

    def _cues_for(self, beat: dict, trigger: str) -> list[dict]:
        # Single chokepoint: negotiation failing means every trigger sees zero
        # cues, so no later code path has to remember to check the flag.
        if not self._board_driven:
            return []
        out = []
        for cue in (beat.get("visual_cues") or []):
            if isinstance(cue, dict) and (cue.get("trigger") or {}).get("type") == trigger:
                out.append(cue)
        return out

    def _fire_cues(self, beat: dict, trigger: str) -> None:
        """Fire every cue on an EVENT trigger (beat_enter / after_response /
        on_silent). These need no timing model at all: the driver already knows
        the exact moment each event happens."""
        beat_no = int(beat.get("n") or 0)
        for cue in self._cues_for(beat, trigger):
            logger.info(f"[lecture] visual_cue {trigger}: beat {beat_no} cue {cue.get('id')}")
            self._track(self._visual_cue(beat_no, cue))

    async def _cue_after(self, delay: float, beat_no: int, cue: dict) -> None:
        await asyncio.sleep(delay)
        await self._visual_cue(beat_no, cue)

    def on_playback_started(self) -> None:
        """First audio frame of the current unit actually reached the student."""
        try:
            self._sync.on_playback_started(time.monotonic())
            # The playout origin is half of what delay_for needs; any cue whose
            # sentence offset already landed becomes schedulable right here.
            self._try_schedule_unit_cues()
        except Exception:
            pass

    def on_playback_finished(self, playback_position: float, interrupted: bool) -> None:
        """Real played duration, from PlaybackFinishedEvent.

        Stored rather than acted on: _say owns the resume decision, and this can
        arrive slightly before the say() handle resolves.
        """
        try:
            self._last_playback_position = float(playback_position or 0.0)
            self._last_playback_interrupted = bool(interrupted)
        except Exception:
            pass

    def on_timed_string(self, text: str, start_time) -> None:
        """Tee target for agent.py's transcription_node. Never raises."""
        try:
            self._sync.on_timed_string(text, start_time)
            # This chunk may be the first to land inside a cue's sentence, which
            # is the other half of what delay_for needs.
            self._try_schedule_unit_cues()
        except Exception:
            pass

    def _unit_cue_sentences(self, beat: dict, unit_index: int) -> set[int]:
        """Authored sentence indices carrying a sentence_start cue in this unit.

        Feeds _cue_runs so every one of these sentences opens its own say()
        run and can arm from that run's real playout event."""
        out: set[int] = set()
        for cue in self._cues_for(beat, "sentence_start"):
            trig = cue.get("trigger") or {}
            if int(trig.get("speech_unit") or 0) != unit_index:
                continue
            out.add(int(trig.get("sentence") or 0))
        return out

    def _schedule_sentence_cues(self, beat: dict, unit_index: int, text: str) -> None:
        """Schedule this unit's sentence_start cues against MEASURED playout.

        The 11-characters-per-second scheduler is gone, and deliberately has no
        replacement estimate: a sentence with no measured offset is NOT
        scheduled early. It is emitted at the unit boundary by
        _settle_unit_cues, so the board can lag but can never run ahead of the
        voice on a guess.

        Offsets come from the TTS-aligned transcript and are measured from real
        first-frame playout, not from the moment say() was called — synthesis
        runs far ahead of playback.

        THIS PASS ONLY ACCEPTS CUES; it does not schedule them. It runs before
        `await say()`, and at that instant the unit has just been opened, so
        `playout_origin` is None and no aligned chunk has landed — `delay_for`
        can only answer None for every cue, by construction. Reading the timing
        once, here, therefore scheduled NOTHING: every cue fell through to the
        end-of-unit settle, so a beat's whole reveal appeared in one burst tens
        of seconds late, and beat 1 left the board blank for the entire opening.
        Scheduling is now driven by `_try_schedule_unit_cues`, which the timing
        callbacks invoke as measurements actually arrive.
        """
        self._unit_cues = []
        self._unit_scheduled = set()
        cues = self._cues_for(beat, "sentence_start")
        if not cues:
            return
        self._unit_beat_no = int(beat.get("n") or 0)
        sentences = [s.strip() for s in _SENT_RE.findall(text) if s.strip()]
        if not sentences:
            return

        for cue in cues:
            trig = cue.get("trigger") or {}
            if int(trig.get("speech_unit") or 0) != unit_index:
                continue
            idx = int(trig.get("sentence") or 0)
            if idx < 0 or idx >= len(sentences):
                logger.warning(
                    f"[lecture] visual_cue {cue.get('id')}: sentence {idx} is outside "
                    f"unit {unit_index} ({len(sentences)} sentences) — skipped")
                continue
            self._unit_cues.append(cue)

        # Timing may already be present when a unit is re-opened mid-stream
        # (barge-in resume), so try once here as well as on every measurement.
        self._try_schedule_unit_cues()

    def _try_schedule_unit_cues(self) -> None:
        """Schedule any accepted cue whose playout offset is now MEASURED.

        Called from `on_playback_started` and `on_timed_string` — the only two
        moments new timing exists. `delay_for` needs BOTH the playout origin and
        that sentence's offset, so whichever arrives second is what makes a cue
        schedulable; running on both events covers either order.

        Idempotent: a cue is armed at most once per unit (`_unit_scheduled`), and
        `_visual_cue` additionally dedupes on cue id, so a cue can never be sent
        twice even if a timer and the settle pass race.
        """
        if not self._unit_cues:
            return
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return          # no loop (unit tests drive the sync directly)
        now = time.monotonic()
        for cue in self._unit_cues:
            cue_id = str(cue.get("id") or "")
            if cue_id in self._unit_scheduled or cue_id in self._fired:
                continue
            trig = cue.get("trigger") or {}
            idx = int(trig.get("sentence") or 0)
            delay = self._sync.delay_for(idx, now)
            if delay is None:
                continue
            self._unit_scheduled.add(cue_id)
            cue["_scheduled_at_ms"] = (now + delay) * 1000.0
            logger.info(
                f"[lecture] visual_cue scheduled: beat {self._unit_beat_no} cue {cue_id} "
                f"at +{delay:.2f}s (MEASURED; sentence {idx})")
            self._track(self._cue_after(delay, self._unit_beat_no, cue))

    async def _settle_unit_cues(self, beat: dict, unit_index: int) -> None:
        """After a unit has actually finished being spoken, send any of its
        sentence cues that never fired.

        A barge-in cancels pending cues (their timeline is no longer valid — the
        voice stopped, and _say resumes near the cut rather than where the timer
        thinks it is). Without this, a student asking a question mid-beat would
        leave the board permanently missing whatever the rest of that unit was
        supposed to draw. Firing the remainder at the unit boundary means the
        board's END state per unit is correct no matter how the speech went;
        only the intra-unit reveal timing degrades, which is the right thing to
        lose. _visual_cue dedupes on cue id, so already-sent cues are not
        re-sent.

        Units are spoken strictly in sequence, so any timer still pending here
        belongs to the unit that just ended and is now late — drop them all
        first, then send whatever they never delivered. This is AWAITED rather
        than fire-and-forget: the whole point is that the board is correct
        before the next unit starts, and a task left in flight would not
        guarantee that."""
        beat_no = int(beat.get("n") or 0)
        self.cancel_cues()
        for cue in self._unit_cues:
            if str(cue.get("id") or "") in self._fired:
                continue
            logger.info(f"[lecture] visual_cue settle: beat {beat_no} cue {cue.get('id')}")
            await self._visual_cue(beat_no, cue)
        self._unit_cues = []
        self._unit_scheduled = set()

    # -- speech --------------------------------------------------------------
    async def _say(self, text: str) -> None:
        """Speak one unit; on interruption, let the LLM reaction cycle finish,
        then resume this unit NEAR THE CUT so the thread is never lost.

        A unit is now a whole authored stretch (see _sentences), which can be a
        minute of audio. Re-saying it from the top after every barge-in would
        make a student's question cost them the entire passage again, so resume
        from the last sentence boundary before wherever the voice had reached.

        The position comes from the REAL played duration
        (PlaybackFinishedEvent.playback_position) mapped onto the sentence
        offsets measured from the TTS-aligned transcript. A real teacher picks
        up by repeating the line they were cut off in, so the resume lands on
        the sentence that was in progress: erring toward repetition costs
        seconds, erring the other way silently drops teaching the student never
        hears. With nothing measured the unit restarts rather than resuming at a
        guessed offset.
        """
        text = text.strip()
        if not text:
            return
        attempts = 0
        while attempts < 3:
            attempts += 1
            self._student_spoke.clear()
            # The spoken transcript IS the log: with deterministic delivery the
            # register, pacing and content of a lesson are auditable from here
            # without listening to the audio (owner ask, 2026-07-28). The old
            # [:160] slice captured a whole 2-sentence unit; against a full
            # stretch (up to ~1300 chars) it would have logged ~12% of what the
            # child was told and quietly voided that property. This is an INFO
            # line a few dozen times per lesson, not a hot path — log it whole.
            logger.info(f"[lecture] say: {text}")
            t0 = time.monotonic()
            handle = self.session.say(text, allow_interruptions=True)
            await handle
            if not handle.interrupted:
                return
            # The voice stopped, so every pending cue's timeline is now wrong.
            # Drop them; _settle_unit_cues sends whatever never fired once the
            # unit finally completes, so the board still ends up correct.
            self.cancel_cues()
            # P3 — resume from the REAL played duration mapped onto measured
            # sentence offsets. The character-rate estimate is gone here too.
            # When nothing was measured we restart the unit rather than invent a
            # cut point: repeating a line costs seconds, skipping one costs
            # teaching.
            resume_idx = self._sync.resume_from(self._last_playback_position)
            if resume_idx is None:
                spoken = 0
            else:
                tail, _idx = self._sync.remaining_text(resume_idx)
                spoken = max(0, len(text) - len(tail)) if tail else 0
            if spoken >= len(text):
                logger.info("[lecture] interrupted at the very end of the unit — moving on")
                await self._reaction_cycle()
                return
            if spoken:
                logger.info(
                    f"[lecture] interrupted ~{spoken}/{len(text)} chars in — "
                    f"reaction, then resuming from the previous sentence"
                )
                text = text[spoken:].strip()
            else:
                logger.info("[lecture] interrupted mid-unit — letting the reaction play out")
            await self._reaction_cycle()
        # Give-up path. Dropping the unit here used to cost at most two
        # sentences; against a whole stretch it would silently discard up to
        # ~100 words of teaching WHILE THAT BEAT'S BOARD STAYS PAINTED — the
        # board is revealed at beat start (run(): _board_show fires before any
        # narration) and reveal is monotonic, so the student would be left
        # looking at a diagram nobody ever explained, with the only trace a
        # warning in a container log. Speak the remainder uninterruptibly
        # instead: three interruptions in one stretch is a mic/echo problem,
        # not a child asking three questions, and finishing the sentence is
        # strictly better than a silent hole in the lesson.
        logger.warning(
            f"[lecture] unit interrupted 3x — delivering the remaining "
            f"{len(text)} chars uninterruptibly rather than dropping them"
        )
        try:
            await self.session.say(text, allow_interruptions=False)
        except Exception as exc:  # never let delivery of one unit kill the lesson
            logger.error(f"[lecture] final uninterruptible say failed: {exc}")

    async def _reaction_cycle(self):
        """After an interruption or a check answer, the normal STT->LLM->TTS
        pipeline produces the reaction. Wait for it, bounded:
          - up to 6s for the reply to BEGIN (covers a VAD blip that never
            finalises into a transcript — the false-interrupt case);
          - up to 60s for it to finish playing.
        """
        try:
            await asyncio.wait_for(self._agent_speaking.wait(), timeout=6.0)
        except asyncio.TimeoutError:
            return  # nothing came of it (cough / noise) — resume the lecture
        try:
            await asyncio.wait_for(self._agent_idle.wait(), timeout=60.0)
        except asyncio.TimeoutError:
            logger.warning("[lecture] reaction ran >60s — resuming the lecture anyway")
        await asyncio.sleep(0.4)  # let the room settle before narration resumes

    def _overview_opening(self, greeted: bool = False) -> str:
        """Deterministic topic overview spoken before beat 1.

        Built from the script's own chunk titles — never the LLM — so the
        overview can only promise what the authored lesson actually covers.
        The browser paints the same agenda on the board until the first cue.
        When an authored opening already greeted the student, the overview
        skips its own greeting instead of saying namaste twice.
        """
        chunks = [
            str(c.get("title") or "").strip()
            for c in (self.lec.get("chunks") or [])
            if str(c.get("title") or "").strip()
        ]
        if not chunks:
            return ""
        title = re.sub(r"^(Full|Express)\s*:\s*", "", str(self.lec.get("title") or "").strip())
        ordinals = ["Pehla", "Doosra", "Teesra", "Chautha", "Paanchvaan", "Chhatha", "Saatvaan"]
        greeting = "" if greeted else "Namaste! "
        parts = [
            f'{greeting}Aaj hum "{title}" seekhenge.' if title
            else f"{greeting}Chalo aaj ka topic shuru karte hain.",
            f"Aaj ki class ke {len(chunks)} hisse hain.",
        ]
        for i, t in enumerate(chunks[:7]):
            label = ordinals[i] if i < len(ordinals) else f"Hissa {i + 1}"
            parts.append(f"{label} — {t}.")
        parts.append("Poora plan board par likha hai. Ready? Chalo shuru karte hain!")
        return " ".join(parts)

    # -- the lesson ----------------------------------------------------------
    async def run(self):
        beats = self.lec["beats"]
        t0 = time.monotonic()
        logger.info(f"[lecture] driver starting: {len(beats)} beats, check_wait={self.check_wait}s")

        # The board target must exist before beat 1 reveals.
        for _ in range(100):
            if self.room.remote_participants:
                break
            await asyncio.sleep(0.1)
        await asyncio.sleep(0.6)  # audio path settle

        # Lesson controls listen for every driven lecture, board or not, and
        # from the very first spoken line (the overview is pausable too).
        self._control_listen()

        # Visual board: hand the browser a Room, then listen for its hello on the
        # dedicated topic. Both are no-ops when the board is not driven.
        if self._vb is not None:
            # The browser answers on the RPC RESPONSE, so there is no inbound
            # stream to listen on. _vb_listen stays for the day a Room becomes
            # reachable and the richer text-stream transport can attach.
            self._vb_listen()
            await self._vb_bootstrap()

        opening = str(self.lec.get("opening") or "").strip()
        overview = self._overview_opening(greeted=bool(opening))
        for line in (opening, overview):
            if line:
                await self._say(line)
        if opening or overview:
            # Owner 2026-08-04: "a teacher doesn't just enter the class and
            # start speaking the first point." Give the student a breath with
            # the plan on the board (the browser shows the agenda until the
            # first cue fires) before beat 1 wipes it.
            await asyncio.sleep(2.0)

        # Indexed loop, not `for b in beats`: a seek control (owner 2026-08-04)
        # moves the index forward to skip or backward to re-explain.
        i = 0
        while i < len(beats):
            b = beats[i]
            n = int(b.get("n") or 0)
            logger.info(f"[lecture] beat {n}/{len(beats)} — board reveal + narration")
            asyncio.create_task(self._board_show(n))
            self._fire_cues(b, "beat_enter")
            unit_index = 0
            jumped = False
            for u in _units(b.get("say") or ""):
                if await self._control_point(n):
                    jumped = True
                    break
                if "pause" in u:
                    await asyncio.sleep(u["pause"])
                else:
                    # Accept the unit's cues ONCE (validated against the full
                    # unit text), then speak the unit as runs that begin at
                    # each cue-bearing sentence — see _cue_runs. Each run's
                    # PlaybackStartedEvent + first aligned chunk arm that
                    # run's leading cue at +0.00s; anything that still never
                    # fired settles once at the unit boundary, exactly as
                    # before.
                    self._schedule_sentence_cues(b, unit_index, u["say"])
                    for run_text, run_indices in _cue_runs(
                        u["say"], self._unit_cue_sentences(b, unit_index),
                    ):
                        # The unit must be OPEN before say(), so aligned
                        # chunks have somewhere to land.
                        self._sync.open_unit(run_text, original_indices=run_indices)
                        await self._say(run_text)
                        self._sync.close_unit()
                    await self._settle_unit_cues(b, unit_index)
                    unit_index += 1

            if not jumped:
                if await self._control_point(n):
                    jumped = True
                else:
                    ask = str(b.get("ask") or "").strip()
                    if ask:
                        await self._check(b, ask)

            if self._jump_to is not None:
                target = self._jump_to
                self._jump_to = None
                # Abandon everything in flight for the old position; a
                # revisited beat must be allowed to re-fire its cues (the
                # browser resets its board on seek, so nothing double-draws).
                self.cancel_cues()
                self._fired.clear()
                self._unit_cues = []
                self._unit_scheduled = set()
                logger.info(f"[lecture] seek: continuing from beat {target}")
                i = target - 1
                continue
            i += 1

        dt = time.monotonic() - t0
        logger.info(f"[lecture] complete: {len(beats)} beats in {dt/60:.1f} min — LLM stays for questions")

    async def _check(self, beat: dict, ask: str):
        """Rule 8, made real: ask, give genuine thinking time, and only then —
        if the student answered — let the LLM react; if not, deliver the
        AUTHORED on_silent line (never an improvised nudge)."""
        listen = beat.get("listen") or {}
        # The ask is spoken directly (not via _say): if the student barges in
        # over the question itself, that is a kid blurting the ANSWER — the
        # worst response would be _say's re-say loop repeating the question at
        # them. Treat an interruption-with-transcript as the answer.
        self._student_spoke.clear()
        logger.info(f"[lecture] ask: {_spoken(ask)[:160]}")
        handle = self.session.say(_spoken(ask), allow_interruptions=True)
        await handle
        answered = False
        if handle.interrupted:
            try:
                await asyncio.wait_for(self._student_spoke.wait(), timeout=3.0)
                answered = True
            except asyncio.TimeoutError:
                pass  # VAD blip over the question — fall through to the wait
        if not answered:
            try:
                await asyncio.wait_for(self._student_spoke.wait(), timeout=self.check_wait)
                answered = True
            except asyncio.TimeoutError:
                answered = False

        if answered:
            # The student has committed to an answer, so anything the scene was
            # withholding may now be revealed. This is the pedagogical invariant
            # the board contract exists to enforce: nothing answer-bearing
            # reaches the board before this line runs.
            self._fire_cues(beat, "after_response")
            # The pipeline auto-reacts (reaction-only prompt + chat history —
            # say() writes what she spoke into chat_ctx, so the LLM knows the
            # question and the lesson so far). We just wait for it to finish.
            await self._reaction_cycle()
        else:
            self._fire_cues(beat, "on_silent")
            on_silent = _spoken(listen.get("on_silent"))
            if on_silent:
                await self._say(on_silent)

        then = _spoken(listen.get("then"))
        if then:
            await self._say(then)


async def run_lecture(session, room, lecture: dict, agent=None, on_driver=None):
    """Entry point — spawned as a task after session.start(). Never raises:
    a driver failure degrades to the LLM sitting idle with its reaction prompt,
    not a crashed agent job."""
    driver = LectureDriver(session, room, lecture)
    # P3 — the aligned transcript reaches the driver through the agent's
    # transcription_node tee. With no agent there are simply no measured
    # offsets, and unmeasured cues emit at the unit boundary rather than early.
    if agent is not None:
        try:
            agent.timed_string_sink = driver.on_timed_string
        except Exception as e:
            logger.warning(f"[lecture] could not attach timing sink (non-fatal): {e}")
    # Let the caller subscribe real playout events onto this driver.
    if on_driver is not None:
        try:
            on_driver(driver)
        except Exception as e:
            logger.warning(f"[lecture] playback wiring failed (non-fatal): {e}")
    try:
        await driver.run()
    except asyncio.CancelledError:
        logger.info("[lecture] driver cancelled (session closing)")
    except RuntimeError as e:
        # AgentSession isn't running — participant left mid-lesson.
        logger.info(f"[lecture] driver stopped: {e}")
    except Exception as e:
        logger.exception(f"[lecture] driver failed: {e}")
    finally:
        # However the lesson ended, no timer may outlive it and draw on a board
        # the student has moved away from. No-op when nothing was scheduled.
        driver.cancel_cues()
