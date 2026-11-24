#!/usr/bin/env node
/**
 * Deterministic HEAVY file-analysis fixture package.
 * Offline only: builds ZIP32 STORE archives from synthetic bytes, no network,
 * no paid providers, no images/video/music (owned by the other section).
 *
 * Layout:
 *   heavy.zip            outer archive with mixed supported/unsupported members
 *   nested-evidence.zip  nested archive expanded one level by the product importer
 *   manifest.json        byte-exact expectations, pages, chunks, citations, gaps
 *   SHA256SUMS
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/* ----------------------------- ZIP32 STORE ------------------------------ */
function zip32(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, end]);
}
function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

/* ---------------------------- synthetic bytes --------------------------- */
const text = (value) => Buffer.from(value, "utf8");
const pdf = (pages, label) => {
  // Minimal but signature-valid PDF with page count in a comment; text lives in
  // the matching TXT sidecar. Heavy fixture exercises structure, not rendering.
  const objects = [];
  const obj = (v) => {
    objects.push(Buffer.from(v, "utf8"));
    return objects.length;
  };
  const catalogId = obj("");
  const pagesId = obj("");
  const ids = [];
  for (let i = 1; i <= pages; i++) {
    const stream = `BT /F1 12 Tf 40 780 Td (${label} page ${i}) Tj ET`;
    const contentId = obj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    ids.push(
      obj(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`
  );
  const head = Buffer.from("%PDF-1.4\n%heavy-fixture\n", "utf8");
  const parts = [head];
  const offsets = [0];
  let pos = head.length;
  for (let i = 0; i < objects.length; i++) {
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "utf8"),
      objects[i],
      Buffer.from("\nendobj\n", "utf8")
    ]);
    offsets.push(pos);
    parts.push(part);
    pos += part.length;
  }
  const xref = Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join(
        ""
      )}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`,
    "utf8"
  );
  parts.push(xref);
  return Buffer.concat(parts);
};
const docx = (paragraphs) => {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const types = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zip32([
    { name: "[Content_Types].xml", data: text(types) },
    { name: "_rels/.rels", data: text(rels) },
    { name: "word/document.xml", data: text(document) }
  ]);
};

const LONG_PAGES = 140;
const longLines = [];
for (let p = 1; p <= LONG_PAGES; p++) {
  for (let line = 1; line <= 6; line++) {
    longLines.push(
      `L${String(p).padStart(3, "0")}-${line} Итоговая сумма ${p * 7 + line} по смете ${p}.`
    );
  }
}
const longTxt = text(longLines.join("\n") + "\n");
const csvHeader = "код;сумма;дата;страница\n";
const csvRows = Array.from(
  { length: 600 },
  (_, i) => `A${String(i + 1).padStart(4, "0")};${1000 + i};07.11.2026;${(i % 12) + 1}\n`
).join("");
const csv = text(csvHeader + csvRows);
const scanTxt = text("СКАН-СТРАНИЦА 1: код станции SELENE-047. Срок сдачи 12 октября 2027.\n");
const scanPdf = pdf(1, "scan");
const memo = text("Показатель SELENE-047 утверждён. Сумма 19700.\n");
const brief = text("Вопрос: итоговый бюджет и срок сдачи лунной станции.\n");

const nestedZip = zip32([
  { name: "nested/extra.csv", data: text("page;value\n1;42\n") },
  { name: "nested/quote.txt", data: text("Код станции: SELENE-047\n") }
]);
const outer = zip32([
  { name: "brief.txt", data: brief },
  { name: "tables/budget.csv", data: csv },
  { name: "long/report.txt", data: longTxt },
  { name: "long/report.pdf", data: pdf(LONG_PAGES, "long") },
  { name: "scans/scan.pdf", data: scanPdf },
  { name: "scans/scan.txt", data: scanTxt },
  { name: "memo.docx", data: docx(["Показатель SELENE-047 утверждён.", "Сумма 19700."]) },
  { name: "nested-evidence.zip", data: nestedZip },
  { name: "unsupported/notes.md", data: text("не поддерживается импортером\n") },
  { name: "__MACOSX/._brief.txt", data: text("resource fork") }
]);

const manifest = {
  format: "kosmora.file-analysis-heavy.v1",
  generated_by: "generate.mjs",
  deterministic: true,
  question: "Найти код станции, итоговую сумму и срок сдачи по смете SELENE-047.",
  archives: {
    outer: {
      file: "heavy.zip",
      bytes: outer.length,
      sha256: sha256(outer),
      members: [
        { name: "brief.txt", bytes: brief.length, sha256: sha256(brief) },
        { name: "tables/budget.csv", bytes: csv.length, sha256: sha256(csv) },
        { name: "long/report.txt", bytes: longTxt.length, sha256: sha256(longTxt) },
        { name: "long/report.pdf", bytes: pdf(LONG_PAGES, "long").length },
        {
          name: "scans/scan.pdf",
          bytes: scanPdf.length,
          sha256: sha256(scanPdf),
          image_only: true
        },
        {
          name: "scans/scan.txt",
          bytes: scanTxt.length,
          sha256: sha256(scanTxt),
          ocr_sidecar: true
        },
        {
          name: "memo.docx",
          bytes: docx(["Показатель SELENE-047 утверждён.", "Сумма 19700."]).length
        }
      ],
      expected_document_names: [
        "brief.txt",
        "tables › budget.csv",
        "long › report.txt",
        "long › report.pdf",
        "scans › scan.pdf",
        "scans › scan.txt",
        "memo.docx",
        "nested-evidence.zip › nested › extra.csv",
        "nested-evidence.zip › nested › quote.txt"
      ],
      skipped: [
        { name: "unsupported/notes.md", reason: "unsupported_extension" },
        { name: "__MACOSX/._brief.txt", reason: "macos_resource_fork" }
      ],
      incomplete: [{ name: "scans/scan.pdf", reason: "image_only_no_text_layer" }]
    }
  },
  limits: {
    file_bytes: 20_000_000,
    text_characters: 2_000_000,
    pdf_pages: 3_000,
    chunks_per_file: 5_000,
    files_per_project: 100,
    bytes_per_project: 100_000_000,
    archive_bytes: 4_000_000
  },
  expected: {
    long_pages: LONG_PAGES,
    long_lines: longLines.length,
    csv_rows: 600,
    citations: [
      {
        file: "nested-evidence.zip › nested › quote.txt",
        quote: "Код станции: SELENE-047",
        page: null
      },
      { file: "memo.docx", quote: "Сумма 19700", page: null },
      { file: "scans › scan.txt", quote: "Срок сдачи 12 октября 2027", page: null }
    ]
  }
};

writeFileSync(join(here, "heavy.zip"), outer);
writeFileSync(join(here, "nested-evidence.zip"), nestedZip);
writeFileSync(join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const sums =
  [
    ["generate.mjs", "generate.mjs"],
    ["heavy.zip", "heavy.zip"],
    ["nested-evidence.zip", "nested-evidence.zip"],
    ["manifest.json", "manifest.json"]
  ]
    .map(([path, file]) => `${sha256(readFileSync(join(here, file)))}  ${path}`)
    .join("\n") + "\n";
writeFileSync(join(here, "SHA256SUMS"), sums);
console.log(
  JSON.stringify(
    {
      heavy_zip_bytes: outer.length,
      nested_bytes: nestedZip.length,
      pages: LONG_PAGES,
      csv_rows: 600
    },
    null,
    2
  )
);
