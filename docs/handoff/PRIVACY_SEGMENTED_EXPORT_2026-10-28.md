# Segmented owner export — adapted Gemini delivery, 28 October 2026

Provenance: [preserved delivery](https://github.com/RLM-Company/Nexus-OS/tree/google/windows-privacy-acceptance-20261028/google-delivery-20261028)
at `c27b5421e7282320d6a7212a07a4b8734ab397e8`, specifically its
`privacy-segmented-acceptance` directory. The sibling Windows delivery is already
adapted in PR405 and is not reapplied. This implementation is based on current
main after PR408, not the old replacement copies in the delivery.

## Delivered API

- `GET /api/v1/personal-settings/export/segments?max_segment_bytes=...` returns a
  complete owner-scoped metadata plan, SHA-256 plan digest, counts and part URLs.
- `GET /api/v1/personal-settings/export/segments/:segment` requires `plan_digest`.
  Use the exact part URL, including the plan's size limit. The result is a ZIP with
  `segment-manifest.json` and that part's independently verified originals.
- Both endpoints use the existing authenticated identity, private/no-store/nosniff
  response policy, durable owner fence and real adapter drain/resume lifecycle.
  Query parameters do not select an owner. A different owner's plan digest fails.

Default part limit: 10 MiB; accepted limits: 4 KiB..20 MiB. The planner checks the
complete ZIP envelope, manifest, filenames, descriptors and binary bodies rather
than just payload sizes. Its advertised upper bound is at least the actual ZIP
size. A single record or original that cannot fit is refused with an explicit
incomplete-export error; it is never silently omitted or emitted above the cap.

The segmented snapshot has a 160 MiB metadata-plus-original safety bound, at most
4,096 parts and 1,000,000 records/original descriptors. There is no on-disk export
cache, background upload or external destination. Current owner-scoped individual
binary downloads remain available separately for oversized originals.

Ordinary export limits stay unchanged. Canvas's ordinary collector retains its
12 MiB/10,000-revision limit, while the explicit segmented collector enumerates up
to 160 MiB/100,000 revisions before reporting a hard limit. The current required
adapter manifest, specialized adapters, canonical accounting and Work/Code recovery
fields are retained; no stale store/server replacements are copied.

## Consistency boundary

Each download recollects a fenced snapshot and verifies the whole plan digest
before delivering its part. The digest binds owner, records, descriptors, retained
categories and part size, and excludes the export timestamp. Original metadata,
length and SHA-256 are checked again while reading the actual binary stream.
Corruption never produces a partial ZIP response. A changed dataset returns a
plan-mismatch conflict; regenerate the plan instead of mixing old and new parts.

The plan is a content fingerprint, not a permanent immutable stored snapshot.
The existing privacy quiesce may interrupt active Work/provider tasks; it does not
replay them. An interrupted task's terminal reconciliation can change its exported
state after the first snapshot, requiring a fresh plan once the owner is idle.

Snapshot cleanup now waits for all adapter drains even if one fails, so the owner
fence cannot be released while another drain remains in flight. The incoming
startup routine that indiscriminately cleared old quiescing/work fences is not
activated. Crash/deletion error states still require the existing explicit recovery.

## Verification

Real Fastify/bearer sessions for two owners, real SQLite and ZIP reconstruction
cover every fixture row/original, actual part sizes, anonymous access, foreign
digest reuse, query-owner injection, stale plans, mandatory digests, oversized
rows and binary-plus-ZIP overhead, corruption and empty collections. A real Canvas
history over the ordinary 12 MiB limit exports every revision through segmentation.
A held drain plus a failing adapter proves cleanup waits before releasing the fence.

Existing Work/Code, Canvas and graph privacy tests are run alongside the new cases.
The older compiled privacy fixture is updated to apply the canonical current
journal and retain every required adapter, rather than assembling obsolete slots
0..24 plus 30. Its ten tests and the real-SQLite export/delete smoke are now in
`pnpm test:privacy`, after production builds in the full quality gate. The smoke's
source-emission list includes the current modules and all required adapters.
Exact final CI results are reported in the PR. These are deterministic fixtures,
not production owner export/delete operations. No user data is deleted in this work.

No UI, sidebar, logo, CSS, Windows, migration, provider setting, paid request or VPS
activation is included. The future segmented download interface is on the visual
waitlist. The separate media handoff text on Drive has no media implementation in
the linked Windows/privacy delivery directory; it is not certified as delivered.
