"""LIVE-VISUAL-BOARD-01 / brief P3 — real TTS timing for visual cues.

WHAT THIS REPLACES. Cues were scheduled from a fixed 11-characters-per-second
estimate. That number was chosen for a different job — finding a safe resume
point after a barge-in, where erring slow is harmless — and it is not a
measurement of anything. Driving a teaching board from it means the drawing and
the words agree only by luck.

WHAT IT USES INSTEAD, verified against the deployed runtime (livekit-agents
1.3.12) rather than taken from documentation:

  livekit.agents.types.TimedString      subclasses str; instance attributes
                                        `start_time` / `end_time` in seconds,
                                        relative to the start of the utterance
  livekit.agents.voice.io.PlaybackStartedEvent / PlaybackFinishedEvent
                                        first-frame moment, and
                                        `playback_position` + `interrupted`
  AgentSession(use_tts_aligned_transcript=True)

Note the import paths: TimedString is NOT under `livekit.agents.tts`, and the
playback events are NOT in `livekit.agents.voice.events`. Both were checked by
importing them in the running container.

HOW A TIMED STRING IS ATTRIBUTED TO A SENTENCE, without relying on unique prose
or a global "latest speech" variable: the driver awaits every `session.say()` to
completion before starting the next, so AT MOST ONE utterance is open at a time.
That is an invariant of this driver, not a guess about the pipeline. The
synchronizer therefore attributes incoming chunks to the one open unit and walks
a character cursor across the authored sentences, recording each sentence's
start_time the first time the cursor enters it.

Scheduling is relative to REAL FIRST-FRAME PLAYOUT (PlaybackStartedEvent), not
to the moment `say()` was called: synthesis runs far ahead of playback, so the
two differ by a variable lead that would put the board ahead of the voice.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Sentence splitting must match the driver's own, including Devanagari danda.
_SENT_RE = re.compile(r"[^।॥.!?]+[।॥.!?]*\s*")


def split_sentences(text: str) -> list[str]:
    """Authored sentences of one speech unit, in order."""
    out = [s.strip() for s in _SENT_RE.findall(str(text or "")) if s.strip()]
    return out or ([str(text).strip()] if str(text).strip() else [])


@dataclass
class SpeechUnit:
    """One `session.say()` and everything timing-related about it."""

    unit_id: int
    sentences: list[str]
    #: Authored sentence index for each entry in `sentences`. After a resume the
    #: unit holds only the tail, but the cue ids reference ORIGINAL indices, so
    #: the mapping must survive re-synthesis.
    original_indices: list[int]
    #: original sentence index -> start_time (seconds into this utterance)
    offsets: dict[int, float] = field(default_factory=dict)
    #: monotonic seconds when the first audio frame actually played
    playout_origin: float | None = None
    #: characters of authored text already covered by arrived TimedStrings
    _consumed: int = 0
    #: cumulative character offset at which each local sentence starts
    _starts: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        run = 0
        for s in self.sentences:
            self._starts.append(run)
            run += len(s) + 1

    def local_index_at(self, char_pos: int) -> int:
        """Which local sentence a character offset falls in."""
        idx = 0
        for i, start in enumerate(self._starts):
            if char_pos >= start:
                idx = i
            else:
                break
        return idx


class VisualCueSynchronizer:
    """Owns the timing facts for the currently-spoken unit.

    Deliberately free of asyncio and LiveKit: the driver feeds it events and asks
    it for delays, which is what makes every interruption case testable.
    """

    def __init__(self) -> None:
        self._unit: SpeechUnit | None = None
        self._next_id = 0
        #: Cue ids already committed for this utterance, so a resume cannot
        #: re-fire something the student already saw.
        self.committed: set[str] = set()

    # -- lifecycle ---------------------------------------------------------
    def open_unit(self, text: str, original_indices: list[int] | None = None) -> SpeechUnit:
        sentences = split_sentences(text)
        indices = original_indices if original_indices is not None else list(range(len(sentences)))
        self._next_id += 1
        self._unit = SpeechUnit(
            unit_id=self._next_id,
            sentences=sentences,
            original_indices=indices[: len(sentences)] or list(range(len(sentences))),
        )
        return self._unit

    def close_unit(self) -> None:
        self._unit = None

    @property
    def unit(self) -> SpeechUnit | None:
        return self._unit

    # -- inbound timing ----------------------------------------------------
    def on_timed_string(self, text: str, start_time: float | None) -> None:
        """Tee one aligned-transcript chunk. Never consumes it."""
        u = self._unit
        if u is None or start_time is None:
            return
        local = u.local_index_at(u._consumed)
        original = u.original_indices[local] if local < len(u.original_indices) else local
        # First chunk that lands inside a sentence defines that sentence's start.
        u.offsets.setdefault(original, float(start_time))
        u._consumed += len(str(text))

    def on_playback_started(self, monotonic_now: float) -> None:
        if self._unit is not None and self._unit.playout_origin is None:
            self._unit.playout_origin = float(monotonic_now)

    # -- scheduling --------------------------------------------------------
    def delay_for(self, original_sentence_index: int, monotonic_now: float) -> float | None:
        """Seconds from now until that sentence is HEARD, or None if unknown.

        None means "no measured offset yet" — the caller must not invent one.
        Deleting the character-rate estimate means an unmeasured cue simply does
        not fire early; it is emitted at the unit boundary instead.
        """
        u = self._unit
        if u is None or u.playout_origin is None:
            return None
        offset = u.offsets.get(original_sentence_index)
        if offset is None:
            return None
        target = u.playout_origin + offset
        return max(0.0, target - float(monotonic_now))

    def measured_indices(self) -> set[int]:
        return set(self._unit.offsets) if self._unit else set()

    # -- interruption ------------------------------------------------------
    def resume_from(self, playback_position: float) -> int | None:
        """Original sentence index to resume at after an interruption.

        Maps the REAL played duration onto the measured sentence offsets and
        returns the sentence that was in progress — repeating it rather than
        skipping it, because a repeated line costs seconds and a skipped line
        costs teaching.

        None means nothing measured, so the caller should restart the unit.
        """
        u = self._unit
        if u is None or not u.offsets:
            return None
        pos = max(0.0, float(playback_position))
        current: int | None = None
        for original in sorted(u.offsets):
            if u.offsets[original] <= pos:
                current = original
            else:
                break
        return current if current is not None else min(u.offsets)

    def remaining_text(self, from_original_index: int) -> tuple[str, list[int]]:
        """Authored tail to re-synthesize, with its ORIGINAL indices preserved.

        Cue ids reference authored sentence numbers, so a resumed segment must
        keep them; renumbering from zero would fire the wrong cues.
        """
        u = self._unit
        if u is None:
            return "", []
        keep: list[str] = []
        idx: list[int] = []
        for local, original in enumerate(u.original_indices):
            if original >= from_original_index and local < len(u.sentences):
                keep.append(u.sentences[local])
                idx.append(original)
        return " ".join(keep), idx

    def commit(self, cue_id: str) -> bool:
        """Mark a cue as fired. False when it was already committed."""
        if cue_id in self.committed:
            return False
        self.committed.add(cue_id)
        return True
