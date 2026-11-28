"use strict";
// Bounded CSV edits for the Koswork Office workbench. Memory-only: the caller
// supplies bytes explicitly, no filesystem, network or formula evaluation.
// Shares the version/view/diff contract of office-edit.cjs so the web API and
// native workspace can dispatch on the file extension without a new engine.
const { computeBufferVersion } = require("./version-backup.cjs");
const { pageOfficeView } = require("./office-view.cjs");
const { text: officeText } = require("./office-text.cjs");

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_COLUMNS = 250;
const MAX_ROWS = 100000;
const MAX_CELLS = 2_000_000;
const DELIMITERS = [",", ";", "\t", "|"];
const fail = (reason = "UNSUPPORTED") => {
  throw Error("WORKSPACE_OFFICE_" + reason);
};
const isText = (value) => typeof value === "string" && value.isWellFormed();

function decode(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) fail("INVALID");
  if (bytes.includes(0)) fail("INVALID");
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("INVALID");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(source)) fail("INVALID");
  return { source, bom };
}

function parseWithDelimiter(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  const finishField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += character;
      continue;
    }
    if (closedQuote) {
      if (character === delimiter) finishField();
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[i + 1] === "\n") i++;
        finishRow();
      } else fail("INVALID");
      continue;
    }
    if (character === '"') {
      if (field.length) fail("INVALID");
      quoted = true;
    } else if (character === delimiter) finishField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else field += character;
  }
  if (quoted) fail("INVALID");
  if (field.length || row.length || closedQuote) finishRow();
  return rows;
}

function scoreDelimiter(rows) {
  const sample = rows.slice(0, 40);
  if (!sample.length) return -Infinity;
  const frequency = new Map();
  for (const row of sample) frequency.set(row.length, (frequency.get(row.length) ?? 0) + 1);
  const [width, count] = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0] ?? [1, 0];
  if (width < 2) return -Infinity;
  return count * 100 + width - (sample.length - count) * 20;
}

function parseCsv(text) {
  let best = null;
  let firstError = null;
  for (const delimiter of DELIMITERS) {
    try {
      const rows = parseWithDelimiter(text, delimiter);
      const score = scoreDelimiter(rows);
      if (!best || score > best.score) best = { delimiter, rows, score };
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  const delimiter = best?.score === -Infinity ? "," : (best?.delimiter ?? ",");
  let rows;
  try {
    rows = parseWithDelimiter(text, delimiter);
  } catch (error) {
    throw error instanceof Error ? error : (firstError ?? fail("INVALID"));
  }
  if (!rows.length || rows.length > MAX_ROWS) fail("INVALID");
  let width = 0;
  for (const row of rows) {
    if (row.length > width) width = row.length;
    if (width > MAX_COLUMNS) fail("INVALID");
  }
  if (rows.length * width > MAX_CELLS) fail("INVALID");
  const table = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
  return { delimiter, bom: false, rows: table, width };
}

function columnName(index) {
  let value = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  return value;
}

function columnIndex(label) {
  if (!/^[A-Z]{1,3}$/.test(label)) fail("INVALID");
  const value = [...label].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (value < 1 || value > MAX_COLUMNS) fail("INVALID");
  return value - 1;
}

// A1 addresses use 1-based rows; unlimited row range is bounded by the parsed table.
function coordinate(address) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,5})$/.exec(address);
  if (!match) fail("INVALID");
  const column = columnIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (row >= MAX_ROWS) fail("INVALID");
  return { column, row };
}

function needsQuoting(value, delimiter) {
  // Quote on any supported separator, not just the active one: the reader
  // re-detects the delimiter heuristically, so a bare ';' in a comma file (or
  // a bare ',' in a semicolon file) must stay one field on reopen. Quoting all
  // candidates also preserves the engine's historical comma-quoting behavior.
  for (const character of value)
    if (
      DELIMITERS.includes(character) ||
      character === delimiter ||
      character === '"' ||
      character === "\r" ||
      character === "\n"
    )
      return true;
  return false;
}
function csvField(value, delimiter) {
  return needsQuoting(value, delimiter) ? `"${value.replaceAll('"', '""')}"` : value;
}

