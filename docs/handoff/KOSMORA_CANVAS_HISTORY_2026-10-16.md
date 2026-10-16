# Canvas history, reviewed conflicts and local files — 16 October 2026

Stacked on PR #352 (`556177126abc2249356209ceadc5ba0a828a1ca5`). Work graphs, Skills,
accounting, model routes and Windows sources are inherited unchanged from the remote base tree.

## Product changes

- Literal local line comparison between saved revisions or a saved revision and draft snapshot.
  Repeated lines are deterministic; whitespace, BOM and CR/LF are never normalized. Counts and
  line numbers refer to the complete diff; unchanged ranges fold with explicit counts. Title and
  format changes are separate metadata. Exact equality bypasses the expensive calculation.
- Explicit restore review reads the current server revision and selected historical revision.
  Confirmation submits that reviewed base version to the existing immutable restore/CAS path.
  A concurrent writer rejects the mutation. Dirty drafts cannot be discarded by restore.
- Conflict replacement requires comparison against the fetched server revision, remains pinned
  to that version and becomes disabled when the draft text/title/format changes. A new conflict
  clears the obsolete review and preserves the draft. No auto merge or mutation retry.
- Exact historical download with scope checks, original revision title/format, verified SHA-256,
  no-store/plain-text attachment/CSP and version/hash headers. Comparison snapshots can also be
  downloaded locally. Ordinary editor download continues to export current unsaved text.
- Local UTF-8 file opening creates a draft only. The actual decoded bytes, BOM and CR/LF are
  preserved; invalid encoding, binary controls, extensions and size are checked. Existing dirty
  drafts and a separately stored new draft must be saved first. No automatic server or model call.

## Resource and authority boundaries

Comparison bounds: 256 KiB total UTF-8 input, 4,000 total lines and 500,000 matrix cells after
common prefix/suffix trimming. A bounded failure reports that no complete diff is shown, with
full before/after downloads available. The matrix uses at most 1 MB; content is always rendered
as escaped React text. Local files retain the existing 512 KiB content and 240-byte title bounds.
All Canvas network operations now have a 15-second timeout combined with the owner/project
lifecycle abort signal. No new migrations, permissions, model calls or billing paths.

## Verification

- Full API/package suite: **833 passed, four skipped**, 126 files.
- Web unit suite: **85 passed**, 19 files; Data Workbench worker regression: **10/10**.
- API/web TypeScript, dedicated Canvas e2e TypeScript, scoped ESLint/Prettier, secret scan and
  whitespace checks passed. API production build and Next webpack build passed (19 routes).
- New tests verify exact historical byte downloads, checksums, original names/formats, scope
  refusal and corruption rejection; diff reconstruction and deterministic repeated-line edits,
  whitespace/endings, independent bounds, folded context, inert rendering and strict file decoding.
- Six Canvas Playwright cases discovered, including three new cases. They cover reviewed stale
  restore, a third writer during conflict review, changed drafts, version comparisons, historical
  downloads, mobile width, file opening without persistence and protected local drafts.
- Browser execution remains unconfirmed: the expected Chromium executable is absent. No browser
  pass, visual acceptance or hosted CI success is claimed.

The local checkout contains the executable application/package subset. Publishing uses the full
remote base tree and only changed entries, preserving files absent from the checkout. User guide:
`docs/CANVAS.md`. No merge or deployment.
