"""BRIEF P3 — real-TTS-timing synchronizer, including every interruption case.

Run with plain `python test_visual_cue_sync.py`.
"""

import sys

from visual_cue_sync import VisualCueSynchronizer, split_sentences

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


TEXT = "Pehla vaakya. Doosra vaakya. Teesra vaakya."


def feed(sync, offsets, chunk_len=None):
    """Deliver aligned chunks, one per sentence, at the given start times."""
    sentences = split_sentences(TEXT)
    for i, s in enumerate(sentences):
        sync.on_timed_string(s + " ", offsets[i] if i < len(offsets) else None)


print("\nP3 — sentence offsets come from TimedString, not characters")
s = VisualCueSynchronizer()
u = s.open_unit(TEXT)
t("the unit splits into the authored sentences", len(u.sentences) == 3, str(u.sentences))
feed(s, [0.0, 2.5, 5.25])
t("each sentence records its measured start", u.offsets == {0: 0.0, 1: 2.5, 2: 5.25}, str(u.offsets))

t("no delay is offered before first-frame playout", s.delay_for(1, 100.0) is None)
s.on_playback_started(100.0)
t("delay is measured from REAL first frame, not from say()",
  abs(s.delay_for(1, 100.0) - 2.5) < 1e-6, str(s.delay_for(1, 100.0)))
t("a sentence already reached has zero delay, never negative",
  s.delay_for(0, 103.0) == 0.0)
t("an UNMEASURED sentence yields None rather than an estimate",
  s.delay_for(9, 100.0) is None,
  "deleting the char-rate scheduler means no invented offsets")

print("\nP3 — playout origin is independent of synthesis time")
s2 = VisualCueSynchronizer()
s2.open_unit(TEXT)
feed(s2, [0.0, 2.0, 4.0])
# Synthesis ran far ahead: say() was called at 50, audio started at 100.
s2.on_playback_started(100.0)
t("the lead between say() and first frame does not leak into the schedule",
  abs(s2.delay_for(2, 100.0) - 4.0) < 1e-6)
s2.on_playback_started(200.0)
t("a second playback_started does not move the origin",
  abs(s2.delay_for(2, 100.0) - 4.0) < 1e-6)

print("\nP3 — interruption cases")

# 1. before the first sentence has been heard at all
s3 = VisualCueSynchronizer()
s3.open_unit(TEXT)
feed(s3, [0.0, 2.5, 5.25])
s3.on_playback_started(0.0)
t("interrupted before any audio resumes at the first sentence",
  s3.resume_from(0.0) == 0)

# 2. mid-sentence
t("interrupted mid-sentence repeats THAT sentence, not the next",
  s3.resume_from(3.4) == 1, str(s3.resume_from(3.4)))

# 3. exactly on a boundary
t("interrupted exactly on a boundary resumes at the sentence starting there",
  s3.resume_from(2.5) == 1)
t("a hair before the boundary stays on the previous sentence",
  s3.resume_from(2.49) == 0)

# 4. past the end
t("interrupted after the last start resumes at the last sentence",
  s3.resume_from(99.0) == 2)

# nothing measured at all
s4 = VisualCueSynchronizer()
s4.open_unit(TEXT)
t("with no measurements resume_from declines rather than guessing",
  s4.resume_from(3.0) is None)

print("\nP3 — resume preserves AUTHORED indices")
text, idx = s3.remaining_text(1)
t("the tail contains only the remaining sentences",
  text.startswith("Doosra") and "Pehla" not in text, text)
t("original indices survive re-synthesis", idx == [1, 2], str(idx))

resumed = VisualCueSynchronizer()
ru = resumed.open_unit(text, original_indices=idx)
t("the resumed unit maps local 0 to ORIGINAL sentence 1",
  ru.original_indices[0] == 1, str(ru.original_indices))
resumed.on_timed_string("Doosra vaakya. ", 0.0)
resumed.on_timed_string("Teesra vaakya. ", 1.8)
t("the resumed segment measures against its OWN origin, under original indices",
  ru.offsets == {1: 0.0, 2: 1.8}, str(ru.offsets))
resumed.on_playback_started(500.0)
t("a cue for authored sentence 2 schedules off the new segment",
  abs(resumed.delay_for(2, 500.0) - 1.8) < 1e-6)

print("\nP3 — a committed cue never fires twice")
s5 = VisualCueSynchronizer()
t("first commit succeeds", s5.commit("b03-c02") is True)
t("second commit of the same cue is refused", s5.commit("b03-c02") is False)
t("a different cue still commits", s5.commit("b03-c03") is True)

print("\nP3 — multiple interruptions in one unit")
s6 = VisualCueSynchronizer()
s6.open_unit(TEXT)
feed(s6, [0.0, 2.0, 4.0])
s6.on_playback_started(0.0)
first = s6.resume_from(2.4)          # cut during sentence 1
tail1, idx1 = s6.remaining_text(first)
s6b = VisualCueSynchronizer()
u2 = s6b.open_unit(tail1, original_indices=idx1)
s6b.on_timed_string(u2.sentences[0] + " ", 0.0)
s6b.on_timed_string(u2.sentences[1] + " ", 1.5)
s6b.on_playback_started(0.0)
second = s6b.resume_from(1.6)        # cut again, during sentence 2
t("the first cut resumes at authored sentence 1", first == 1)
t("the second cut resumes at authored sentence 2, not local 1",
  second == 2, str(second))

print("\nP3 — sentence attribution does not rely on unique prose")
s7 = VisualCueSynchronizer()
dup = "Same line. Same line. Different line."
u7 = s7.open_unit(dup)
s7.on_timed_string("Same line. ", 0.0)
s7.on_timed_string("Same line. ", 1.0)
s7.on_timed_string("Different line.", 2.0)
t("identical sentences still get distinct offsets",
  u7.offsets == {0: 0.0, 1: 1.0, 2: 2.0}, str(u7.offsets))

print(f"\n{failed} FAILED" if failed else f"\nall {passed} synchronizer assertions passed")
sys.exit(1 if failed else 0)
