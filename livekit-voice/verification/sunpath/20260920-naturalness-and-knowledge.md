# Naturalness and knowledge verification — 20 September 2026

## Knowledge reference audit

The user authorized the former Render bot as a **knowledge reference only**. The voice architecture remains MSH/SunPath. This audit read public product facts from the existing legacy Earthora runtime's configured Supabase; **the Render dashboard was not queried**, and its active deployment was not independently attested.

All nine approved, currently effective Morilife+ Moringa Leaf Tablets knowledge records matched the current Postgres records exactly: text, category, FAQ question, locale, version, status, approval time and effective window. No database import, catalogue reset or knowledge edit was needed. The reference also listed a powder product; it was not added to the current catalogue.

Verified facts include:

- Ingredients: “Each tablet contains 500 mg of Moringa Leaf.”
- Suggested use: 1–2 tablets once or twice daily, before breakfast or dinner, following the label and the record's medical-advice qualification.
- Directions, storage, contraindications, description, benefits, and separate caffeine/binder FAQs are available as their own approved records.

The copied website FAQ contains a conflicting tablet dose. Category-specific approved product records now retain their provenance instead of being flattened into mixed website text. No daily or weekday-specific dispatch calendar was established by the legacy approved product records. Historical company prompt wording was treated as reference evidence, not imported as new approved facts.

Source rules are documented in [the original knowledge repository](../../../voice-service/src/repositories/knowledge.repository.ts) and [the tracked product-knowledge audit migration](../../../supabase/migrations/20260909123000_audit_active_product_knowledge.sql).

## Native API deployment

The native voice `/internal/context` and `search_knowledge` boundary now returns complete approved product records before copied indexed passages. Records retain exact product binding, category, original FAQ question, locale, version, approval status and effective-window metadata. Canonical queries require the Earthora tenant and exact current active catalogue membership. Indexed passages retain document/chunk provenance and must be public, indexed, effective and within the tenant.

The general chat retriever, database content, catalogue, frontend and mutation-tool contracts were unchanged. Canonical record text is not truncated. See [the native knowledge boundary](../../../apps/api/src/platform/channels/sunpathKnowledge.ts) and [route integration](../../../apps/api/src/platform/channels/sunpath.ts).

- Validation: API typecheck/build passed; **89 tests across 10 files passed** on Linux, including the seven new provenance regressions. The existing pricing fixture was mounted read-only for the test run.
- Activated at **17:50:19 UTC** on 20 September 2026, with zero active voice rooms. Only the API was recreated; voice worker, control, SFU and background worker were untouched.
- Image: `earthora-api:knowledge-625dc2a12bc8`.
- Source release: `/opt/earthora/releases/knowledge-api-625dc2a12bc8`.
- Readiness: HTTP 200. Authenticated native context verified all **nine canonical records**, complete text and provenance, and the unchanged current catalogue.
- Rollback: `/opt/earthora/backups/pre-knowledge-api-20260920T175016Z`; previous image `earthora-api:livekit-7e6c7675be30`. The backup contains the previous compose override and image reference.

The first activation automatically rolled back because the verifier compared PostgreSQL microsecond timestamps with JavaScript millisecond timestamps. A read-only candidate check confirmed that serialization precision caused the mismatch. The corrected verifier compares timestamps at JavaScript precision; the SQL effective-window check still uses database precision. No production facts were changed to pass verification.

## Remaining provenance limitation at review time

The Python compatibility fallback can still use a copied product passage when no eligible canonical record exists for that attribute. Consequently, expiring or revoking the last canonical dosage record does not by itself invalidate an older indexed copy of that dose. This was reproduced offline and reported to the runtime owner; this API deployment does not claim to close that fallback path. Contradictory currently effective canonical records remain visible rather than being discarded by choosing the largest version number.

## Source-bound speech wording

Real-model QA exposed a Gujarati usage answer with garbled wording despite
correct retrieved English facts. Simple Hindi/Gujarati ingredient and usage
answers now use reviewed translations tied to SHA-256 fingerprints of the
complete current English records. This is a translation cache, not a separate
catalogue or new approved medical source. Product, category, approval status,
effective dates, visible evidence and the exact source text must still match.
Changed, conflicting or missing source records cannot select a cached answer.

The usage rendering preserves the quantity range, frequency alternatives,
before-meal timing, water direction where present, product-label instruction
and health-condition/regular-medicine/uncertainty qualifications. Requests about
individual health, additives or multiple topics stay with the guarded workflow.
All generated and source-bound factual replies pass the normal speech guard.

Standalone language changes and policy questions receive brief direct answers.
Purchase intent stays separate from dosage; missing dispatch schedules remain
unconfirmed. The application retries an unsupported STT language once using the
same audio and conversation language, then asks for repetition without ending
the session. There is no hosted inference fallback.

Speech uses the same Neha voice on both transports, with local pitch-preserving
`atempo=1.20`. See [the synthetic pacing comparison](pacing/README.md). This
reduces clip duration by approximately 16.5%; it does not make GPU synthesis
streaming or establish subjective human naturalness.

## Conversation and media verification

The first deployed voice candidate for this follow-up was
`earthora-livekit-agent:sunpath-63da76e1c062`, with **424 Python tests passing**.
API, control and agent health checks passed, all had zero restart counts, and
activation waited until there were no active rooms. The rollback for this
candidate is `/opt/earthora/backups/pre-sunpath-20260920T181352Z`.

