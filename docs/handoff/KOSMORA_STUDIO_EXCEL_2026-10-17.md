# Studio Excel export and project loading — 17 October 2026

Branch `codex/studio-excel-export-20261017` starts from `c747efd`, the deployed
project-table feature and its acceptance record. This adds an explicit local
Excel download and fixes a project-navigation race found by regression testing.

## Behavior

`Выгрузить Excel` exports all filtered rows in the current sort order, with all
selected columns, rather than only the visible page. It creates a single-sheet
XLSX workbook with a bold frozen header, usable column widths and an autofilter.
Duplicate headings and column order are retained. Text identifiers keep leading
zeros; explicitly numeric columns use the existing strict locale parser. Values
exceeding Excel's 15 significant digits remain original text. Invalid/empty
numeric values remain original text too. There is no formula evaluation,
hyperlink relationship, macro or external resource in the generated package.

Export uses the existing lazy-loaded `fflate` dependency; no dependency, API,
database schema or model call is added. Serialization yields every 256 rows and
checks cancellation. Async ZIP compression can be terminated; cancellation or a
failure produces no downloaded partial file. Expanded worksheet XML and final
ZIP each have a 32 MB ceiling. Cells over 32767 UTF-16 code units or containing
XML-incompatible characters fail explicitly; CSV/JSON remain available. This is
data export, not XLSX import, formula editing or chart export.

The package follows the workbook/worksheet/relationship structure described by
[Microsoft's SpreadsheetML documentation](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document).
Literal `_xHHHH_` text is protected against Open XML string escape interpretation;
carriage returns and XML metacharacters are preserved.

Studio now waits for initial route resolution and project loading before accepting
a local file. Previously, a slow project response could remount the project-scoped
Studio after the user chose the table tab/file, resetting their workspace. The
scope key still isolates actual project changes; controls now appear only after
that scope has resolved.

## Verification

- 17 unit tests passed across Excel serialization, Data core and cell edits;
  all six Excel cases passed again after normalizing asynchronous error types.
  Cases inspect the actual ZIP, typed numbers, raw IDs/formula text, duplicate
  headings, all 400 filtered/sorted rows across 100 columns, header-only output,
  invalid XML/oversized cells, cancellation, invalid indexes and expanded budget.
- Ten Chromium scenarios passed together (28.6 seconds): actual XLSX download of
  180 sorted rows with no API writes, delayed project loading and retained input,
  project version/conflict/reload/restore/report flow and existing Data cases.
  An earlier run exposed the project-loading race; it was fixed and the complete
  targeted set rerun successfully.
- Independent `openpyxl` 3.1.5 read the generated workbook and confirmed numeric
  values, literal formula text, leading-zero IDs, long number text, Unicode,
  frozen header, autofilter and header styling. This is a real independent file
  reader, not a claim that Microsoft Excel GUI was launched.
- Web semantic typecheck, scoped source lint, formatting, diff check and secret
  scan passed. Generated Next dev declaration changes were excluded.

## Production and live file acceptance

Source `d98013959a8506aa5eb6f708c5fd2afbde7df3c8` is deployed as web image
`cosmora-alpha-app:studio-excel-web-d980139`. The offline production build passed;
release directory is `/opt/cosmora/releases/studio-excel-d980139`. The source
archive contains tracked web application sources only (409200 bytes), SHA-256
`1665e183bc616f06262efbc094cb3774536c5b31495a9817f03c136289b7f74e`.

The first activation rolled back successfully because its verification tried the
Next server's internal loopback API rewrite. That route also returned 500 on the
unchanged baseline: production Caddy routes API requests directly to the separate
API service. The verification was corrected to read that service in its container
network, while checking the web root separately; no application source change was
needed. The failed-attempt log and backup were retained.

Final activation passed after an online consistent SQLite backup and integrity/hash
verification (SHA-256
`e6ffcb79954132a1fd7189902c2287b1bd5a1608265ea32ecb11ab60dead91aab`).
Web root, authenticated API health/projects/chats and the existing table v3 passed.
API, login, Code executor and edge container IDs/start times were compared before
and after and remained identical. No API restart, migration, credential change or
data rollback was required. Web and API were healthy at completion.

The authenticated live browser reopened project
`d4bf6aab-e080-4a6a-acd9-5f739b064f7b`, table
`2ccb2b09-3c44-44a8-8698-2132a6410438` v3 and clicked `Выгрузить Excel`.
It downloaded an actual 2348-byte XLSX. Independent `openpyxl` readback verified all
three original rows, month/revenue numeric cell types, expense text cells, frozen
header and filter range. Download SHA-256:
`a4765345a2d1d9c04f86c7705a9faf4fe1cd3b32c5df4c6f3016ea619d6b3e16`.

Local evidence:
`C:/Users/Александр/Documents/Codex/2026-10-17/kosmora-excel/live-demo.xlsx`,
`independent-reader.xlsx` and `excel-live.png`. Unit/browser/type/lint logs are
outside the checkout. Draft PR: https://github.com/RLM-Company/Nexus-OS/pull/359.
No merge into `main` and no paid AI request was used.