function serialize(table) {
  const lines = table.rows.map((row) =>
    row.map((value) => csvField(value, table.delimiter)).join(table.delimiter)
  );
  const body = lines.join("\n");
  return table.bom
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")])
    : Buffer.from(body, "utf8");
}

function validateValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("INVALID");
    return;
  }
  if (isText(value)) {
    if (value.length > 500) fail("INVALID");
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    isText(value.formula)
  ) {
    if (!value.formula || value.formula.length > 256) fail("INVALID");
    // Only aggregate formulas on explicit cell references; no external links.
    const ref = "\\$?[A-Z]{1,3}\\$?[1-9][0-9]{0,5}";
    if (
      !new RegExp(
        "^(?:SUM|AVERAGE|MIN|MAX|COUNT)\\(" +
          ref +
          "(?::" +
          ref +
          ")?(?:," +
          ref +
          "(?::" +
          ref +
          ")?)*\\)$"
      ).test(value.formula)
    )
      fail("INVALID");
    return;
  }
  fail("INVALID");
}

function cellValue(value) {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "formula")
  )
    return value.formula.startsWith("=") ? value.formula : "=" + value.formula;
  return value;
}

// Values are stored in their exported form so readback can compare exactly.
function exportCellValue(value) {
  const raw = cellValue(value);
  const formula = value && typeof value === "object" && Object.hasOwn(value, "formula");
  return formula ? raw : sheetSafeText(raw);
}
function sheetSafeText(value) {
  return /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u0000-\u001f]*[=+\-@\uff1d\uff0b\uff0d\uff20]/u.test(
    value
  )
    ? "'" + value
    : value;
}

function validateEdits(operations) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 40 ||
    Buffer.byteLength(JSON.stringify(operations)) > 16000
  )
    fail("INVALID");
  let expanded = 0;
  for (const op of operations) {
    if (!op || typeof op !== "object" || Array.isArray(op)) fail("INVALID");
    if (op.kind === "set_cell") {
      const keys = ["kind", "target", "address", "value"];
      if (Object.keys(op).length !== keys.length || keys.some((k) => !Object.hasOwn(op, k)))
        fail("INVALID");
      if (op.target !== "table:1") fail("INVALID");
      coordinate(op.address);
      validateValue(op.value);
      expanded++;
    } else if (op.kind === "set_range") {
      const keys = ["kind", "target", "start", "rows"];
      if (Object.keys(op).length !== keys.length || keys.some((k) => !Object.hasOwn(op, k)))
        fail("INVALID");
      if (
        op.target !== "table:1" ||
        !Array.isArray(op.rows) ||
        !op.rows.length ||
        op.rows.length > 10
      )
        fail("INVALID");
      const start = coordinate(op.start);
      const width = op.rows[0].length;
      if (op.rows.some((row) => row.length !== width)) fail("INVALID");
      for (const row of op.rows) {
        if (!Array.isArray(row) || !row.length || row.length > 10) fail("INVALID");
        for (const value of row) {
          validateValue(value);
          expanded++;
        }
      }
      if (
        start.column + op.rows[0].length - 1 > MAX_COLUMNS ||
        start.row + op.rows.length - 1 >= MAX_ROWS
      )
        fail("INVALID");
    } else fail("INVALID");
  }
  if (expanded > 100) fail("INVALID");
}

