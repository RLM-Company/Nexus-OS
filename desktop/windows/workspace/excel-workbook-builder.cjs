"use strict";
/**
 * Kosmora / Koswork Zero-Dependency OpenXML Excel (.xlsx) & CSV Workbook Builder (Wave 19)
 *
 * Generates standard-compliant OpenXML `.xlsx` workbooks and RFC-4180 `.csv` files
 * directly inside the user's connected Koswork workspace folder:
 * - Multi-sheet support (`xl/workbook.xml`, `xl/worksheets/sheet1.xml`, ...)
 * - Automatic numeric vs inline string typing and formula support (`=SUM(B2:B10)`)
 * - Compatible with `vault-document-extractor.cjs` for round-trip extraction verification
 * - Enforces path-guard sandboxing inside the connected workspace directory
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const pathGuard = require("./path-guard.cjs");

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const compressed = zlib.deflateRawSync(rawBuf);
    const crc = crc32(rawBuf);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function colIndexToLetter(colIdx) {
  let n = colIdx + 1;
  let str = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

/**
 * Builds an OpenXML `.xlsx` buffer from a workbook specification:
 * `{ sheets: [{ name: "Summary", headers: ["Metric", "Value"], rows: [["Budget", 250000]] }] }`
 */
function buildExcelWorkbookXlsxBuffer(spec) {
  const rawSheets = Array.isArray(spec?.sheets) && spec.sheets.length > 0
    ? spec.sheets
    : [{ name: "Sheet1", headers: spec?.headers || [], rows: spec?.rows || [] }];

  const zipEntries = [];
  const sheetXmlOverrides = [];
  const workbookSheetTags = [];
  const workbookRelsTags = [];

  for (let sIdx = 0; sIdx < rawSheets.length; sIdx++) {
    const sheet = rawSheets[sIdx];
    const sheetNum = sIdx + 1;
    const sheetName = escapeXml(String(sheet.name || `Sheet${sheetNum}`).slice(0, 31));
    const rId = `rId${sheetNum}`;

    workbookSheetTags.push(
      `<sheet name="${sheetName}" sheetId="${sheetNum}" r:id="${rId}"/>`
    );
    workbookRelsTags.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNum}.xml"/>`
    );
    sheetXmlOverrides.push(
      `<Override PartName="/xl/worksheets/sheet${sheetNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );

    const allRows = [];
    if (Array.isArray(sheet.headers) && sheet.headers.length > 0) {
      allRows.push(sheet.headers);
    }
    if (Array.isArray(sheet.rows)) {
      for (const r of sheet.rows) {
        if (Array.isArray(r)) allRows.push(r);
      }
    }

    const rowXmlParts = [];
    for (let rIdx = 0; rIdx < allRows.length; rIdx++) {
      const rowNum = rIdx + 1;
      const cells = allRows[rIdx];
      const cellXmlParts = [];

      for (let cIdx = 0; cIdx < cells.length; cIdx++) {
        const cellRef = `${colIndexToLetter(cIdx)}${rowNum}`;
        const val = cells[cIdx];

        if (val === null || val === undefined || val === "") {
          continue;
        }

        if (typeof val === "number" && Number.isFinite(val)) {
          cellXmlParts.push(`<c r="${cellRef}" t="n"><v>${val}</v></c>`);
        } else if (typeof val === "string" && val.startsWith("=")) {
          const formula = escapeXml(val.slice(1));
          cellXmlParts.push(`<c r="${cellRef}"><f>${formula}</f></c>`);
        } else {
          const text = escapeXml(String(val));
          cellXmlParts.push(`<c r="${cellRef}" t="inlineStr"><is><t>${text}</t></is></c>`);
        }
      }

      rowXmlParts.push(`<row r="${rowNum}">${cellXmlParts.join("")}</row>`);
    }

    const worksheetXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rowXmlParts.join("")}</sheetData>` +
      `</worksheet>`;

    zipEntries.push({
      name: `xl/worksheets/sheet${sheetNum}.xml`,
      data: worksheetXml
    });
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetXmlOverrides.join("") +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${workbookSheetTags.join("")}</sheets>` +
    `</workbook>`;

  const workbookRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    workbookRelsTags.join("") +
    `</Relationships>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml },
    ...zipEntries
  ]);
}

/**
 * Formats a table spec into RFC-4180 CSV text.
 */
function buildCsvString(spec) {
  const allRows = [];
  if (Array.isArray(spec?.headers) && spec.headers.length > 0) {
    allRows.push(spec.headers);
  }
  if (Array.isArray(spec?.rows)) {
    for (const r of spec.rows) {
      if (Array.isArray(r)) allRows.push(r);
    }
  }

  return (
    allRows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            if (/[",\r\n]/.test(s)) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(",")
      )
      .join("\r\n") + "\r\n"
  );
}

/**
 * Writes an OpenXML `.xlsx` or `.csv` workbook safely into the connected Koswork workspace folder.
 */
function saveWorkbookToWorkspace(options) {
  const workspaceRoot = options.workspaceRoot;
  const relativePath = String(options.relativePath || "Koswork-Data.xlsx");
  const lower = relativePath.toLowerCase();

  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
    throw new Error("INVALID_WORKBOOK_EXTENSION: Filename must end with .xlsx or .csv");
  }

  const { canonicalRoot } = pathGuard.inspectRootDirectory(workspaceRoot);
  const resolvedTarget = pathGuard.resolveSafeWorkspaceTarget(canonicalRoot, relativePath, {
    allowMissingLeaf: true,
    allowMissingParents: true
  }).absolutePath;

  const outBuf = lower.endsWith(".xlsx")
    ? buildExcelWorkbookXlsxBuffer(options.workbookSpec || {})
    : Buffer.from(buildCsvString(options.workbookSpec || {}), "utf8");

  const sha256 = crypto.createHash("sha256").update(outBuf).digest("hex");

  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  fs.writeFileSync(resolvedTarget, outBuf);

  return {
    saved: true,
    format: lower.endsWith(".xlsx") ? "xlsx" : "csv",
    relativePath,
    absolutePath: resolvedTarget,
    sizeBytes: outBuf.length,
    sha256
  };
}

module.exports = {
  buildExcelWorkbookXlsxBuffer,
  buildCsvString,
  saveWorkbookToWorkspace
};
