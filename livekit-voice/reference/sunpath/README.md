# Sun Pathology — Gujarati voice receptionist (DEMO)

A Gujarati-first voice receptionist for Sun Pathology Laboratory & Research Institute
(Ahmedabad). Browser call, no telephony. It answers price / TAT / fasting / timings /
address / package questions from a fixed knowledge base, and hands every booking and
every direct sale to a human.

**This is a temporary demo.** It is hosted at `https://sun.myscanhub.com`, passcode-gated,
and shares nothing with the MyScanHub portal — no shared repo, code, nginx file, process or
database. It is designed to be deleted. **[TEARDOWN.md](TEARDOWN.md) lists the complete
footprint (6 items) and removes it.**

Two rules everything else is built around:

1. **The LLM may never state a price, TAT, fasting rule or package content from memory.**
   Those numbers come only from `lookup_item` output, and `agent/guard.py` re-checks every
   turn against the tool result before it is spoken.
2. **If it is not in the playbook, transfer — never guess.** Ambiguity always resolves to a
   question or a handoff, never to a confident answer.

---

## 1. Setup

### 1.1 Python

Python 3.14, venv at `.venv`. There is **no `requirements.txt`** — the venv was built by
hand. To rebuild it:

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install \
  livekit-agents livekit-plugins-google livekit-plugins-silero \
  google-cloud-speech google-cloud-texttospeech google-genai \
  python-dotenv rapidfuzz aiohttp edge-tts numpy pytest
```

> `livekit-plugins-silero` is **not currently installed in `.venv`** (verified 2026-07-14).
> The evals don't need it; `agent/main.py` does — `config.build_vad()` imports it and the
> worker will not start without it.

On Windows, always run with `PYTHONUTF8=1`. The console is cp1252 and raises
`UnicodeEncodeError` the moment Gujarati reaches it. `stt_eval.py` and `tts_bakeoff.py`
force UTF-8 on their own streams; nothing else does.

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.qa_eval
```

### 1.2 Google Cloud

Enable **all three** APIs on the project (`msh-ai-501604`), with billing on:

| API | Service | Used for |
|---|---|---|
| Speech-to-Text **v2** | `speech.googleapis.com` | STT (`chirp_2`, streaming, `asia-southeast1`) |
| Text-to-Speech | `texttospeech.googleapis.com` | TTS (Chirp3-HD gu-IN) |
| Vertex AI | `aiplatform.googleapis.com` | LLM (`gemini-2.5-flash`, `asia-south1`) |

**Auth is a service account — not an API key.** Cloud Speech-to-Text v2 and Cloud
Text-to-Speech both reject API keys outright (`API keys are not supported by this API`).
The same SA covers all three legs.

| Role | Why |
|---|---|
| `roles/speech.client` | Speech-to-Text v2 |
| `roles/aiplatform.user` | Vertex AI (Gemini) |
| — | Text-to-Speech has no dedicated role; the enabled API + billing is the gate |

Current SA: `google-tts@msh-ai-501604.iam.gserviceaccount.com`.
Key file lives at `D:\Work2026\MyScanHub\sun\gcp-sa.json` locally (the repo's **parent**
folder, not the repo) and `/opt/sun-voicebot/gcp-sa.json` on the VPS. Point
`GOOGLE_APPLICATION_CREDENTIALS` at it.

### 1.3 .env

`cp .env.example .env` and fill it. `.env` is gitignored.

> **`.env.example` is behind `config.py`.** It still documents `GOOGLE_API_KEY` as the LLM
> credential and omits the Vertex block entirely. The LLM runs on **Vertex** by default
> (§6.4). Add the vars marked ✚ below.

