# SunPath reference and adaptation map

This document records the implemented adaptation. The exact authorized source subset lives in `reference/sunpath/`; `SOURCE-SUNPATH.json` records its hashes. Deployment and validation evidence is recorded separately in `SUNPATH-DEPLOYMENT.md`.

The supplied `sunvoicebot.zip` contains two briefs and **no code**. The separately supplied `D:/MSH/sun/sunpath-voicebot` folder is the implementation reference. Its recorded owner changes supersede parts of the original brief; it must not be labelled as source extracted from that ZIP.

| Reference boundary | Preserve | Earthora/GPU adaptation and reason |
| --- | --- | --- |
| `agent/config.py` builders | Provider-neutral construction; provider errors/cancellation; low-temperature tool LLM | Self-hosted Whisper/IndicConformer, Indic Parler Neha and Qwen; no paid/external fallback |
| `agent/main.py` Agent/AgentSession | Native tool execution, scoped conversation, short responses, turn/session lifecycle | Use a compatible pinned SDK; supplied Sun source uses Agents 1.6.5 `turn_handling`, not Earthora's current 1.3.12 API |
| `agent/prompts/system_gu.md` | Operating-manual structure, source-only facts, one detail at a time, uncertainty clarification, promises require successful tools | Bind to Earthora's approved prompt and policies; never speak Sun's medical identity, contacts, addresses, catalogue or direct-sales-transfer rules as Earthora |
| `agent/tools.py` lookup/validation | Deterministic alias/exact lookup, ambiguity withholding, bounded spoken detail, truthful handoff results | Reuse Earthora's live catalogue/knowledge and business/checkout tools; no JSONL-only replacement of a real workflow |
| `agent/guard.py` | Reject invented prices and use only evidence actually available to the current turn | Wire a real gate before speech, consume retry/fallback results, scope evidence and failure counters; source currently only logs after conversation-item events |
| `agent/normalize.py` | Preserve exact meaning when preparing text for speech | Clean Markdown, links and list formatting while preserving decimals; do not apply the source's unconditional Gujarati number conversion to every language. Language-specific number verbalization is not implemented |
| Interruption/endpointing | Prompt interruption for actual caller speech; avoid false cancellation from noise | Batch GPU STT cannot satisfy Sun's live one-word threshold; test an explicit compatibility setting. Do not claim original streaming capability |
| Preemptive synthesis/hold speech | Conversation remains responsive; cancellation stops stale work | Completed Parler clips and a bounded GPU queue need controlled scheduling; preemptive synthesis is not automatically faster and must not delay recognition |
| TTS fallback | Audible, truthful failure handling | Do not keep Edge as an unnoticed second voice/provider; preserve Neha-only/self-hosted requirement through a compatible local failure path |
| Closing/silence/error handling | Clear ending, bounded session, no repeated retry loop | Await actual terminal speech and track tasks; source fixed 4–6-second sleeps can cut off slower GPU speech |
| Token server / dispatch | Fresh rooms, short-lived room-scoped tokens, explicit worker name, fail-closed access | Keep Earthora's authenticated channel boundaries and existing transport; Sun is browser-only and has no real PSTN handoff |
| Knowledge and provenance | Traceable approved factual source | Private Sun knowledge was excluded; Earthora data remains authoritative. Exact source evidence is preserved separately from adapted business code |

Known source gaps are not requested product behavior: post-hoc logging guard; accumulated lookup evidence; advisory classifier not used by runtime; missing multilingual provider/normalizer switching; escalation tool without durable capture; simulated leads presented as future callbacks; fixed-duration room deletion; unpinned dependencies/missing Silero; historical QA at 42/60 rather than green.

The source's language manual says both “mirror Hindi/English” and “stay in the established language for the rest of the call.” Earthora's selected language-switch policy must be stated explicitly and tested; these are not equivalent policies.

Safe subset verification: 15 files copied byte-identically and Python AST parsing passed. No private knowledge JSON, credentials, environment files, lead records, recordings, vendored dependencies or deployment files were copied. The subset is provenance evidence and is intentionally not independently runnable. Runtime validation uses synthetic audio, without dialing a real phone.