The [nine-turn conversation test](20260920-earthora-conversation-qa.json) passed
with the published knowledge intact. It exercises misheard company names,
language switches, Gujarati purchase intent and benefits, Hindi composition,
unconfirmed dispatch schedules, and medical/payment privacy policies. Business
state remained unchanged. The [four-case retrieval test](20260920-earthora-native-knowledge-qa.json)
withheld static knowledge only in its isolated probe and used actual authenticated
native read tools for English/Gujarati composition and directions; all four
passed on the preceding candidate with the same knowledge implementation.

[Six synthetic audio turns](20260920-synthetic-audio-analysis.json) then traversed
public WebRTC and the Smartflo WebSocket bridge on the deployed candidate. Each
transport recognized Hindi composition and the short Gujarati purchase phrase
`મારે આ લેવું છે`, and returned the correct response intent and language. English
`What is Earthora?` was heard as `What is Arthora?`; the application asked for
company-name confirmation. This is a successful clarification, **not evidence
that the full company-explanation answer was tested**.

| Language | Web first audible reply | Synthetic phone first audible reply |
|---|---:|---:|
| English | 2.713 s | 2.696 s |
| Hindi | 5.968 s | 7.220 s |
| Gujarati | 3.600 s | 4.122 s |

Timing starts at the last queued synthetic input sample. The English source
contains approximately 0.84 seconds of trailing quiet audio, so these are not
exact human-end-of-speech measurements. Text-to-audio includes synthesis,
pacing and transport. The Hindi example spent 4.058/5.886 seconds between reply
text and first audio, showing that the principal remaining delay was the speech
path, not the LLM (1.153/0.722 seconds from transcript to reply text).

The observed Hindi transcript used `प्रदक्ट`, which initially missed composition
selection and produced a longer answer. The final follow-up recognizes this
product-word variant and uses the same complete approved composition record.
It does not rewrite the recognized transcript or guess new product facts.

These checks use generated source audio and do not establish human pronunciation
ratings, microphone robustness or real PSTN carrier/handset quality. No real
phone number was dialled and no order, payment or callback was created.

## Final runtime and targeted audio recheck

Final voice image: `earthora-livekit-agent:sunpath-cc2904d546b5`, image ID
`sha256:f082b87b20970b4359432c038c42bd1b5e2c62b1150ecc97aff5019f59ec0d38`.
Its immutable source is `/opt/earthora/releases/sunpath-voice-cc2904d546b5`.
**474 Python tests passed** in the built image with its network disabled.
The sole warning is the pinned Python runtime's `audioop` deprecation notice.
Activation waited for zero active rooms; API/control/agent health passed.
Rollback: `/opt/earthora/backups/pre-sunpath-20260920T182522Z`.

This final candidate additionally recognizes the observed Hindi product-word
variants, excludes personal/family/child dosage requests from the generic fact
translation cache, and rejects model-generated individualized doses even when
their numbers match a general label. Simple such requests receive a brief
label-and-qualified-doctor response. General label questions and compound
business questions retain their normal paths. Negated hang-up requests no
longer terminate the session.

The same cached Hindi source WAV was [replayed through both public media paths](20260920-final-hindi-audio.json)
on this final image. Both returned exactly:
`हर टैबलेट में 500 मिलीग्राम Moringa Leaf है।`

| Measurement | Web | Synthetic phone |
|---|---:|---:|
| Last queued input sample → transcript | 0.644 s | 0.581 s |
| Transcript → reply text | 0.058 s | 0.061 s |
| Reply text → first audible reply | 2.944 s | 3.179 s |
| Total first audible reply | **3.646 s** | **3.821 s** |
| Earlier run with the longer reply | 5.968 s | 7.220 s |

These two observations improve the tested Hindi turn by 2.322/3.399 seconds;
they are not a general latency percentile or SLA. Completed-phrase TTS remains
the main latency limit. Speaking tempo and answer length are separately
controlled; faster playback does not make model generation stream.
The final recorded Hindi speech spans were 3.35 and 4.94 seconds for identical
reply text. Model-generated pacing still varies between calls even with the
same fixed tempo adjustment. Recordings, including their processing-silence
lead-in, are retained as [web audio](audio/web-1_hi-reply.wav) and
[synthetic phone audio](audio/phone-1_hi-reply.wav).

The [separate pre-final transport probe](20260920-synthetic-interruption.json) passed eight turns across web and phone,
including EN→GU→EN and actual barge-in. VAD-to-confirmed interruption was
456 ms (web) and 461 ms (phone); the phone clear event followed 1 ms later at
the observer. Both rooms were cleaned, the synthetic phone stream closed
cleanly, and zero pipeline errors or invalid phone frames were recorded.
Its source samples are transport fixtures, not a business-conversation quality
evaluation. No transport or interruption code changed in the final candidate.

## Sampling fix

A read-only audit of the installed GPU gateway found that OpenWebUI's OpenAI-to-Ollama converter copies the nested `options` object but does not map top-level `temperature` or `top_p`. CPU execution of that exact installed converter confirmed that a request with `temperature: 0` and `options: {num_ctx: 8192}` reaches the native payload without temperature. Adding `temperature: 0` inside `options` preserves it. No inference requests were made for this audit.

The inspected global defaults and exact Qwen model settings contained no sampling override. Middleware gives explicit request options precedence, later model defaults fill only missing keys, and the live Ollama guard preserves nested zero. The problem was a dropped request parameter, not the context-window setting overwriting it.

The Earthora request configuration now includes `options: {num_ctx: 8192, temperature: 0}` alongside the constructor's temperature setting. This confines the remedy to Earthora requests without changing shared gateway defaults. The dropped setting meant earlier requests were not reliably using the intended sampling configuration; final factual-answer QA remains a separate verification step.
