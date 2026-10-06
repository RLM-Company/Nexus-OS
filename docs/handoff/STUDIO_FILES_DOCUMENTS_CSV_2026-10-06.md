# Studio Files — documents and CSV handoff — 2026-10-06

## Acceptance behavior

## v3 regression fix

`parseCsv()` no longer computes column width with `Math.max(...parsed.map(...))`. Width is determined by a linear row scan with the existing 250-column failure bound checked during that scan. This removes the reproducible call-stack failure on very large row arrays without changing filter-aware numeric statistics, serialization coverage, or any truncation policy.

- CSV is parsed locally with delimiter detection for comma/semicolon/tab/pipe, BOM support, escaped quotes and quoted multiline fields. The first record is the header; interior empty records are preserved instead of silently removed. Malformed quotes fail visibly, and files with more than 250 columns fail visibly.
- CSV view provides a bounded 200-row preview, selectable columns, Unicode NFKC/case-insensitive local filtering across selected columns, record and empty-cell counts, and filter-aware numeric statistics.
- Numeric statistics inspect at most 100,000 rows from the current filter and visibly report scanned rows, empty values and non-numeric values. Decimal comma and decimal point are accepted; ambiguous thousands/decimal combinations are not guessed. Min/max/mean are shown only for parsed finite numbers.
- Preparing CSV for chat serializes at most 7,000 characters from the current filtered row set and selected columns. Oversized headers or a first oversized selected row fail visibly instead of being silently truncated. The prompt states exact included/current-filter/source row coverage and warns that the sample is not the full dataset. This prepares the ordinary chat only; it does not send it.
- Document search performs Unicode NFKC + locale lowercase matching over the complete extracted text, so a match may cross Studio part boundaries. Cross-boundary results identify both parts, the visible overlap is highlighted, and the active match receives a distinct marker so next/previous navigation scrolls to the requested match rather than the first mark in the part. Markdown heading navigation remains available.
- Multiple document parts can be selected. Chat preparation is bounded to 7,000 characters and reports which selected parts actually fit. It never claims unread parts were analyzed.
- Studio input is read through `File.stream()` with byte progress and AbortSignal checks. PDF extraction then reports page progress. Replacing/cancelling a read increments an operation generation and aborts the prior controller; late progress/results/errors cannot replace the newer operation.
- Existing bounds remain: 20 MB input, 2,000,000 extracted UTF-16 code units, PDF 500 pages / 60 s, DOCX document XML 8 MB. No silent truncation is introduced.
- Integration additionally rejects CSV tables that would exceed 2,000,000 cells after padding short records. This prevents a small ragged input from expanding into a huge allocation; it produces an explicit error and preserves the no-truncation policy.

## Files

- `apps/web/src/app/studio-files.tsx`
- `apps/web/src/app/studio-files.module.css`
- `apps/web/src/app/studio-csv.ts` (new)
- `apps/web/src/app/decode-chat-attachment.ts`
- `apps/web/e2e/studio-files.spec.ts`
- `DEPENDENCIES.md` (new)

## Meaningful fixtures added

The Playwright file now covers quoted multiline CSV, escaped quotes, filtering and bounded draft preparation; a regression fixture with 200,000 short CSV records inside the 2,000,000-character bound; Unicode search spanning a part boundary; preservation of an empty CSV record; malformed quoted CSV rejection; numeric coverage reporting; replacement of a pending oversized read without stale document/error restoration; and moving the active highlight between multiple matches in the same part.

## Verification actually executed in the artifact environment

- Standalone strict parser check: `tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module ESNext --lib ES2022,DOM apps/web/src/app/studio-csv.ts` — PASS.
- `studio-csv.ts` compiled to CommonJS and executed with Node assertions for BOM, CRLF, semicolon detection, multiline quoted fields, escaped quotes, preserved empty record, empty-cell count, bounded/filter-aware numeric stats, malformed quote rejection, oversized-header/row refusal and 7,000-character serialization bound — PASS.
- Regression stress fixture generated 200,000 short records (well below the 2,000,000-character limit) and parsed them without `RangeError`; width remained 2 columns and all 200,000 data rows were preserved — PASS.
- TypeScript `transpileModule` syntax diagnostics for `studio-csv.ts`, `studio-files.tsx`, `decode-chat-attachment.ts` and `studio-files.spec.ts` — PASS.
- `git diff --check` on the generated v3 tree — PASS.
- `git apply --check` for the generated v3 patch against a second clean extraction of the supplied `fc6a391a3f0b4d79d608d9ecbfb64d799a566a37` archive — PASS.

Full workspace `pnpm` typecheck/lint/Playwright was not run in this artifact environment because `pnpm`/installed workspace dependencies are absent. Do not treat the syntax checks above as a substitute for repository integration checks.

## Integrator checks

Run from the repository root with lockfile-pinned dependencies installed:

- `pnpm --filter @cosmora/web typecheck`
- `pnpm --filter @cosmora/web lint`
- `pnpm --filter @cosmora/web test:e2e -- studio-files.spec.ts`

No paid AI calls are needed; the E2E fixtures keep preparation local and existing tests assert no model POST occurs during preparation.