function projectCell(row, column, table) {
  const raw = table.rows[row]?.[column] ?? "";
  const formula = /^=(SUM|AVERAGE|MIN|MAX|COUNT)\(/i.test(raw);
  return {
    address: columnName(column) + String(row + 1),
    type: formula ? "f" : "s",
    text: raw,
    formula: formula ? raw.slice(1) : null,
    cached_value: null
  };
}

function inspectCsv(name, bytes, { cursor, expectedVersion = null } = {}) {
  if (!/^[^/\\]+\.[cC][sS][vV]$/.test(String(name))) fail("INVALID");
  const version = computeBufferVersion(bytes);
  if (expectedVersion !== null && expectedVersion !== version.version) fail("VERSION_CONFLICT");
  if (cursor && (cursor.target_offset > 0 || cursor.content_offset > 0) && expectedVersion === null)
    fail("VERSION_CONFLICT");
  const { source, bom } = decode(bytes);
  const table = parseCsv(source);
  table.bom = bom;
  const cells = [];
  for (let row = 0; row < table.rows.length; row++)
    for (let column = 0; column < table.width; column++)
      cells.push({ row, column, ...projectCell(row, column, table) });
  const representation = {
    kind: "office_csv",
    format: "csv",
    version: "openxml-text-v1",
    complete_document: false,
    delimiter: table.delimiter,
    rows: table.rows.length,
    columns: table.width,
    sha256: version.sha256,
    limitations: [
      "CSV has no cell types: values are exported as text. Formulas are not evaluated; a leading '=' is an explicit formula only when supplied as {formula}."
    ]
  };
  const target = {
    id: "table:1",
    name: "CSV",
    cells,
    total_cells: cells.length,
    cells_excerpt_only: false,
    cells_offset: 0
  };
  return pageOfficeView({ ...version, representation }, { length: 1, get: () => target }, cursor);
}

function editCsv(name, bytes, operations) {
  validateEdits(operations);
  if (!/^[^/\\]+\.[cC][sS][vV]$/.test(String(name))) fail("INVALID");
  const version = computeBufferVersion(bytes);
  const { source, bom } = decode(bytes);
  const table = parseCsv(source);
  table.bom = bom;
  const before = table.rows.map((row) => [...row]);
  const diff = [];
  const changed = new Map();
  const expanded = operations.flatMap((op) =>
    op.kind === "set_range"
      ? op.rows.flatMap((row, r) =>
          row.map((value, c) => ({
            kind: "set_cell",
            target: op.target,
            address:
              columnName(columnIndex(op.start.match(/^[A-Z]{1,3}/)[0]) + c) +
              (Number(op.start.match(/[1-9][0-9]*$/)[0]) + r),
            value
          }))
        )
      : [op]
  );
  for (const op of expanded) {
    const { row, column } = coordinate(op.address);
    if (row >= table.rows.length) fail("INVALID");
    const address = op.address;
    const previous = table.rows[row][column];
    const next = exportCellValue(op.value);
    table.rows[row][column] = next;
    changed.set(`${row}:${column}`, true);
    diff.push({ ...op, before: previous, after: cellValue(op.value) });
  }
  if (Buffer.byteLength(JSON.stringify(diff)) > 10000) fail("VIEW_LIMIT");
  // Readback: every unchanged cell must be byte-identical to the source.
  const buffer = serialize(table);
  const readbackTable = parseCsv(
    new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\ufeff/, "")
  );
  for (let row = 0; row < before.length; row++) {
    for (let column = 0; column < before[row].length; column++) {
      if (changed.has(`${row}:${column}`)) continue;
      if (readbackTable.rows[row]?.[column] !== before[row][column]) fail("READBACK");
    }
  }
  for (const op of expanded) {
    const { row, column } = coordinate(op.address);
    if (readbackTable.rows[row]?.[column] !== table.rows[row][column]) fail("READBACK");
  }
  const result = inspectCsv(name, buffer);
  return {
    buffer,
    diff,
    representation: result.representation,
    ...computeBufferVersion(buffer),
    readback: result
  };
}

module.exports = {
  inspectCsv,
  editCsv,
  validateCsvEdits: validateEdits,
  parseCsv,
  serializeCsv: serialize
};
