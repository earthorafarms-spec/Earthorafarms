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
