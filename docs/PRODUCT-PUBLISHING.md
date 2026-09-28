# Product publishing: local development and the live website

The live Earthora website reads its catalogue from the owned API and PostgreSQL
at runtime. Product creation, edits, prices, stock and images are data changes;
they do not require a website build, a deployment, or a developer command.

## Live product administration

Open `https://www.earthorafarms.com/sun-earthora/products`, sign in with the
authorised staff account, and create or edit the product there. A successful
**Product published** message means its image uploads and stock were saved and
the product is now active. The same browser refreshes its catalogue immediately;
other open storefronts refresh within 30 seconds while visible, and on returning
to the tab or reconnecting. A new catalogue request reads current database data.

If an image or stock save fails, the form stays open with the entered details.
Retry in that form after correcting the error. A new product stays unpublished
until the final save succeeds; local `blob:` preview URLs are never published.
Edits use the existing product UUID, so renaming a product does not change its
upload identity. Product knowledge approval remains a separate action.

The voice assistant's catalogue and product tools already read this same live
database. Publishing a product does not require restarting the GPU models or
Voice Studio, and does not automatically approve medical/product knowledge.

## Voice knowledge audit, 28 September 2026

The owner reported that the voice assistant's knowledge base looked static and
that it did not pick up newly added products. The audit found:

- **There is no WooCommerce integration anywhere.** `earthorafarms.com` is this
  repository's storefront; products live only in the owned PostgreSQL `products`
  table and are administered at `/sun-earthora/products`. The voice assistant's
  catalogue (`list_products`, `get_product_details`) and its approved product
  facts (`product_knowledge`, status `approved`) are read live from that database
  on every turn, so a product published in the admin is visible to the assistant
  immediately and its approved facts are usable as soon as they are approved.
- **The indexed knowledge documents were static.** The product document used by
  keyword search (`kb_documents`, one per active product, built from the
  description, highlights and approved facts) was only rebuilt by the manual
  "index website" job, last run on 15 September. Product, stock and knowledge
  changes never refreshed it. The worker now runs a `kb_sync_products` job:
  every admin write to `products` or `inventory` and every knowledge
  create/update/status/delete enqueues one (at most one per minute), and a
  schedule runs it every ten minutes as a safety net. Unchanged documents are
  skipped by content hash; documents of products that are no longer active are
  archived and restored when the product is re-activated. Deployed as
  `earthora-api:kb-sync20260928a` for both the API and the worker
  (`infra/vps/activate_kb_sync.py`; evidence in `docs/verification/kb-sync-*.json`).
- **Why "what products do you have?" failed in a real call.** The runtime's
  exact-match catalogue answer only understood a few phrasings; the model's
  attempt was then rejected by the grounding guard. The Voice Studio runtime
  (release `voice-studio-flows-20260928f`) now answers the common phrasings
  ("may I know what all products are there", "which products are available",
  Hindi and Gujarati equivalents) directly from the live catalogue.
- **Data to correct in the admin (not code):** the one active product is listed
  at ₹1.00 against an MRP of ₹999 and the assistant quotes that price; its slug
  is `cheese`, which is also its storefront URL and knowledge document id; one
  knowledge entry (dosage) is still a draft. Five archived test products
  (Alpha, beta, gamma, Product X, Moringa Capsules) are ignored by the assistant.
- **Embedding cost.** Knowledge indexing embeds changed documents with the
  configured OpenAI embedding model; the voice search path itself uses keyword
  matching only. A sync of unchanged documents makes no embedding calls.

### Follow-up the same day: automatic sync, page copy and the data corrections

- **Data corrected (owner's request).** Price set to ₹999.00 (equal to the MRP;
  lower it in the admin if a selling price below MRP is intended), slug changed
  from `cheese` to `morilife-moringa-leaf-tablets` (storefront links use the
  product UUID and keep working; the old knowledge document was removed by the
  next sync and a new one created), and the draft dosage entry approved. Row
  backup before the change: `/opt/earthora/backups/data-fix-1790595659`.
- **Automatic sync is now a console option.** The Knowledgebase page has an
  "Automatic sync" panel: on/off, the product-and-facts interval (default 10
  minutes), the website-page interval (default 6 hours), an optional live-site
  crawl (off by default, because this app renders in the browser and a crawl
  finds almost nothing), a "Sync now" button and the last successful run of each
  sync. Settings live in `admin_settings` under `kb_auto_sync`; the worker checks
  them every minute (`kb_auto_sync` schedule) and queues only what is due and not
  already queued. Every product, stock or knowledge change in the console still
  queues a product sync immediately.
- **Website pages follow every deployment.** The API build extracts the readable
  copy of the FAQ, Our Story, Health Benefits, Shipping, Privacy, Terms and
  Contact pages from the storefront source (`apps/api/src/platform/kb/pageCopy.ts`,
  `dist/kb/pages.json`) and the worker indexes it as `page:/faq` and so on; pages
  that disappear from the list are removed. The five manually pasted copies of
  those pages (15 September) were backed up to
  `/opt/earthora/backups/kb-manual-docs-*` and removed as duplicates; the
  manual "Payments and Orders" note was kept.
