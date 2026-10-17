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

No paid AI request was used. Deployment and live-download evidence follow after
activation.
