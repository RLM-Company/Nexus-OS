# AI presentation creation through existing Work — 17 October 2026

Builds on the integrated table-history candidate #357 (`5955849`). The local
checkout is partial; publication must preserve the full remote base tree and
replace only explicit changed blobs. No deployment or main merge is included.

## Delivered behavior

- `/presentations` creates a text-only 3–8-slide task in an existing owned project.
  The server constructs the goal and forces Analyst + Critic, at most three model
  requests, and existing Work input/output ceilings. Project materials, memory,
  pinned Skills, canonical account/project reservations, policy gates, emergency
  stop, pause/cancel/restart behavior remain those of the durable Work executor.
- Accepted `output_contract` fixes the expected slide count in the saved request.
  Before Critic/publication a local check requires exactly one `presentation.json`,
  strict portable schema, unique IDs, exact count, title slide first and bounded
  fields matching the same PPTX text-box capacity used by the editor. An invalid
  deliverable fails explicitly, after the draft call, with no paid repair/retry.
- The panel displays saved tasks and their stage/control state. Only completed,
  published files with a PASS review can be previewed/imported. Preview shows all
  slides/notes, immutable file version/hash and recorded model sources. User review
  precedes an independent editable deck with newly assigned presentation/slide IDs.
- Source checks bind owner/project/work/artifact/version/hash and recompute actual
  UTF-8 bytes/SHA-256. Presentation-package parsing is now shared by API/browser;
  manual legacy imports remain accepted, generated results require the exact
  portable format. Literal text never runs HTML, commands or external resources.
- Import uses a durable per-owner immutable-artifact receipt. Lost responses return
  the existing deck, including later manual edits, without another model call or
  version. Receipt reads still work after source-project deletion. Deleting the
  imported presentation leaves a tombstone; replay returns 410 and cannot recreate
  it. Import limit: 1000 receipts/tombstones per owner, alongside the existing deck
  quota. Source metadata shown by the client is stripped down to a reference before
  the write; the server derives provenance from its own canonical records.
- Source provenance survives independent deck edits/restores and appears on the
  editor. Privacy export/delete includes receipts and tombstones. Additive migration
  `0048_presentation_work_imports` preserves old decks/versions, fences insertion,
  prevents source rewrites and owner mismatch, and cascades deck deletion to a
  tombstone instead of dropping idempotency evidence.

## Verification

The new API/DB/contract cases cover accepted immutable project context and request
limits, real coordinator plan/draft/Critic progression with canonical zero-price
fixture accounting, no provider call on repeated import, local refusal after two
calls for invalid slides, literal Unicode/HTML/CRLF, foreign/stale/unpublished/
corrupt/unreviewed sources, independent editable copies, source deletion, receipt
restart, deletion replay, privacy fencing and a 0047 migration/reopen rehearsal.

A local HTTP smoke uses the actual API/SQLite/coordinator with a synthetic mock
provider. It creates three slides in three Work requests, imports twice into the
same presentation, rereads durable provenance and exports the editable PPTX. The
file was independently checked with Python ZIP/XML readers: three slide parts,
three notes parts, exact Cyrillic, literal formula text and escaped speaker notes.
It does not establish live-model quality or monetary prices.

One real-server Playwright scenario was added for generation, full preview review,
lost accepted import response, no duplicate, reload and exact PPTX text/notes.
Discovery and type checking pass. Browser execution remains unconfirmed: Chromium
is absent; its standard download repeatedly yields a truncated/non-ZIP archive.
No hosted CI, full-browser pass, live paid AI run or deployment is asserted.

The initial unconstrained combined test run encountered five existing five-second
timeouts while builds/type checks ran concurrently. Test parallelism was bounded;
no production timing or existing test timeouts were changed. A missing import in
one new capacity test was corrected and the complete feature suite was rerun.
Final verification counts and publication/tree evidence are recorded below.

## Boundaries

This creates editable text slides and speaker notes. It does not generate images,
charts, video, import PPTX or autonomously browse external links. A Critic PASS is
content review, not factual verification. The configured provider/registry must
support the existing Work roles and budgets; credentials alone are not readiness.
The default mock route is visibly labelled and may return a non-presentation
fixture, which is refused rather than presented as a generated deck.

## Final verification

- API/package run: 861 passed, two existing five-second timeouts, four skipped
  across 131 files. Both affected files (`demo-manager-api` and `account-activity`)
  passed all three cases when replayed with one worker, with no code/timeout change.
  This verifies 863 distinct backend cases; it is not a claim of a single entirely
  green monolithic run. All 12 new feature cases passed together after final edits.
- Web: all 99 cases passed in 22 files with the actual web Vite/JSX configuration;
  total verified backend + web cases: 962. Data worker regressions: 10/10 separately.
- API/web/selected browser-scenario TypeScript, scoped ESLint including app.ts,
  changed-file Prettier, secret scan and git diff checks passed.
- Contracts, DB, API and dependent runtime packages compiled successfully. Next
  webpack production build passed all 19 routes. The compiled API with normal
  default package exports also passed the same three-slide HTTP smoke, using a
  synthetic provider installed only by a temporary fixture entry point.
- Independent ZIP/XML checks of its PPTX passed: 11,813 bytes, three slides and
  three notes parts, exact Cyrillic/formula/escaped note content. No browser visual
  quality or real-model factual quality is inferred from that check.

The remote base document differed from the local partial checkout. Its current
contents were read by commit SHA and preserved before appending the new contract.
All other touched tracked files matched their remote base blob SHA before editing.
