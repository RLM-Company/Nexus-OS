# Data Workbench root integration — 10 October 2026

Integrated from `kosmora-incoming/round3/data` into the active `kosmora-integrated-v3` checkout. The supplied feature uses the original `studio-csv.ts` parser; no separate CSV parser or new dependency was introduced.

`StudioDataSurface` is wired through the root Files surface with `projectId` and `onCompose`. The default **Документы и текст** tab still renders the existing `StudioFiles` and its document library. **Таблицы и диаграммы** opens the new local Data Workbench. The root keys the surface by active project to discard the previous project's local table on a project change.

## Integrated behavior

- CSV/TSV UTF-8 input is checked in an actual Worker before the canonical parser allocates rows: 8,000,000 bytes, 80,000 data rows, 100 columns and 1,000,000 cells. Invalid UTF-8, malformed quotes, ambiguous delimiters and exceeded limits return explicit errors.
- All columns begin as text. Explicit numeric types accept decimal comma/dot and consistent space-separated thousands, preserve IDs as text, and reject unsafe integer magnitude. Filtering, stable sorting, aggregate statistics and bounded grouping use the complete filtered row set.
- Bar, line and scatter SVG charts use numeric X/Y. Lines are ordered by X. Charts show up to 600 points and disclose sampling; table preview shows 100 rows per page and group preview 40 groups. CSV/JSON exports retain the complete selection and fail explicitly above 32 MB.
- CSV exports protect headers and cells against formula injection, including whitespace and invisible Unicode prefixes. Indexed JSON metadata preserves duplicate headers. Local report and SVG downloads are available.
- Workspace JSON is explicitly saved/opened, capped at 16 MB, with versioned schema/table/settings validation. Tables are not stored in browser persistence. Cancellation terminates the Worker and aborts exporting; generation/request IDs reject stale results. Replacing a pending file with an unsupported or oversized file clears pending state and permits another load. Worker construction/posting errors also clear busy state.
- Chat preparation uses the existing `onCompose` contract. It attaches complete rows only, bounded by 8,000 characters and 24,000 UTF-8 bytes, and states total/included rows and truncation. It prepares a draft without submitting a model request.

## Validation

Pinned repository dependencies are installed locally. In Windows sandbox runs, Vitest's default temporary cache directory rejected a file rename; using task-local `TEMP` and `TMP` resolved it without escalation.

- Focused ESLint for all Data modules and `ui/primitives`: PASS.
- `pnpm exec vitest run src/app/studio-csv.test.ts src/app/studio-data-core.test.ts`: 17/17 PASS.
- `pnpm exec vitest run --config src/app/ui/primitives/vitest.config.mjs`: 3/3 PASS, covering host-owned actions, current-version restore hiding, deterministic dates, escaping and invalid counts.
- Actual Node `worker_threads` regression: the previous integration pass recorded 10/10 PASS using production TypeScript. This is separate from browser-worker acceptance.
- Browser acceptance: pending the root production build and local Chromium run. The Data spec asserts a native Worker event, downloaded CSV bytes/formula protection, workspace round-trip, bounded attachment transfer, cancellation/reopen and invalid replacement/recovery. Do not treat Node Worker checks as Chromium acceptance.
- Full application typecheck/build/lint are recorded by the root handoff. A focused semantic typecheck found no Data errors; errors observed in the concurrent Canvas work are outside this module.

## Primitive adoption

Only `VersionTimeline`/`VersionDiffBadge` are retained from the supplied original neutral primitives package. Local CSS, deterministic SSR/client dates, host-owned action callbacks and safe counts are implemented. No disconnected UI actions or navigation entry were added. Source attribution and the supplied MIT license are retained under `apps/web/src/app/ui/primitives`.

The earlier composer reference has unknown licensing in the existing UI handoff. This integration imports no third-party marketplace source or media and adds no marketplace dependencies. It preserves the source package's provenance rather than treating a marketplace label as a universal license.

## Scope

Data-owned changes are `studio-data-*`, its regression script/E2E, `ui/primitives` and this handoff. Root navigation integration is owned by the root maintainer. No Data API, DB migration, journal modification, paid provider call, external deployment or GitHub publication is part of this feature. UTF-8 CSV/TSV are supported; XLSX, date inference and OCR are outside its scope.
