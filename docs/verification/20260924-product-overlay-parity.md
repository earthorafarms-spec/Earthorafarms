# Product publishing deployment parity audit — 24 September 2026

This audit performed read-only production inspections over pinned SSH. It did not
write production data, change services, place calls, or run model inference. The
companion JSON contains hashes and sanitized observations, without credentials,
customer rows, or nginx proxy URLs.

## API overlay

Production runs `earthora-api:voice-actions20260922c`, image ID
`sha256:be96313e4c57bcaed7dd05ccd69989049e539ba10b08facd2a41ff0c02d65bb5`.
Its recorded release overlays `platform/channels/sunpath.js` on the prior API
image. Reuse this exact current image as the base so those channel fixes remain.

The three existing compiled files below match TypeScript transpilation of local
committed HEAD `474aa66592963195ffc6920090ebd75bd25c4a2a` exactly after line-ending
and sourceMappingURL normalization:

- `/app/apps/api/dist/modules/admin/routes.js`
- `/app/apps/api/dist/modules/admin/gateway.js`
- `/app/apps/api/dist/modules/store/routes.js`

Copy the newly built versions of these three files and their corresponding
`.js.map` files into the candidate image. The fixes add no API runtime imports or
package dependencies. Do not replace the full production `dist`, public assets,
or migrations as part of this narrow overlay.

Root and API `package.json` match production. The production lock has 484 shared
entries, all with matching versions and dependency metadata. The local lock has
211 additional frontend/console entries; that explains its different file hash.
The remote `/opt/earthora/src-repo` is an old `a062af6` checkout, missing 29 modern
API source files with another 14 differing files. It is not a valid rebuild source.

The API has `unless-stopped` restart policy, zero restarts, a localhost-only 4100
binding, and a successful HTTP 200 `/healthz` response. Docker has no configured
HEALTHCHECK. Preserve the existing assets bind mount and unrelated worker, voice,
and database containers. Persist the candidate tag in the compose override and
recreate only the API after the normal voice admission drain.

## Actual schema and inventory upsert

Production PostgreSQL schema confirms:

| Product columns | Actual type |
| --- | --- |
| `highlights`, `health_benefits`, `certifications` | `text[]` |
| `images`, `faqs`, `seo` | `jsonb` |

The old gateway serializes every array as JSONB. The separate gateway fix must be
included and tested before deployment; route changes alone cannot fix saving
product highlights.

`inventory.product_id` is a non-null UUID with a unique constraint and a foreign
key to `products(id)`. Therefore the new gateway request using
`onConflict: product_id` has a valid conflict arbiter. Supplying `product_id` and
`total_stock` is sufficient for an insert: `id` defaults to `gen_random_uuid()`,
`reserved_stock` to 0, and `low_stock_threshold` to 15. Stock has a non-negative
integer check. On conflict, only the supplied `total_stock` is updated, preserving
the existing row ID, reservations, threshold, and alert metadata. This is schema
and query-path verification, not a production mutation test.

## Storefront feature retention

The active old page loads `/assets/index-Q10XVkAm.js`; the candidate build loads
`/assets/index-CxCJplW2.js`. Both have 39 reachable JavaScript chunks. The old
release also retains obsolete hashed chunks, so feature checks used the actual
entrypoint dependency graph rather than searching all files indiscriminately.

Both active build graphs contain every checked contract marker for:

- deferred assistant widget loading through `/widget.js`;
- persistent page/section navigation, cancellation, form protection, and timeouts;
- scrolling, voice cart synchronization, stock checks, and checkout handoff;
- compact voice controls and the mobile purchase-bar inset;
- current AI checkout and its visitor-controlled payment boundary;
- the legacy voice checkout route.

The nine critical local source files listed in the JSON—including the widget,
navigation/actions bridges, cart context, both checkout pages, and API widget/
voice scripts—remain unchanged from HEAD. `App.tsx` only adds the catalogue
freshness bridge; the voice providers, bridge placement, and routes remain.

Both nginx sites, `earthora-store` and `earthora-real-domain`, currently use
`/opt/earthora/releases/voice-actions-store20260922b`. Update both roots, and retain
old content-hashed assets for open tabs that may still lazy-load them. The new
activation script contains that asset-retention step.

This establishes static feature retention and the narrow overlay's source
baseline. The old storefront has neither source maps nor a build commit manifest,
so it does not establish full historical source provenance. Root's deployment
HTTP checks and browser interaction checks remain required; this audit does not
claim that a live call, payment, or product mutation was exercised.