| Var | Default | Notes |
|---|---|---|
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | — | Required. Shared project — see §3.1 |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to the SA JSON. Required |
| ✚ `GOOGLE_CLOUD_PROJECT` | *(from SA)* | Vertex project. Set it explicitly: `msh-ai-501604` |
| ✚ `GOOGLE_CLOUD_LOCATION` | `asia-south1` | Vertex region (Mumbai) |
| ✚ `LLM_USE_VERTEX` | `1` | `0` = AI-Studio key path. Free tier, 429s mid-call. Debug only |
| ✚ `LLM_THINKING_BUDGET` | `0` | `0` disables Gemini thinking. `-1` restores Google's default |
| ✚ `AGENT_NAME` | `sunpath-receptionist` | **Must** match on worker and token server. See §3.1 |
| ✚ `AGENT_HTTP_PORT` | `8083` | 8081 is taken by the live MyScanHub `voice-agent` on the VPS |
| `DEMO_PASSCODE` | — | **Required.** Blank fails *closed* (503), it does not disable the gate |
| `STT_MODEL` | `chirp_2` | Not `chirp_3` — see §6.1 |
| `STT_LOCATION` | `asia-southeast1` | Chirp is not served from `asia-south1` — see §6.2 |
| `TTS_VOICE` | `gu-IN-Chirp3-HD-Achernar` | **Placeholder** — sorts first alphabetically. Client picks (§7) |
| `TTS_FALLBACK` | `edge` | `none` means a TTS outage is silence. Leave it on |
| `PRICE_QUOTE_STYLE` | `mrp_then_discount` | Owner rule: MRP first, then the discount |

Everything else (ambience, barge-in thresholds, silence timeouts, rate limits) is in
`.env.example` with its reasoning.

> **pm2 does NOT load `.env`.** `python-dotenv` does — `agent/config.py` and
> `server/token_server.py` each call `load_dotenv()` against an **explicit absolute path**
> before their first `os.environ` read, because pm2's cwd is not guaranteed. Consequences:
> - Do not remove those `load_dotenv()` calls; the worker dies with
>   `ws_url is required, or set LIVEKIT_URL` and the token server 503s
>   `livekit_not_configured`.
> - pm2 **caches env**. After editing `.env`: `pm2 restart sun-voicebot --update-env`.

---

## 2. Run

Three processes. Locally:

```bash
# 1. the agent worker
PYTHONUTF8=1 .venv/Scripts/python.exe -m agent.main dev     # `start` in prod

# 2. the token server (mints LiveKit join tokens; 127.0.0.1:8092)
PYTHONUTF8=1 .venv/Scripts/python.exe -m server.token_server

# 3. web/index.html — static. nginx serves it and proxies /api/* to the token server.
```

nginx **must** send `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` or every
visitor shares one rate-limit bucket and the 11th request of any kind 429s the whole demo.

---

## 3. Architecture

```
browser (web/index.html, LiveKit client CDN)
   │  GET /api/token  ──▶ server/token_server.py  ── passcode + per-IP rate limit
   │                                              └─ explicit agent dispatch ─┐
   ▼  WebRTC                                                                  │
LiveKit room  ◀──────────────────────────────────────────────────────────────┘
   ▼
agent/main.py (LiveKit worker)
   mic → Silero VAD → STT chirp_2 gu-IN (streaming, PhraseSet adaptation)
       → Gemini 2.5 Flash on Vertex (5 function tools, thinking off)
       → agent/guard.py  (price verification)
       → agent/normalize.py (₹/TAT/time/phone → Gujarati words, respell dict)
       → TTS Chirp3-HD gu-IN  ──(FallbackAdapter)──▶ edge-tts
       → speaker
```

| Path | What |
|---|---|
| `agent/main.py` | Worker entrypoint, session wiring, tools, barge-in, silence/farewell handling |
| `agent/config.py` | **The only place a vendor is named.** Builds STT/TTS/LLM/VAD from `.env` |
| `agent/tools.py` | `lookup_item`, `check_holiday`, `capture_lead`, `escalate`, `transfer_to_agent`, `route_intent` |
| `agent/guard.py` | Post-generation price check → `eval/guard_log.jsonl` |
| `agent/normalize.py` | TTS text normalization + `RESPELL` dict |
| `agent/prompts/system_gu.md` | System prompt, from the owner's Master Training Document |
| `knowledge/tests.json` | 316 tests. **Do not edit** |
| `knowledge/packages.json` | 61 packages. **Do not edit** |
| `knowledge/aliases.json` | 192 alias entries → canonical names |
| `knowledge/playbook.json` | Intent → answer/transfer routing table |
| `knowledge/holidays_2026.json` | Festival closures. **Pending client sign-off** (§7) |

