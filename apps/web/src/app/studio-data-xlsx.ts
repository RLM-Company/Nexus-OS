import type { CsvTable } from "./studio-csv";
import {
  DATA_LIMITS,
  dataNumber,
  validateDataSettings,
  validateDataTable,
  type DataSettings
} from "./studio-data-core";

const encoder = new TextEncoder();
const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relations = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelations = "http://schemas.openxmlformats.org/package/2006/relationships";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function text(value: string): string {
  if (value.length > 32_767)
    throw new Error("В XLSX ячейка не может превышать 32 767 символов. Используйте CSV или JSON.");
  // XML 1.0 cannot preserve these characters. Reject rather than silently alter data.
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new Error("Ячейка содержит символы, несовместимые с XLSX. Используйте JSON.");
  }
  return value
    .replace(/_x[0-9a-f]{4}_/gi, (match) => "_x005F_" + match.slice(1))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#13;");
}

function numberValue(raw: string): number | null {
  const value = dataNumber(raw);
  if (value === null) return null;
  // Excel retains only 15 significant digits and a narrower exponent range.
  // Longer numbers remain the original text even in an explicitly numeric column.
  const digits = raw.replace(/[^0-9]/g, "").replace(/^0+|0+$/g, "");
  if (digits.length > 15 || (value === 0 && digits.length)) return null;
  const absolute = Math.abs(value);
  return absolute !== 0 && (absolute < 2.2250738585072014e-308 || absolute > 9.99999999999999e307)
    ? null
    : value;
}

/** Explicit local export: one sheet, all result rows, selected columns, no formulas or links. */
export async function exportDataXlsx(
  table: CsvTable,
  indexes: readonly number[],
  settings: DataSettings,
  signal: AbortSignal,
  progress?: (rows: number) => void
): Promise<Blob> {
  signal.throwIfAborted();
  validateDataTable(table);
  validateDataSettings(settings, table.headers.length);
  if (
    indexes.length > table.rows.length ||
    indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= table.rows.length)
  )
    throw new Error("Некорректная выборка строк для XLSX.");
  const parts: string[] = [];
  let bytes = 0;
  const push = (part: string) => {
    bytes += encoder.encode(part).byteLength;
    if (bytes > DATA_LIMITS.exportBytes)
      throw new Error("XLSX превышает 32 МБ XML. Используйте CSV или JSON; данные не усекались.");
    parts.push(part);
  };
  const last = columnName(settings.columns.length - 1) + String(indexes.length + 1);
  push(
    declaration +
      `<worksheet xmlns="${main}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${settings.columns.length}" width="22" customWidth="1"/></cols><sheetData>`
  );
  function row(values: string[], rowNumber: number, header = false): string {
    return (
      `<row r="${rowNumber}">` +
      settings.columns
        .map((column, i) => {
          const raw = values[column] ?? "";
          const ref = columnName(i) + rowNumber;
          const numeric = !header && settings.types[column] === "number" ? numberValue(raw) : null;
          return numeric !== null
            ? `<c r="${ref}" t="n"><v>${numeric}</v></c>`
            : `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${text(raw)}</t></is></c>`;
        })
        .join("") +
      "</row>"
    );
  }
  push(row(table.headers, 1, true));
  for (let i = 0; i < indexes.length; i++) {
    signal.throwIfAborted();
    push(row(table.rows[indexes[i]!]!, i + 2));
    if ((i + 1) % 256 === 0) {
      progress?.(i + 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  push(`</sheetData><autoFilter ref="A1:${last}"/></worksheet>`);
  signal.throwIfAborted();
  progress?.(indexes.length);
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, value: string) => {
    files[name] = encoder.encode(value);
  };
  add(
    "[Content_Types].xml",
    declaration +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
  );
  add(
    "_rels/.rels",
    declaration +
      `<Relationships xmlns="${packageRelations}"><Relationship Id="rId1" Type="${relations}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  add(
    "xl/workbook.xml",
    declaration +
      `<workbook xmlns="${main}" xmlns:r="${relations}"><sheets><sheet name="Данные" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  add(
    "xl/_rels/workbook.xml.rels",
    declaration +
      `<Relationships xmlns="${packageRelations}"><Relationship Id="rId1" Type="${relations}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relations}/styles" Target="styles.xml"/></Relationships>`
  );
  add(
    "xl/styles.xml",
    declaration +
      `<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  );
  add("xl/worksheets/sheet1.xml", parts.join(""));
  const { zip } = await import("fflate");
  signal.throwIfAborted();
  const output = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    let terminate: (() => void) | undefined;
    const abortError = () =>
      signal.reason instanceof Error ? signal.reason : new DOMException("Cancelled", "AbortError");
    const abort = () => {
      terminate?.();
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      terminate = zip(files, { level: 1 }, (error, data) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(abortError());
        else if (error) reject(error);
        else resolve(new Uint8Array(data));
      });
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error instanceof Error ? error : new Error("Не удалось создать XLSX."));
    }
  });
  signal.throwIfAborted();
  if (output.byteLength > DATA_LIMITS.exportBytes) throw new Error("Архив XLSX превышает 32 МБ.");
  return new Blob([output], { type: XLSX_MIME });
}
