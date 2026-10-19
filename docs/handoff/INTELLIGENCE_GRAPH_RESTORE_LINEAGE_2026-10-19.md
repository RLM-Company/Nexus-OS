# Intelligence Graph — restore lineage and monotonic clocks

19 October 2026. Parent Draft PR373 `7c0bfc70ffa3261fe7aa80f430c0b4c573d6ae62`. Graph runtime remains OFF; no startup DDL, managed migrations, product activation, provider calls or deployment.

## Reproduced defect

Create A v1, revise it to A v2 with one text, restore the old graph snapshot, rename the graph, then revise A again with a different text. The previous implementation allocated v2 again, so one stable node/version identity could describe different content in different workspace revisions. Incident relation versions had the same issue. A regression failed before the fix with `expected 2 to be greater than 2`.

## Fix and compatibility

Each workspace now has optional internal `version_floor`. Newly created/imported workspaces start at 1. Restoring any saved revision preserves its exact node/edge contents and refs but reserves a new floor equal to the new workspace revision. Later node and relation edits allocate `max(previous_version + 1, version_floor)`.

The floor survives ordinary edits, including rename and conflict review, and is stored inside the existing immutable snapshot JSON. Node revision/tombstone allocation, incident relation rebinding, explicit endpoint revision, exact-quote attachment/retraction and non-incident citation retraction all use the same allocator. Stable IDs remain unchanged; version numbers may have gaps. This does not require a managed schema change.

For older draft snapshots without a floor, the first edit reserves `previous workspace revision + 1`. This also handles a legacy snapshot that was restored and then renamed. Workspace validation enforces that all allocated node/edge versions are safe positive integers at most the containing revision. Therefore the reserved range exceeds versions from all earlier workspace revisions, without scanning unbounded history. Existing immutable history is retained; the fix prevents future collisions and does not rewrite previously saved draft history.

Portable content does not include allocator metadata, so reviewed package hashes remain content-only. Import resets to a new graph and local floor 1. The complete owner privacy export includes and validates the actual saved allocator state.

## Time integrity

Create/import now validate even empty workspaces before persistence. Root dates must be canonical ISO UTC, real dates, and ordered; node/edge creation cannot follow the containing snapshot time. Restore rejects time rollback relative to the current graph before appending history or changing the library order. Floor, root revision and restored revision references are validated on mutations and in full privacy export.

## Verification

285 focused tests across 21 files pass on exact graph source. Added cases cover modern/legacy restore plus rename, repeated restores, all evidence/relation mutation paths, stable content per node/edge version across every saved revision, unchanged historical portable hash, floor survival across SQLite reopen, rollback with no write, malformed dates, invalid allocator state in complete privacy export, and the original regression.

Backend package/API builds, API/web/E2E TypeScript, scoped ESLint/Prettier, secrets/diff and complete production Next webpack build pass. Ten browser scenarios remain discovered/type-checked; execution without Chromium is unconfirmed. Hosted CI pass is not claimed; earlier graph PR runs terminate before any step with runner_id=0.