`lookup_item(query)` returns
`{query, found, confidence, match_type, items[], candidates[], clarify, price_quote_order, note}`.
`confidence` is `"high"` **only** when exactly one item matched *and* there is no `clarify`
question. Everything else is `"low"`, which the prompt turns into a question rather than an
assertion. Resolution order: exact → alias → rapidfuzz `token_set_ratio` ≥ 85 → top-3
candidates with `found: false`.

### 3.1 `agent_name` / explicit dispatch is MANDATORY

**This demo shares a LiveKit project with the live MyScanHub receptionist.**

LiveKit: *"Set `agent_name` to enable explicit dispatch. When explicit dispatch is enabled,
jobs will NOT be dispatched to rooms automatically."* A worker registered **without**
`agent_name` is an **automatic-dispatch** worker: it joins **every new room on the project**
— including real patients' inbound MRI calls, where a Gujarati pathology bot would start
talking over the live agent (Eva).

So:

- `agent/main.py` sets `WorkerOptions(agent_name=os.environ.get("AGENT_NAME", "sunpath-receptionist"))`.
- `server/token_server.py` names that same agent in
  `RoomConfiguration(agents=[RoomAgentDispatch(agent_name=AGENT_NAME)])`.
- The two **must match**, or the caller sits in an empty room.
- Never blank `AGENT_NAME` to "make dispatch work". That is the failure mode, not the fix.

The worker also binds `AGENT_HTTP_PORT=8083`; LiveKit's default `8081` is already owned by
the live `voice-agent` on the VPS, and the collision is an `OSError: address already in use`
crash-loop.

---

## 4. Swapping providers

`agent/main.py` never imports a vendor. `agent/config.py` builds everything from `.env`, so
a swap is an env change and a restart:

```bash
STT_PROVIDER=google|sarvam        # build_stt()
TTS_PROVIDER=google|sarvam|edge   # build_tts()
LLM_PROVIDER=google               # build_llm()
```

- `TTS_PROVIDER=edge` runs the whole demo with **zero Google setup** (no credentials). Useful
  on a laptop; it is an unofficial consumer endpoint with no SLA, so not for the demo itself.
- `TTS_FALLBACK=edge` (default) wraps the primary in livekit's own `tts.FallbackAdapter`, so
  a Chirp3-HD outage degrades to edge-tts instead of to silence. It probes Google in the
  background and returns on its own.
- **`sarvam` is a seam, not an implementation.** `config.py` imports
  `agent/providers_sarvam.py`, which does not exist, and there is **no Sarvam API key on this
  project**. Selecting it raises ImportError. The interface is in place if a key ever lands.

Any other knob (model, region, voice, temperature, thinking budget, phrase boost) is env-only
— see the table in §1.3.

---

## 5. Evals

Three harnesses. All of them drive the **real** production objects (`cfg.build_llm()`,
`cfg.build_stt()`, `ReceptionistAgent().tools`, `normalize_for_tts()`) rather than a copy, so
they cannot keep passing after production drifts.

### 5.1 `qa_eval` — fact accuracy (brief §9.1)

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.qa_eval
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.qa_eval --only price_ --verbose
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.qa_eval --json-out eval/out/qa_run.json
```

60 Gujarati cases, text-only (no audio), through the real LLM + tools. Exit 0 only if all
pass. Every expected number is **re-derived from `tests.json` / `packages.json` before the
first LLM call** — if the JSONL has drifted, the run aborts with exit 3 and tells you to
regenerate it (`python -m eval.build_qa_eval`). A hand-typed or stale price cannot survive.

> **Status: NOT green.** Last recorded run was **42/60 (70%)** — `eval/out/qa_run2.json`,
> 2026-07-14 21:07. That artifact **predates the current `qa_eval.jsonl`** (regenerated
> 21:08), so re-run before quoting any number. Brief §9.1 target is **100% before any voice
> testing**. 18 cases were failing, concentrated in `price_*`, `fasting_*`, the three
> out-of-scope `medical_*` refusals, `unknown_vitamin_k` and `ambiguous_cbc`.

### 5.2 `stt_eval` — WER (brief §9.2)

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.stt_eval --self-test   # no recordings needed
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.stt_eval               # scores eval/clips/
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.stt_eval --ab          # PhraseSet on vs off
STT_PROVIDER=sarvam ... -m eval.stt_eval                             # the head-to-head
```

