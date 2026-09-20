"""Sun Pathology Gujarati voice receptionist - LiveKit agent entrypoint.

Pipeline (brief section 1): mic -> Silero VAD -> STT (chirp_2, streaming, with
PhraseSet adaptation) -> Gemini (tools) -> normalize -> Chirp3-HD TTS -> speaker.

Providers come from config.py only (brief section 5) - nothing here imports a
vendor plugin directly, so STT/TTS/LLM swap via .env.

Accuracy contract: the LLM may NEVER state a price, TAT, fasting rule or package
content from memory. Numbers come only from lookup_item output, and guard.py
re-checks every turn before it is spoken.

Run:  python -m agent.main dev      (or `start` in prod)
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Dict

from livekit import api
from livekit.agents import (
    Agent,
    AgentSession,
    AudioConfig,
    BackgroundAudioPlayer,
    BuiltinAudioClip,
    JobContext,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)

from . import config as cfg
from . import guard as guard_mod
from . import normalize as normalize_mod
from . import tools as tools_mod

logger = logging.getLogger("sunpath")
ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = ROOT / "agent" / "prompts" / "system_gu.md"

GREETING = os.environ.get(
    "GREETING",
    "નમસ્તે, સન પેથોલોજી લેબોરેટરી એન્ડ રિસર્ચ ઇન્સ્ટિટ્યૂટમાં આપનું સ્વાગત છે. હું આપની શું મદદ કરી શકું?",
)

# "One moment, I'm checking" - spoken the instant a lookup fires. Varied so a
# caller asking three things in a row doesn't hear the same clip three times,
# which is what makes a bot sound like a bot.
_HOLD_LINES = (
    "એક ક્ષણ, હું વિગત ચેક કરું છું...",
    "જરા લાઇન પર રહો, હું જોઈ લઉં છું...",
    "એક સેકન્ડ, હું કન્ફર્મ કરી લઉં...",
)

# Spoken when the model itself fails (429 / timeout / connection). NEVER go
# silent: a caller hearing nothing assumes the line dropped. Offer the human.
FALLBACK_LINE = os.environ.get(
    "FALLBACK_LINE",
    "માફ કરશો, અત્યારે સિસ્ટમમાં થોડી તકલીફ છે. તમે અમારા કસ્ટમર કેર "
    "શૂન્ય સાત નવ, છ સાત શૂન્ય શૂન્ય, છ સાત શૂન્ય શૂન્ય પર કૉલ કરી શકો છો.",
)

# After this many consecutive session errors, stop retrying and close politely
# rather than loop. Three strikes is enough to know it is not transient.
MAX_CONSECUTIVE_ERRORS = int(os.environ.get("MAX_CONSECUTIVE_ERRORS", "3"))
# Hard ceiling on a demo call - stops a forgotten tab billing STT/LLM all night.
MAX_SESSION_SECONDS = int(os.environ.get("MAX_SESSION_SECONDS", "900"))

# Office ambience behind the agent (owner direction 2026-07-14), mirroring the
# MyScanHub agent which runs BuiltinAudioClip.OFFICE_AMBIENCE. A totally silent
# background is a dead giveaway that nobody is really there; a faint office bed
# makes the line read as a real reception desk. MyScanHub runs this at 0.7 -
# the owner asked for 60% here, which also sits better under Gujarati TTS.
AMBIENCE_ENABLED = os.environ.get("AMBIENCE_ENABLED", "1").strip().lower() in ("1", "true", "yes")
AMBIENCE_VOLUME = float(os.environ.get("AMBIENCE_VOLUME", "0.6"))

# --- silence + farewell handling (owner: "timeout after 10 secs, disconnect on
# keywords like bye") ------------------------------------------------------
#
# 10s of silence does NOT hang up immediately - it asks once ("are you still
# there?"), then closes 10s later if still nothing. A caller who paused to find
# their report should not be cut off mid-thought; a caller who walked away
# should not bill us for 15 minutes.
USER_AWAY_TIMEOUT = float(os.environ.get("USER_AWAY_TIMEOUT", "10"))
AWAY_GRACE_SECONDS = float(os.environ.get("AWAY_GRACE_SECONDS", "10"))
STILL_THERE_LINE = "શું તમે લાઇન પર છો?"
CLOSING_LINE = "સન પેથોલોજીનો સંપર્ક કરવા બદલ આભાર. આવજો."

# Only UNAMBIGUOUS farewells end the call. Deliberately excludes bare "બસ"
# (also "bus", and "બસ એટલું જ" can open a follow-up) and bare "આભાર"/"thank
# you", which Gujarati speakers say mid-conversation constantly - hanging up on
# a polite thank-you would be worse than staying on a beat too long.
#
# MATCH WHOLE TOKENS, NEVER SUBSTRINGS. "બાય" (bye) is a substring of
# "બાયોપ્સી" (biopsy) - substring matching hung up on a caller asking about a
# biopsy, at a pathology lab. Same trap in English ("bye" inside other words).
_GOODBYE_TOKENS = frozenset(
    {
        "આવજો",
        "બાય",
        "બાય-બાય",
        "bye",
        "bye-bye",
        "goodbye",
        "alvida",
        "aavjo",
    }
)
# Multi-word closings, distinctive enough that substring matching is safe.
_GOODBYE_PHRASES = (
    "ખુદા હાફિઝ",
    "ફોન મૂકું",
    "ફોન રાખું",
    "મૂકું છું",
    "રાખું છું",
    "good bye",
)

# Split on whitespace and sentence punctuation, incl. the Gujarati danda (।).
_TOKEN_RE = re.compile(r"[^\s,.।?!;:\"'()]+")


def _is_farewell(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    if any(p in t for p in _GOODBYE_PHRASES):
        return True
    return bool(_GOODBYE_TOKENS & {tok for tok in _TOKEN_RE.findall(t)})


# A 62-parameter package must never be read out. The brief: quote the count from
# tests_included and offer to WhatsApp the full list. Trim what the MODEL sees -
# instructing it not to read them is far less reliable than not handing them over.
PACKAGE_CONTENTS_SPOKEN_MAX = int(os.environ.get("PACKAGE_CONTENTS_SPOKEN_MAX", "6"))


def _strip_prices_when_ambiguous(result: Dict[str, Any]) -> Dict[str, Any]:
    """On a LOW-confidence lookup, remove the prices before the model sees them.

    Owner decision 2026-07-14: when a caller says "CBC", keep asking which one -
    the price list has no plain CBC, only "CBC With Mp By Antigen" (a CBC bundled
    with a malaria test).

    The tool already returned confidence=low + 3 candidates + a clarify question,
    and the prompt already says not to assert. The model asked which CBC anyway
    AND read out "MRP ₹350, discounted ₹170" in the same breath (qa_eval case
    ambiguous_cbc). A caller hears the number and stops listening - so it has
    effectively been quoted the malaria-bundle price for a plain CBC.

    Instructing a model not to say something it can see is unreliable. Not giving
    it the number is reliable. Names + the clarify question are enough to ask the
    question; once the caller picks one, that follow-up lookup resolves to a
    single item, comes back high-confidence, and carries its prices normally.
    """
    if not result.get("found"):
        # No match at all -> hand to a human (owner decision 2026-07-14, prompted
        # by eGFR). eGFR (Estimated GFR) is listed INSIDE packages but has no row
        # in the price list - it is derived from creatinine, so there is nothing
        # to quote. route_intent() calls that question "test_price_enquiry" and
        # routes it to `answer`, because intent routing cannot know the catalogue
        # is missing the item. The transfer therefore has to hang off the LOOKUP
        # failing, not the intent - which also covers every other unpriceable
        # test, not just the one the owner happened to spot.
        result["note"] = (
            "NO MATCH - there is no price for this. Do NOT guess, and do NOT "
            "offer a similar test's price. Tell the caller you'll have the team "
            "confirm it, take their name and mobile, and call transfer_to_agent "
            "with intent='unknown'."
        )
        result["should_transfer"] = True
        return result
    if result.get("confidence") != "low":
        return result
    for item in (result.get("items") or []) + (result.get("candidates") or []):
        for field in ("mrp", "price"):
            if field in item:
                item.pop(field, None)
    result["prices_withheld"] = True
    result["note"] = (
        "AMBIGUOUS: prices deliberately withheld. Ask the caller which of these "
        "they mean using `clarify`, WITHOUT quoting any price - you do not have "
        "one. After they choose, call lookup_item again with that exact name."
    )
    return result


def _trim_for_voice(result: Dict[str, Any]) -> Dict[str, Any]:
    for item in result.get("items") or []:
        contents = item.get("contents")
        if isinstance(contents, list) and len(contents) > PACKAGE_CONTENTS_SPOKEN_MAX:
            item["contents_total"] = len(contents)
            item["contents"] = contents[:PACKAGE_CONTENTS_SPOKEN_MAX]
            item["contents_truncated"] = True
            item["voice_hint"] = (
                f"This package has {len(contents)} items. Say the COUNT and name only a "
                "few examples, then offer to send the full list on WhatsApp. Do NOT read "
                "the whole list aloud."
            )
    return result


def _hold_line() -> str:
    return _HOLD_LINES[int(time.monotonic() * 1000) % len(_HOLD_LINES)]


def _instructions() -> str:
    if not PROMPT_PATH.exists():
        raise RuntimeError(
            f"System prompt missing at {PROMPT_PATH}. It is generated from the owner's "
            "Master Training Document - see README."
        )
    text = PROMPT_PATH.read_text(encoding="utf-8")
    # The price-quoting rule is config-driven because the owner doc (section 16,
    # "a strict Sun Pathology rule") and the build brief (section 3.1) contradict
    # each other. Doc wins by default; PRICE_QUOTE_STYLE=discount_only flips it.
    if cfg.PRICE_QUOTE_STYLE == "discount_only":
        text += (
            "\n\n## Price quoting override\n"
            "Quote ONLY the discounted Sun Pathology price. Mention the MRP only if "
            "the caller explicitly asks for it.\n"
        )
    else:
        text += (
            "\n\n## Price quoting override\n"
            "When quoting any price, state the MRP FIRST, then the discounted Sun "
            "Pathology price. Both numbers must come from lookup_item output.\n"
        )
    return text


class ReceptionistAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=_instructions())

    async def tts_node(self, text, model_settings):  # type: ignore[override]
        """Normalize every outgoing sentence before it reaches TTS (brief section 6):
        rupees/TAT/times/phone numbers -> Gujarati words, plus the respell dict for
        names Chirp3-HD mispronounces."""

        async def normalized():
            async for chunk in text:
                yield normalize_mod.normalize_for_tts(chunk)

        async for frame in Agent.default.tts_node(self, normalized(), model_settings):
            yield frame

    # --- tools (brief section 8) -----------------------------------------

    @function_tool()
    async def lookup_item(self, context: RunContext, query: str) -> Dict[str, Any]:
        """Look up a test or package: price (MRP + discounted), fasting requirement,
        report turnaround time, and package contents. You MUST call this for any
        price/TAT/fasting/contents question. Never answer those from memory.

        Args:
            query: the test or package the caller named, in any language.
        """
        # "Hold while I check" filler, spoken the instant the tool fires (owner's
        # pattern from the MyScanHub agent). A phone caller with NO audio assumes
        # the line died - dead air is the worst possible state. The lookup itself
        # is in-memory and instant; the gap this covers is the LLM round-trip
        # needed to compose the answer, which is ~0.5-1s even on a good day.
        # say() is fire-and-forget: it queues ahead of the answer, so the caller
        # hears "one moment..." then the price, in order.
        try:
            context.session.say(_hold_line(), allow_interruptions=True)
        except Exception:  # noqa: BLE001 - a filler must never break the lookup
            logger.debug("hold_filler_failed", exc_info=True)

        result = _strip_prices_when_ambiguous(_trim_for_voice(tools_mod.lookup_item(query)))
        context.userdata.setdefault("lookups", []).append(result)
        return result

    @function_tool()
    async def check_holiday(self, context: RunContext, date: str) -> Dict[str, Any]:
        """Check whether the centres are open on a given date (festival closures).

        Args:
            date: ISO date, YYYY-MM-DD.
        """
        return tools_mod.check_holiday(date)

    @function_tool()
    async def capture_lead(
        self,
        context: RunContext,
        kind: str,
        name: str,
        phone: str,
        area: str = "",
        details: str = "",
    ) -> Dict[str, Any]:
        """Record a home-collection, corporate or society enquiry.

        Args:
            kind: one of home_collection, corporate, society.
            name: caller or company/society name.
            phone: mobile number.
            area: area / centre preference / location.
            details: test or package, slot, employee count, etc.
        """
        return tools_mod.capture_lead(kind=kind, name=name, phone=phone, area=area, details=details)

    @function_tool()
    async def escalate(self, context: RunContext, reason: str) -> Dict[str, Any]:
        """Escalate report doubts / medical interpretation / corporate planning to
        Dr. Mayank Joshi.

        Args:
            reason: why escalation is needed.
        """
        return tools_mod.escalate(reason)

    @function_tool()
    async def transfer_to_agent(
        self,
        context: RunContext,
        intent: str,
        name: str = "",
        phone: str = "",
        details: str = "",
        transfer_to: str = "",
    ) -> Dict[str, Any]:
        """Hand the caller to a human. Call this for ANY booking (home collection
        or walk-in), ANY direct sale (buying a package, corporate health check-up,
        society camp), any report complaint you cannot resolve, any request for
        medical interpretation, and for ANYTHING you cannot answer from the
        playbook. Never guess instead of transferring.

        Collect the caller's name and mobile number before calling this where you
        reasonably can - the team needs them to call back.

        Args:
            intent: the playbook intent, e.g. home_collection_booking, direct_sales_purchase,
                corporate_health_checkup, society_health_camp, report_not_received, unknown.
            name: caller / company / society name, if given.
            phone: mobile number, if given.
            details: test or package, area, slot, employee count - whatever was said.
            transfer_to: customer_care or dr_joshi. Leave blank to let the playbook decide.
        """
        result = tools_mod.transfer_to_agent(
            intent=intent,
            name=name,
            phone=phone,
            details=details,
            transfer_to=transfer_to,
        )
        # The handoff is the end of OUR usefulness - mark it so the guard and any
        # later SIP seam can see the call reached a human, not a dead end.
        context.userdata["transferred"] = {"intent": intent, "to": result.get("transfer_to")}
        logger.info("transfer intent=%s to=%s", intent, result.get("transfer_to"))
        return result


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    session = AgentSession(
        stt=cfg.build_stt(),
        llm=cfg.build_llm(),
        tts=cfg.build_tts(),
        vad=cfg.build_vad(),
        userdata={},
        # Fires user_state_changed -> "away" after this much silence.
        user_away_timeout=USER_AWAY_TIMEOUT,
        # Barge-in. The brief said "keep LiveKit defaults" - but the defaults are
        # min_duration=0.5 / min_words=0, i.e. the WORD GATE IS OFF, so any 500ms
        # of VAD energy (a cough, a "haan", room noise) cancels the agent
        # mid-sentence. That exact default caused the same complaint on the
        # MyScanHub agent (see its BUGS.md, 2026-07-14). Requiring 2 transcribed
        # words keeps barge-in genuinely responsive to speech while ignoring noise
        # - which matters here because the demo room will not be quiet.
        turn_handling={
            # BARGE-IN. min_words=1, NOT 2 (2026-07-14, after a live test where the
            # owner could not interrupt at all).
            #
            # The gate is: agent_activity reads _audio_recognition.current_transcript
            # and refuses to interrupt while
            #     len(split_words(text, split_character=True)) < min_words
            # Measured on real Gujarati: "હા" -> 1 token, "બસ" -> 1 token, silence
            # and non-speech noise -> 0 tokens. So:
            #   min_words=2 blocks every SINGLE-WORD interruption - which is exactly
            #     how a person barges in ("હા", "બસ", "stop"). It felt like the bot
            #     ignoring you, because it was.
            #   min_words=1 still discards noise (a cough transcribes to nothing =
            #     0 tokens) while letting one real word cut the agent off.
            #   min_words=0 is LiveKit's default and the original MyScanHub bug -
            #     raw VAD energy, so a cough kills the sentence.
            # 1 is the only value that satisfies both "don't stop for a cough" and
            # "let me interrupt". The MyScanHub agent keeps 2 on purpose: it is a
            # real phone line where false interruption was the actual complaint,
            # and here barge-in is a headline demo feature. Same knob, different job.
            #
            # min_duration 0.5 -> 0.35: a one-word "હા" is short, and 500ms of VAD
            # was a second gate the same barge-in had to clear.
            "interruption": {
                "min_duration": float(os.environ.get("INTERRUPT_MIN_DURATION", "0.35")),
                "min_words": int(os.environ.get("INTERRUPT_MIN_WORDS", "1")),
            },
            # LATENCY. Target is sub-1.5s voice-to-voice (brief section 1).
            #
            # endpointing.min_delay is dead air we ADD to every single turn: the
            # wait after the caller stops before we even start thinking. Default
            # is 0.5s; 0.3 is LiveKit's own streaming default, so it is a tested
            # value, not a stunt. Lower still starts clipping people who pause
            # mid-sentence - which in Gujarati is common when reciting a test
            # name or a phone number, so 0.3 is the floor I am willing to take.
            "endpointing": {"min_delay": 0.3, "max_delay": 2.5},
            # preemptive_generation is already enabled by default, but
            # preemptive_tts is NOT: the LLM starts early while the voice still
            # waits for turn commit. Turning it on lets TTS start synthesising
            # the opening words before the turn is final.
            # Cost, honestly: speech synthesised for a turn the caller then talks
            # over is discarded - a little wasted TTS spend, and it must be paired
            # with the interruption gate above or it would stutter on noise.
            "preemptive_generation": {"enabled": True, "preemptive_tts": True},
        },
    )

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        """Accuracy guard (brief section 7): every spoken turn is checked against the
        tool output before it is trusted. Triggers are logged to eval/guard_log.jsonl
        as demo-day evidence."""
        try:
            item = getattr(ev, "item", None)
            if not item or getattr(item, "role", None) != "assistant":
                return
            text = getattr(item, "text_content", None) or ""
            if not text:
                return
            lookups = session.userdata.get("lookups") or []
            verdict = guard_mod.verify_turn(
                response_text=text, tool_results=lookups, called_lookup=bool(lookups)
            )
            if not verdict.get("ok"):
                logger.warning("guard_triggered: %s", verdict.get("reason"))
        except Exception:  # noqa: BLE001 - the guard must never break a live call
            logger.exception("guard_failed")

    # --- graceful failure (never dead air, never an infinite loop) ------------
    #
    # The first live test of this demo died exactly here: Gemini returned 429
    # (free-tier), the LLM never produced a turn, and the agent went SILENT
    # while the caller watched "thinking" forever. Vertex routing removes that
    # specific cause, but ANY provider can fail mid-call, so the session must
    # degrade out loud rather than freeze.
    errors = {"streak": 0}

    @session.on("error")
    def _on_error(ev) -> None:
        errors["streak"] += 1
        err = getattr(ev, "error", ev)
        logger.error("session_error streak=%s: %s", errors["streak"], err)

        async def _recover() -> None:
            try:
                # Say something. Anything. Silence reads as a dropped call.
                session.say(FALLBACK_LINE, allow_interruptions=True)
                if errors["streak"] >= MAX_CONSECUTIVE_ERRORS:
                    # Stop flailing: repeated failures are not transient, and a
                    # retry loop just burns the caller's patience and our quota.
                    logger.error("giving_up_after_%s_errors", errors["streak"])
                    await asyncio.sleep(6)  # let the fallback finish speaking
                    await ctx.api.room.delete_room(
                        api.DeleteRoomRequest(room=ctx.room.name)
                    )
            except Exception:  # noqa: BLE001 - recovery must never raise
                logger.exception("recover_failed")

        asyncio.create_task(_recover())

    @session.on("conversation_item_added")
    def _reset_streak(ev) -> None:
        # A successful turn means whatever broke has recovered.
        if getattr(getattr(ev, "item", None), "role", None) == "assistant":
            errors["streak"] = 0

    # --- close the call gracefully (owner) ----------------------------------
    closing = {"done": False}

    async def _close(reason: str, line: str | None = None) -> None:
        if closing["done"]:
            return
        closing["done"] = True
        logger.info("closing_call reason=%s", reason)
        try:
            if line:
                session.say(line, allow_interruptions=False)
                await asyncio.sleep(4)  # let it finish speaking, then hang up
            await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        except Exception:  # noqa: BLE001
            logger.exception("close_failed")

    @session.on("conversation_item_added")
    def _on_farewell(ev) -> None:
        item = getattr(ev, "item", None)
        if getattr(item, "role", None) != "user":
            return
        text = getattr(item, "text_content", None) or ""
        if _is_farewell(text):
            logger.info("farewell_detected: %r", text[:60])
            asyncio.create_task(_close("farewell", CLOSING_LINE))

    @session.on("user_state_changed")
    def _on_user_state(ev) -> None:
        # "away" = USER_AWAY_TIMEOUT of silence. Ask once, then close if the
        # grace window also passes with no reply.
        if getattr(ev, "new_state", None) != "away" or closing["done"]:
            return

        async def _check() -> None:
            try:
                session.say(STILL_THERE_LINE, allow_interruptions=True)
                await asyncio.sleep(AWAY_GRACE_SECONDS)
                if session.user_state == "away" and not closing["done"]:
                    await _close("silence", CLOSING_LINE)
            except Exception:  # noqa: BLE001
                logger.exception("away_check_failed")

        asyncio.create_task(_check())

    async def _cap_session() -> None:
        # A demo tab left open would otherwise stream STT + LLM indefinitely.
        await asyncio.sleep(MAX_SESSION_SECONDS)
        logger.info("session_time_cap_reached")
        try:
            session.say("કૉલ પૂરો કરું છું. સન પેથોલોજીનો સંપર્ક કરવા બદલ આભાર.")
            await asyncio.sleep(5)
            await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        except Exception:  # noqa: BLE001
            logger.exception("session_cap_failed")

    asyncio.create_task(_cap_session())

    await session.start(agent=ReceptionistAgent(), room=ctx.room)

    # Ambience AFTER session.start, BEFORE the greeting - same order as the
    # MyScanHub agent. Never let a missing sound bed kill a live call.
    if AMBIENCE_ENABLED:
        try:
            background = BackgroundAudioPlayer(
                ambient_sound=AudioConfig(
                    BuiltinAudioClip.OFFICE_AMBIENCE, volume=AMBIENCE_VOLUME
                ),
            )
            await background.start(room=ctx.room, agent_session=session)
            logger.info("ambience_started volume=%s", AMBIENCE_VOLUME)
        except Exception:  # noqa: BLE001 - ambience is cosmetic, the call is not
            logger.exception("ambience_start_failed")

    await session.generate_reply(instructions=f"Greet the caller with exactly: {GREETING}")


if __name__ == "__main__":
    # agent_name is MANDATORY here, not cosmetic. This demo shares a LiveKit
    # project with the live MyScanHub receptionist (agent_name
    # "myscanhub-receptionist"). LiveKit: "Set agent_name to enable explicit
    # dispatch. When explicit dispatch is enabled, jobs will NOT be dispatched
    # to rooms automatically." Leave it blank and this worker becomes an
    # AUTOMATIC-dispatch worker that joins EVERY new room on the project -
    # including real patients' inbound MRI calls, where a Gujarati pathology
    # bot would start talking over Eva. The token server dispatches this agent
    # explicitly into its own sunpath-demo-* room; nothing else can pull it in.
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=os.environ.get("AGENT_NAME", "sunpath-receptionist"),
            # LiveKit workers bind an internal health/debug HTTP server, default
            # prod_default=8081 - which the live MyScanHub voice-agent already
            # owns on this box. Without an override the Sun worker crash-loops on
            # OSError [Errno 98] address already in use.
            port=int(os.environ.get("AGENT_HTTP_PORT", "8083")),
        )
    )