- **Content conflict to resolve (website vs approved label).** The website FAQ
  and the "Payments and Orders" note say "2 tablets before or after lunch and 2
  before or after dinner daily"; the approved product label says "1–2 tablets
  once or twice daily, before breakfast or dinner". The voice assistant keeps
  such disagreements visible and answers dosage questions with "the product
  information conflicts" until one of them is corrected. The FAQ also still
  describes a moringa powder that is not in the catalogue.
- Deployed as `earthora-api:kb-sync20260928b` (API and worker,
  `docs/verification/kb-sync20260928b-*.json`) and the rebuilt console
  (`docs/verification/console-deploy-kbsync20260928.json`; previous build kept
  at `/opt/earthora/www/console-backup-*`).

## Running the received code locally

The Vite frontend and API are separate development processes. A copied source
folder is not a running backend. With Node 22+, dependencies and an isolated local
PostgreSQL/environment configured, use two terminals in the repository root:

```powershell
npm ci
npm run dev:api
```

```powershell
npm run dev:store
```

The storefront normally opens on `http://localhost:5173`. Vite proxies `/api` and
`/media` to the local API on port 4100. API configuration is read from the API
workspace environment (`apps/api/.env` for local development); use
`infra/vps/api.env.example` as the list of required settings. Use local database
and storage values for development. Do not put server secrets in `VITE_` variables.

The development processes run only while those terminals are running. They are
not how the production website is hosted.

## Production and code updates

Production uses the existing Earthora VPS: nginx serves the built storefront and
proxies `/api` to the continuously running `earthora-api` service. PostgreSQL and
uploaded assets use persistent storage. The deployed services, restart policy and
volumes are defined under `infra/vps/`; current live image tags should be inspected
before a release rather than copying an old tag from a reference document.

Changes to application code require the normal test/build/deployment process.
Changes made through the live product admin are saved in PostgreSQL immediately
and survive code deployments. Do not replace the database or asset volumes when
updating frontend/API code. Local test products do not appear in production;
create real products through the live admin connected to the production API.

## September 2026 fixes and evidence

The code audit found an image-save bug (slug-based upload before UUID creation)
and missing storefront cache refresh after admin writes. These were concrete
defects; they are separate from the developer's question about starting a local
API versus hosting it in production. No report of a missing live product was
proven solely by this audit.

Regression coverage exercises staged create/publish, UUID-based edits, durable
image URLs, failed-upload retry without duplicate insertion, stock-save failure,
cross-tab invalidation, 30-second visible-page refresh, focus/reconnect refresh,
and unchanged legacy upload persistence. No production product data is generated
by these tests.

The required legacy schema suite initially had three pre-existing harness errors:
the knowledge test removed only the first import, leaving the CORS import to emit
CommonJS `exports`/`require` in a script-only VM. Its harness now loads CommonJS
modules explicitly, using the real CORS helper and the existing mocked database
SDK. Production knowledge code and the original assertions are unchanged. All
six legacy knowledge/WhatsApp schema tests pass, including a disallowed-origin
assertion added to guard the real CORS boundary.

## Deployed release: 24 September 2026

The update is live on both `www.earthorafarms.com` and the previous temporary
Earthora hostname. The release also corrects the admin gateway's PostgreSQL
encoding for product text-array fields; a live schema check confirmed these are
`text[]`, while images remain JSONB. Read-only round trips with the production
driver verified empty arrays and Gujarati/quoted text. Product writes are
covered by regression tests without creating a public test product.

- API: `earthora-api:product-publishing20260924a`, extending the exact current
  image with only admin routes, admin gateway and store routes.
- Storefront: `/opt/earthora/releases/product-publishing20260924a/storefront`.
- Checks: 159 API tests, 33 storefront tests, six legacy integration tests,
  typechecks and builds passed. Both HTTPS domains return the new frontend and
  `Cache-Control: no-store` on the catalogue. The existing widget remains available.
- Voice admissions were briefly gated with zero active calls. Admissions were
  restored and verified. Worker, voice and database containers were unchanged.
- No product, price, stock, customer or order records were changed by deployment.
- Activation backup: `/opt/earthora/backups/product-publishing-1790231040`.

The API and storefront checks and exact image hashes are recorded in
`docs/verification/product-publishing-*-20260924.json`. Old content-hashed assets
remain available for visitors with already-open tabs. Staff should refresh an
admin tab that was open before this one-time software update.

Current save operations use separate requests for stock and the final product
update. If the final request fails after stock saves, the form retains its details
for retry; the operation is not a single database transaction. New products stay
unpublished until their final save succeeds.

Final schema review also confirmed that `products.highlights`, `health_benefits`
and `certifications` are PostgreSQL `text[]`, while images/FAQ/SEO are JSONB.
The admin gateway now encodes only those three text-array columns with the
driver's explicit text-array type (OID 1009). This prevents product saves from
sending JSONB to a text-array column, including empty arrays. A fresh-connection,
read-only production-driver `SELECT` verified Unicode and empty-array encoding;
no product data was changed by that check.