Convention: `eval/clips/<group>/<name>.wav` next to `<name>.txt` (UTF-8, what was *actually*
said). Subfolders become groups → per-category WER. A `.wav` with no `.txt` is **reported,
not skipped**. Anything ffmpeg can decode is accepted (phones hand you `.m4a`).

Reads CER alongside WER deliberately: Gujarati agglutinates, so WER over-punishes — a big
WER/CER gap means right sounds, wrong word boundaries. The run also reports **near-miss
substitutions** (`થાયરોઈડ`/`થાઇરોઇડ` — the same word, spelled differently); when that share
is high, CER is the honest number.

`--self-test` needs no recordings: it synthesizes a clip with edge-tts and proves the harness
runs end to end (decode → 16k → live STT → WER). It proves the plumbing, **not** accuracy —
synthetic TTS audio is clean studio speech.

### 5.3 `tts_bakeoff` — blind voice audition (brief §9.3)

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.tts_bakeoff --list-voices
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.tts_bakeoff --sentences 3 --voices Achernar,Kore
PYTHONUTF8=1 .venv/Scripts/python.exe -m eval.tts_bakeoff            # all 14 female voices
```

Renders 10 fixed Gujarati receptionist lines (real copy, real prices) through a shortlist of
Chirp3-HD voices **plus the edge-tts fallback**, into `eval/out/{provider_voice}/{n}.wav`,
and writes `eval/out/index.html` — a blind A/B/C player. **`eval/out/key.json` is the answer
sheet: do not open it in front of the client.**

Every line goes through `normalize.py` first — the WAVs contain what a caller actually hears,
not what the LLM wrote. Labels are shuffled against a recorded `--seed` so the client cannot
place a voice by position. The run warns if the level spread exceeds 6 dB (louder reliably
reads as "clearer" in a blind test).

Not the bake-off the brief asked for: it specified Chirp3-HD **vs Sarvam Bulbul**, and there
is no Sarvam key. The rendered comparison is Chirp3-HD candidates vs the edge-tts fallback,
which is what a caller can actually hear in production.

### 5.4 Unit tests

```bash
PYTHONUTF8=1 .venv/Scripts/python.exe -m pytest eval/ -q
```

`test_tools.py`, `test_normalize.py`, `test_guard.py`, `test_playbook.py`,
`test_fallback_tts.py`, `test_token_gate.py`. No network, no credentials — **359 passing**
(2026-07-14). These are the only green gate in the project; `qa_eval` (§5.1) is not.

---

## 6. Known limitations & decisions

Each of these was measured against the live APIs on **2026-07-14**. Do not "fix" them back.

### 6.1 STT is `chirp_2`, not `chirp_3` — and that is not a Gujarati gap

`chirp_3` is **withdrawn from general availability**. It 403s identically for *every* locale
— gu-IN, en-US and hi-IN alike:

```
Permission denied ... on model chirp_3 locale gu-IN. It is no longer generally available.
```

No IAM role fixes it. The brief's own fallback ("fall back to `chirp_2` streaming") is what
runs. `chirp_2` is also the **only** model serving gu-IN here — `long`, `short` and
`telephony` all reject gu-IN in `asia-southeast1`.

TTS **"Chirp3-HD" is a different product** from STT "chirp_3" and works fine. 30 gu-IN
Chirp3-HD voices exist (the brief guessed 8): 14 female, 16 male.

### 6.2 The STT leg leaves India

Chirp is **not served from `asia-south1`**. STT runs in **`asia-southeast1`** (Singapore, the
nearest supported region). The LLM leg runs in **`asia-south1`** (Mumbai, nearest to
Ahmedabad, verified serving `gemini-2.5-flash`). So a turn crosses regions by design. This is
a platform constraint, not a configuration mistake.

### 6.3 gu-IN has no custom-pronunciation support

Chirp3-HD exposes no pronunciation override for gu-IN. The **only** lever for a mispronounced
test name is respelling the text before synthesis — `RESPELL` in `agent/normalize.py`:

```python
RESPELL: dict[str, str] = {
    "TSH": "ટી એસ એચ",   # PROVISIONAL -- verify in voice testing
    "PSA": "પી એસ એ",    # PROVISIONAL -- verify in voice testing
}
```

Both entries are **provisional and unverified**. Log every mispronunciation found in voice
testing into that dict; it is expected to grow.

### 6.4 `thinking_budget=0` — the single biggest latency win

Gemini 2.5 Flash enables "thinking" by default. Measured on the real system prompt + tools,
`asia-south1`, 5 questions:

| | median TTFT |
|---|---|
| thinking ON (Google's default) | **1290 ms** |
| thinking OFF (`thinking_budget=0`) | **613 ms** |

**677 ms / 52% faster.** The model was spending ~0.7 s reasoning about "what are your
timings?", which a caller experiences as the line going dead. This workload is
read-a-fact + call-a-tool; correctness here comes from temperature 0.2, a strict prompt and
the tool-only pricing rule — not from chain-of-thought.

### 6.5 Prompt caching works, and was deliberately NOT enabled

Explicit Vertex prompt caching was implemented and measured: **6718 / 6724 tokens cached**
(the tools must live inside the cache for it to hold). It bought **0 ms**. It is a **cost**
lever (~75% off input tokens), not a latency one.

Not enabled, because the failure mode is asymmetric: a **stale cache would silently strip
`lookup_item`** from the tool set, and a receptionist that cannot look anything up but still
answers is precisely the bot this whole design exists to prevent. Cents saved against the one
failure we cannot detect from the outside.

### 6.6 PhraseSet adaptation is accepted, but not yet *proven* to weight

The API **accepts** 377 test + package names at boost 12 over `chirp_2` + gu-IN +
StreamingRecognize. Nobody has demonstrated it changes the output. `stt_eval --ab` (or
`--no-adaptation`) is the A/B: both arms are built from the same `build_stt()` and differ in
exactly one field, and the flag **asserts** the phrase set actually went off rather than
assuming it (a silently no-op'd `--no-adaptation` would produce a clean, wrong "adaptation
makes no difference" verdict).

Current evidence is **not** a result: `eval/out/wer_ab.json` has **one synthetic clip**, both
arms at 36.4% WER / 26.4% CER, delta 0.0. That is a plumbing check, not a measurement — it
needs the ~30 real phone clips.

**A related, measured gap:** `phrase_hints()` builds 1478 phrases (377 names + ASCII aliases)
and sorts them **longest-first**, then truncates to `STT_MAX_PHRASES=1000`. So 478 phrases
never reach the API — the **shortest** ones — and **66 of them are canonical test names**:
`ACTH`, `APTT`, `Anti TPO`, `ANA By IF`, `Albumin`, `Amylase`… i.e. exactly the abbreviations
a recognizer is most likely to fumble and that adaptation would help most. `stt_eval` prints
this on every run. Reported, not fixed: raising the cap is a production change and Google's
real inline-adaptation limit has not been established.

### 6.7 `transfer_to_agent` is SIMULATED

There is no SIP trunk (brief: *"SIP trunk comes later — do NOT build telephony now"*). A
"transfer" is: announce it in Gujarati, capture name + mobile, log a line to `leads.jsonl`,
give the correct number, close politely. It deliberately **never says "I'm connecting you"** —
there is no line to connect to, and a receptionist who says she is transferring you and then
hangs up is worse than one who never offered.

The seam is confined to `_transfer_announce()` in `agent/tools.py`. When the trunk lands: add
`_transfer_sip()`, switch `TRANSFER_MODE`. The tool signature, the lead log, the routing
table and the prompt do not move — the LLM already calls `transfer_to_agent` and does not
know how the handoff is physically achieved.

`capture_lead` is simulated the same way: one JSON line to `leads.jsonl`, no CRM, no SMS, no
network.

### 6.8 Other things worth knowing

- **There is no plain `CBC` row** — see §7.
- **Package `contents[]` are not `tests.json` names.** Measured 2026-07-14: **604 of 848**
  content lines (116 unique names) resolve to no `tests.json` row at all — packages say
  "Fasting Blood Sugar (FBS)" where `tests.json` says "Fasting Plasma Glucose Analysis", and
  "eGFR (Estimated GFR)" has no row anywhere. Never price a package by matching its contents
  back to `tests.json`; it silently invents prices. `contents` is returned verbatim, for
  reading aloud only, alongside `tests_included` for the "N parameters" line.
  (`agent/tools.py`'s docstring says "131 of 848" — that figure is stale.)
- **A 62-parameter package is never read out.** `main.py` trims `contents` to 6 before the
  model sees them and returns the count + an offer to WhatsApp the list (simulated).
- The `timings` line in the bake-off is written as prose, not `8:00 AM – 8:00 PM`, because
  `normalize_time()` only emits the locative `વાગ્યે` — a *range* comes out as "from at-eight
  to at-eight until". That path isn't hit in production (timings route to a pre-written FAQ
  string), but it is a live normalizer bug.

---

## 7. OPEN ITEMS FOR THE CLIENT

These are decisions only Sun Pathology can make. The demo runs without them; it cannot be
called correct without them.

**1. Sign off the 2026 holiday dates.**
`knowledge/holidays_2026.json`. Four dates are cross-verified against two independent sources
(Govt of Gujarat GAD notification + DrikPanchang) and marked `verified: true`: Uttarayan
14 Jan, Dhuleti 4 Mar, Raksha Bandhan 28 Aug, Diwali 8 Nov, Bhai Dooj 11 Nov.

**The Diwali block is the real problem.** The house rule says "Diwali, day after Diwali, Bhai
Dooj" — three consecutive days in a normal year. 2026 breaks the pattern:

| Date | | |
|---|---|---|
| Sun 8 Nov | Diwali | closed |
| **Mon 9 Nov** | **"day after Diwali" — no festival at all** | **?** |
| **Tue 10 Nov** | **Bestu Varas / Gujarati New Year** | **?** |
| Wed 11 Nov | Bhai Bij | closed |

Kartik Shukla Pratipada doesn't prevail at sunrise on 9 Nov, so Bestu Varas lands on 10 Nov,
leaving 9 Nov a gap day. The rule almost certainly *means* Bestu Varas. Both are flagged
`verified: false`, so `check_holiday()` answers "open, confirming with the team" rather than
guessing either way.
> **Are you closed 9 Nov, 10 Nov, or 9–11 Nov inclusive?**

Note: Diwali falls on a **Sunday** in 2026 and the lab normally opens Sundays, so that
closure still needs announcing.

**2. Choose the TTS voice.**
30 gu-IN Chirp3-HD voices exist. `TTS_VOICE=gu-IN-Chirp3-HD-Achernar` is a **placeholder** —
it sorts first alphabetically. Run `python -m eval.tts_bakeoff`, open `eval/out/index.html`,
pick a label by ear. The winning label's voice goes into `TTS_VOICE`.
> **Which voice — and is the edge-tts fallback voice acceptable when Chirp3-HD is down?**

**3. CBC — there is no plain "CBC" row in your price list.**
The lab's row is **"CBC With Mp By Antigen"** (a CBC bundled with a malaria antigen), at a
different price. So the single most-asked query on a lab phone line resolves to 3 candidates
and a clarifying question, and always comes back low-confidence. This is deliberate — the
alternative is confidently quoting the bundled price to someone who asked for a plain CBC.
> **When a caller says "CBC", is "CBC With Mp By Antigen" what you quote — or should a plain
> CBC row be added to the price list?**

**4. eGFR has no price row at all.**
`"eGFR (Estimated GFR)"` appears in package contents but has no row in `tests.json`, so it
cannot be priced. The bot refuses and offers escalation.
> **Is eGFR sold standalone? If so, at what price?**

**5. Confirm the ambiguity policy is "ask".**
"thyroid" matches both a test (TSH) and packages (Thyroid Profile Basic / Advanced). "sugar"
matches FBS and PPBS. Current behaviour: present both briefly and **ask which they mean**,
never assert one.
> **Confirm: ask. (The alternative — defaulting to the cheapest or the most common — is a
> business decision, not ours.)**

**6. Package contents were scraped from the staging site.**
`knowledge/packages.json` `contents` were fetched from
`https://srv794025.hstgr.cloud/packages/<slug>` (staging), not a client-supplied list.
`knowledge/scrape_failures.json` is empty — all 61 succeeded — but "it scraped cleanly" is not
"it is correct".
> **Is the staging site current pricing and current package contents?**

---

## 8. Removing this demo

**[TEARDOWN.md](TEARDOWN.md)** — total footprint is 6 items (VPS dir, nginx block, TLS cert,
pm2 process, Cloudflare DNS record, local source). Nothing was added to `myscanhub-portal`.
Removing it cannot affect myscanhub.com, and the doc includes the verification commands to
prove that.
