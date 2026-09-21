# Voice concierge API verification — 21 September 2026

This records the API-only rollout at **04:06:18 UTC** and the verified final
browser-bundle revision at **04:18:12 UTC**. It does not assert activation of
subsequent Python changes.

## Release and scope

- Source release: `/opt/earthora/releases/concierge-api-46720cc4d818`
- Image tag: `earthora-api:concierge-46720cc4d818`
- Image ID: `sha256:f008f2ceb17ae6c41c17c8affa986dde5bd9c57baad43b9cfb9288542f68efa4`
- Source archive SHA256: `46720cc4d8180630feecc25dc28233691970fb7b003055a9838ab9406753c530`
- Previous API: `earthora-api:knowledge-625dc2a12bc8`
- Backup: `/opt/earthora/backups/pre-concierge-api-20260921T040612Z`

Zero active voice rooms were verified before recreating the API. Migration
`apps/api/src/db/migrations/0003_voice_requests.sql` was applied once. It adds
voice request drafts and their confirmation state; no existing product or
knowledge records were rewritten. The worker, voice worker, control service and
SFU were not recreated by this API rollout. Nine approved canonical product
knowledge records and the exact 500 mg ingredient source remained available.

## Request and navigation contracts

`siteGuide.ts` supplies a public, finite destination manifest at
`GET /api/platform/voice/site-guide`. The deployed manifest contained 13 static
destinations plus one active product. It includes the contact form anchor and
excludes the cart because the website and voice carts are separate. Native
`navigate_site` is available on web only; the browser must acknowledge a page
change before the Python worker can report it as successful.

`voiceConcierge.ts` implements `start_request`, `set_request_field`,
`review_request` and `submit_request`. Contact enquiries require name, email and
message, with optional phone, topic and explicit marketing consent. Callbacks
require name, phone and purpose. Marketing defaults to false. Context retains
active and recently submitted drafts so later turns can resume honestly.

Submission requires the current review token, an unexpired review, and a new
persisted visitor turn containing an explicit EN/HI/GU confirmation. Editing a
field invalidates the review. Conversation and draft locks serialize edits and
submissions across processes. A successful transaction writes the existing
`Contact_details` or `escalations` record, a uniquely keyed existing notification
job, and the durable submission result together. Repeated submission returns
the same result. Legacy `capture_callback` is hidden and blocked in the native
voice route; other consumers of the shared callback function are unchanged.

The existing team notification pipeline remains Resend via `contact_email` or
`escalation_notify`. Provider configuration, sender and team recipient were
present in API/worker configuration. The recipient matched the published
Earthora contact address. A successful tool means **recorded and notification
queued**; it does not prove delivery or promise a response time. The existing
worker's retry and delivery semantics are unchanged. Newsletter, restock,
orders, payments and reviews are not submitted by these request tools.

## Verification performed

- API typecheck, build and **113 tests across 12 suites** passed in the staged
  image. Tests include input validation, explicit confirmation/correction,
  review expiry/invalidation, native callback bypass prevention and channel
  restrictions.
- `apps/api/scripts/check-voice-requests.mjs` passed against real PostgreSQL in
  its own generated `voice_req_test_*` schema. Its database search path excludes
  public tables. It applies the actual migration and calls the actual request
  service, with no worker consuming that schema and network delivery disabled.
- That isolated check proved both outbox types, concurrent/repeated submission
  deduplication, cross-conversation denial, same-turn and correction rejection,
  marketing default false, and transaction rollback when an outbox insert
  deliberately fails. It dropped its generated schema afterwards.
- Production readiness returned HTTP 200. Authenticated native context and
  tool checks confirmed the new web tools, phone navigation exclusion, legacy
  callback denial and preserved canonical knowledge.
- Independent public TLS checks from the owned GPU host returned HTTP 200 for
  the site guide, widget and voice client. The public JavaScript hashes matched
  the staged candidate.

The isolated check sent **zero notifications** and created **zero public test
leads**. No live customer contact, real PSTN call, purchase or payment was made
for this API acceptance. Real delivery is consequently not asserted.

## Public artifact snapshot and rollback

Deployed at this snapshot:

| Artifact | SHA256 |
| --- | --- |
| `widget.js` | `1df3c5ce585c075ed158e12b5901454cc87d818c488336ec1341ae7320b860c7` |
| `voice-client.js` | `cafca30ef5add245d43e36a974674e9b0509d131cfbb27584a7d434f62ab70d5` |

A later browser manifest-timeout fix passed 22 browser tests and produced a
new voice-client bundle. Its activation is recorded below. Native Qwen
request/navigation behavior and audio acceptance are separate from the API
checks recorded here.

The backup contains the previous compose override, image IDs/tags and schema
snapshot. For API rollback, wait for active rooms to finish, restore the prior
API image/override, recreate only the API and verify readiness. Retain the new
draft table and submitted records; do not drop request data to roll back code.

## Final browser-bundle revision — 04:18:12 UTC

- Active API release: `/opt/earthora/releases/concierge-api-a10964a58102`
- Active image: `earthora-api:concierge-a10964a58102`
- Image ID: `sha256:793dc04aaabc8a0466829c22a55f71698c45a8347831fcc5256fef9fce0e56a2`
- Archive SHA256: `a10964a58102011c0021ac4a5834b3e11388d52dd4e9c4816e2216ed99c3b8c8`
- Rollback backup: `/opt/earthora/backups/pre-concierge-api-20260921T041808Z`
- Previous image: `earthora-api:concierge-46720cc4d818`
- Final `voice-client.js` SHA256: `92cb540ed468384bb843a2ed7dde562d8ff2398d143af971addad7cd40c8203e`
- `widget.js` is unchanged from the earlier hash.

The final candidate repeated all 113 API tests and the isolated PostgreSQL
proof successfully. Activation again verified zero active voice rooms,
readiness 200, native web/phone contracts, nine canonical knowledge records,
the blocked legacy callback route and exactly one applied migration 0003.
Only the API was recreated. Independent public HTTPS checks then verified the
14-destination manifest and matching final JavaScript hashes. Test notifications
and public test leads remained zero.

The browser fix bounds manifest loading and checks the deadline before any
navigation side effect. It prevents a delayed manifest from moving the page
after the voice worker has already timed out the action.
