# Kosmora Studio XLSX import — integration handoff (2026-10-17)

Integration update (2026-10-20): the package below has now been integrated into PR #360. Actual repository types, the real fflate roundtrip, two browser scenarios and the table regression harness passed. Current acceptance and limitations are recorded in `KOSMORA_FEATURES_2026-10-20_RU.md`; the following describes the original delegated delivery.

**Base (GitHub verified):** `RLM-Company/Nexus-OS`, `codex/studio-excel-export-20261017`, SHA `1314280a429273ea3f46208c31847eb78efb9491` (PR #359). `apps/web/src/app/studio-data-worker.ts` base blob verified as `796dbb431494435723178c251d379cdbd408af84`.

## Apply

From a clean checkout of the exact base:

```sh
git apply --check kosmora-xlsx-import-full-1314280a.patch
git apply kosmora-xlsx-import-full-1314280a.patch
pnpm install --frozen-lockfile
pnpm --filter @cosmora/web typecheck
pnpm --filter @cosmora/web exec vitest run src/app/studio-data-xlsx-import.test.ts
pnpm --filter @cosmora/web exec playwright test e2e/studio-data-xlsx-import.spec.ts
```

Apply **either** the full patch **or** the feature patch followed by the integration patch. Never both. The standalone integration patch modifies only `apps/web/src/app/studio-data-workbench.tsx`. No migrations, global CSS, layout, navigation, provider, billing, or API contracts are changed. Original CSV/TSV, workspace JSON, editing/undo, project persistence, Excel export and `onCompose` remain in place.

The ZIP contains the full new parser, its Vitest test, the updated Worker source, the new E2E test, the exact-base unified patches and this handoff. The existing ~41 KB `studio-data-workbench.tsx` is intentionally supplied as a **targeted integration patch**, not as an outdated full-file replacement. It reconstructs the changed Workbench from the base SHA.

## Local workflow

1. User explicitly selects `.xlsx` (24 MB max) in **Таблицы и диаграммы**. File is read into a dedicated Studio Worker; no API upload.
2. Index stage reads and validates ZIP, OOXML workbook and relationships, then returns sheet names only. If the book has multiple sheets, selection is initially empty; for a single sheet it is selected by default. The user enters the 1-based header row.
3. Sheet stage loads exactly the selected sheet to a dense rectangular `CsvTable`, including blank rows and cells; duplicate nonempty headers stay duplicated, blank headers get stable `Столбец N` placeholders. Existing `loaded -> query -> table/filters/edit/project save/CSV+JSON+XLSX export` pipeline takes over. No model is automatically invoked.
4. Cancel/replacement terminates the old Worker; generation and request IDs fence late results. On successful import the Worker releases original compressed XLSX bytes and sheet index; table remains in memory only until explicit save.

## Defenses and bounds

- ZIP max 24,000,000 input bytes; at most 128 entries; each entry ≤64,000,000 uncompressed bytes; total uncompressed declared bytes ≤96,000,000; compression ratio ≤400:1; XML chars ≤64,000,000 per read. Rejects encrypted members, ZIP64 fields, unsupported compression, duplicate/case-colliding paths, symlinks, traversal/absolute paths, local/central disagreements, overlapping entries, CRC mismatches and missing OOXML essentials. No partial/truncated imports.
- Rejects external relationship targets (including remote hyperlinks), `xl/externalLinks`, `xl/embeddings`, `vbaProject.bin`; rejects DOCTYPE/ENTITY, malformed XML/entity/nesting, invalid shared-string indices, duplicate cell addresses, invalid row refs.
- Max 80,000 data rows, 100 columns, 1,000,000 dense cells **including headers**. Limits apply before table publication; sparse gaps consume dense-cell budget. All table data stays in Worker/browser until explicit project save, which retains existing server storage quotas.
- Does not evaluate formulas. Uses stored `<v>` cache when present, otherwise shows `=formula` text or `[формула без сохранённого результата]`, with warning and counts. Imported booleans become `TRUE`/`FALSE`; error cells show a descriptive literal; shared/inline/rich strings, XML entities, escaped OOXML `_xNNNN_`, UTF‑8 and Unicode are supported.
- Excel numeric styles, dates, percentages, currency, and Excel number formats are **not applied**. Raw numeric value/serial is preserved as **text**. Date system 1904 is warned about. Visually padded IDs stored as numbers may differ from Excel display; literal string IDs like `ID001` and `0002` stay literal. Numeric analysis requires explicit user column type. No XLS or XLSB, no formula recalculation, no encrypted workbooks, no external links or ZIP64.

## Tests / reproducibility

Executed locally in an isolated Node harness: **14/14 parser/security checks**, **2/2 Worker integration/cancellation checks**, and full successful import of 80,000 rows × 10 columns (800,010 dense cells). The Worker cancellation test uses Node `worker_threads` and a test-only native `zlib.inflateRawSync` adapter in place of unavailable `fflate`, and observes no late `loaded` after termination. Separate strict TypeScript 5.8.3 build of the new importer/Worker passed with small test-only stubs of existing contracts; the real installed `fflate` 0.8.3 and TypeScript 6.0.3 were not available in the local runtime.

The new repo-native Vitest test **calls the actual existing `exportDataXlsx` and reimports its Blob**, checking headers, values, and IDs. The new Playwright E2E covers sheet/header selection, filtering/edits, Excel export and no API writes prior to explicit save. These two repo-native suites, full web typecheck, and Next.js build were **not executed** because `pnpm` and project dependencies are unavailable in the isolated environment; they must run after integration.

The ZIP also contains a self-contained, isolated `qa/verify.sh` harness (`tsc`, Python 3 and Node required); from the ZIP extraction root, run `sh qa/verify.sh`. It creates synthetic XLSX fixtures and uses a **test-only Node zlib adapter**, not the production fflate. The production Vitest roundtrip and Playwright E2E still require the actual repository dependencies.

The generated unified patch is based on the exact GitHub source line anchors and Worker blob. `git apply --check` was tested against a synthetic checkout containing the exact patch anchors and the verified Worker blob; this does not replace a full `git apply --check` on the real checkout. No changes have been pushed to GitHub or merged.
