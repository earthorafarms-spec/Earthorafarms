"""Verify the [[SX-OPENING]] turn-1 override against the DEPLOYED agent.

Run inside the agent container:
  docker exec -e PYTHONPATH=/app server-schoolexl-agent-1 /app/.venv/bin/python /tmp/lt_verify.py

Section D is the one that matters: it reproduces the entrypoint's real prompt
mutation order. An earlier revision passed A/B/C (function tested in isolation)
and still shipped a silent no-op, because the entrypoint prepends to
system_prompt twice before MentorAgent is constructed.
"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("dep_agent", "/app/agent.py")
m = importlib.util.module_from_spec(spec)
sys.modules["dep_agent"] = m
spec.loader.exec_module(m)
ex = m._extract_opening

GREETING = "Greet the user briefly (1-2 short sentences max) and ask how you can help."
fails = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -> " + detail) if (detail and not cond) else ""))
    if not cond:
        fails.append(name)


LT = (
    "[[SX-OPENING]]Greet the student by name, then begin teaching Photosynthesis "
    "immediately. Do NOT greet-and-wait, do NOT ask how you can help, and do NOT "
    "wait for the student to speak first.[[/SX-OPENING]]"
    "[TEACHING MODE - LIVE WHITEBOARD]\nYou are teaching. Use board_show..."
)

print("=== A. LIVE TEACHER, prompt exactly as the client sends it ===")
op, rest = ex(LT)
check("opening extracted", op is not None)
check("carries the do-not-wait order", bool(op) and "do NOT wait for the student" in op)
check("body starts at [TEACHING MODE", rest.startswith("[TEACHING MODE"), repr(rest[:40]))
check("no marker leaks into persona", "SX-OPENING" not in rest)
check("body preserved", "board_show" in rest)

print()
print("=== B. NO-OP for every EXISTING surface (VIVA, doubt solver, LC voice) ===")
for label, p in [
    ("VIVA examiner", "You are Avani, an oral viva examiner. Ask one question at a time."),
    ("Doubt solver", "You are a doubt-solving tutor. Explain step by step."),
    ("LC voice mentor", "You are a friendly mentor for Class 8 Science."),
    ("empty prompt", ""),
]:
    op, rest = ex(p)
    check(label + ": untouched", op is None and rest == p)

print()
print("=== C. Malformed input must NEVER corrupt a prompt ===")
for label, p in [
    ("unclosed marker", "[[SX-OPENING]]never closed ... rest of prompt"),
    ("close before open", "[[/SX-OPENING]]stray close then [[SX-OPENING]]x"),
]:
    op, rest = ex(p)
    check(label + ": returned unchanged", op is None and rest == p, repr((op, rest))[:90])
op, rest = ex("[[SX-OPENING]][[/SX-OPENING]]real prompt")
check("empty opening -> falls back to greeting, body clean", op is None and rest == "real prompt", repr((op, rest)))
op, rest = ex(None)
check("None input safe", op is None and rest is None)

print()
print("=== D. INTEGRATION: the entrypoint's REAL mutation order (the regression) ===")
# agent.py entrypoint, verbatim shape:
#   system_prompt = session_context + "\n\n" + system_prompt      <- ALWAYS
#   if lang != English: system_prompt = lang_directive + system_prompt
SESSION_CTX = "You are talking to Aarav, a Class 8 student. Keep answers short."
LANG = "IMPORTANT: Always respond in Hindi. Never switch to English unless the user explicitly asks you to.\n\n"

for label, built in [
    ("English  (session_context prepended)", SESSION_CTX + "\n\n" + LT),
    ("Hindi    (session_context + lang_directive prepended)", LANG + SESSION_CTX + "\n\n" + LT),
]:
    op, rest = ex(built)
    check(label + " -> opening still found", op is not None, "marker was buried; startswith would miss it")
    check(label + " -> overrides the greeting", bool(op) and op != GREETING)
    check(label + " -> no marker leaks into persona", "SX-OPENING" not in rest)
    check(label + " -> session context SURVIVES", "Aarav" in rest)
    check(label + " -> teaching body SURVIVES", "board_show" in rest)
if "Hindi" not in "".join(fails):
    op, rest = ex(LANG + SESSION_CTX + "\n\n" + LT)
    check("Hindi -> language directive SURVIVES", "respond in Hindi" in rest)

print()
print("=== E. A non-participating surface is unaffected by the prepends too ===")
plain = SESSION_CTX + "\n\nYou are Avani, an oral viva examiner."
op, rest = ex(plain)
check("VIVA with session context: byte-identical", op is None and rest == plain)



# ---------------------------------------------------------------------------
# Section F — [[SX-AUTOCONTINUE]] / [[SX-TTS-RATE]] directives (2026-07-28).
# Same L72 discipline: test the string AS THE ENTRYPOINT SEES IT (directives
# are stripped before the prepends, but must survive being anywhere).
# ---------------------------------------------------------------------------
exd = m._extract_directives

print()
print("=== F. surface directives ===")
LT2 = ("[[SX-OPENING]]Begin teaching immediately.[[/SX-OPENING]]"
       "[[SX-AUTOCONTINUE=5]][[SX-TTS-RATE=0.9]][TEACHING MODE - LIVE WHITEBOARD]\nUse board_write...")
cleaned, d = exd(LT2)
check("autocontinue parsed", d["autocontinue"] == 5, repr(d))
check("tts rate parsed", d["tts_rate"] == 0.9, repr(d))
check("directives stripped", "SX-AUTOCONTINUE" not in cleaned and "SX-TTS-RATE" not in cleaned)
check("opening marker left intact for the later pass", cleaned.startswith("[[SX-OPENING]]"))
check("body preserved", "board_write" in cleaned)

# The opening extractor then runs on the cleaned string inside MentorAgent —
# prove the two passes compose.
op2, rest2 = ex(SESSION_CTX + "\n\n" + cleaned)
check("composes with opening extraction after prepend", op2 is not None and "SX-" not in rest2)

cleaned, d = exd("You are a doubt-solving tutor.")
check("no directives -> untouched", d["autocontinue"] is None and d["tts_rate"] is None and cleaned == "You are a doubt-solving tutor.")
cleaned, d = exd("[[SX-AUTOCONTINUE=999]]x[[SX-TTS-RATE=9.9]]")
check("values clamped (60 / 1.5)", d["autocontinue"] == 60 and d["tts_rate"] == 1.5, repr(d))
cleaned, d = exd(None)
check("None safe", d["autocontinue"] is None and cleaned is None)

print()
print("RESULT-F: " + ("ALL PASS" if not fails else "FAILURES: " + "; ".join(fails)))
sys.exit(1 if fails else 0)
