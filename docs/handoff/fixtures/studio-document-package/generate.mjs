#!/usr/bin/env node
/**
 * Stage-three, package A: Studio document package generator.
 *
 * Produces two deterministic synthetic ZIP archives and one expected manifest:
 *   - simple.zip : PDF + DOCX + TXT + CSV (the "first simple archive")
 *   - extended.zip: simple + nested archive member, scanned PDF, incomplete
 *                   material and duplicate materials (the "hard" package)
 *
 * No external dependencies: minimal but structurally valid PDF/DOCX/ZIP are
 * built from bytes so the package is portable across machines and CI.
 * Deterministic: no timestamps, no random ids, fixed content.
 *
 * Usage: node generate.mjs [--out <dir>]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(
  process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : here
);
mkdirSync(out, { recursive: true });

const utf8 = (s) => Buffer.from(s, "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/* ---------------------------------------------------------------- ZIP ----- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Store-only ZIP (method 0). Deterministic, no timestamps, no directories. */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = utf8(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const centralEntry = Buffer.alloc(46 + nameBytes.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4); // made by
    centralEntry.writeUInt16LE(20, 6); // needed
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(0, 12);
    centralEntry.writeUInt16LE(0, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(data.length, 24);
    centralEntry.writeUInt16LE(nameBytes.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    nameBytes.copy(centralEntry, 46);
    central.push(centralEntry);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

/* --------------------------------------------------------------- DOCX ----- */
function docx(text) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const documentXml = utf8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p></w:body></w:document>`
  );
  const contentTypes = utf8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`
  );
  const rels = utf8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`
  );
  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml }
  ]);
}

/* ---------------------------------------------------------------- PDF ----- */
/** One-page text PDF. `pages` repeats the page object for multi-page files. */
function pdf(lines, pages = 1) {
  const objects = [];
  const text = lines
    .map((line, i) => `BT /F1 11 Tf 50 ${760 - i * 18} Td (${pdfEscape(line)}) Tj ET`)
    .join("\n");
  const stream = utf8(text);
  const pageRefs = [];
  for (let p = 1; p <= pages; p++) {
    const contentId = 3 + (p - 1) * 2;
    const pageId = contentId + 1;
    pageRefs.push(`${pageId} 0 R`);
    objects.push(
      {
        id: contentId,
        body: Buffer.concat([
          utf8(`<< /Length ${stream.length} >>\nstream\n`),
          stream,
          utf8("\nendstream")
        ])
      },
      {
        id: pageId,
        body: utf8(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
            `/Resources << /Font << /F1 5 0 R >> >> /Contents ${contentId} 0 R >>`
        )
      }
    );
  }
  // A tiny 1x1 JPEG (grayscale) used by the scanned PDF as an image XObject.
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
      "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAED" +
      "ASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF" +
      "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0" +
      "NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqK" +
      "jpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9o" +
      "ADAMBAAIRAxEAPwD3+iiigD//2Q==",
    "base64"
  );
  const imageId = 3 + pages * 2;
  const fontId = imageId + 1;
  objects.unshift(
    { id: 1, body: utf8("<< /Type /Catalog /Pages 2 0 R >>") },
    {
      id: 2,
      body: utf8(`<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages} >>`)
    },
    {
      id: imageId,
      body: Buffer.concat([
        utf8(
          `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray ` +
            `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
        ),
        jpeg,
        utf8("\nendstream")
      ])
    },
    { id: fontId, body: utf8("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>") }
  );
  // Rebuild with correct font/image references in page resources.
  const rebuilt = objects.map((o) => {
    if (o.id >= 4 && o.id < 3 + pages * 2 && o.id % 2 === 0) {
      return {
        id: o.id,
        body: utf8(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
            `/Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im0 ${imageId} 0 R >> >> ` +
            `/Contents ${o.id - 1} 0 R >>`
        )
      };
    }
    return o;
  });
  const chunks = [utf8("%PDF-1.4\n")];
  const offsets = [0];
  let length = chunks[0].length;
  for (const o of [...rebuilt].sort((a, b) => a.id - b.id)) {
    offsets[o.id] = length;
    const part = Buffer.concat([utf8(`${o.id} 0 obj\n`), o.body, utf8("\nendobj\n")]);
    chunks.push(part);
    length += part.length;
  }
  const xrefStart = length;
  const maxId = Math.max(...offsets.keys());
  let xref = utf8(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= maxId; i++)
    xref = Buffer.concat([xref, utf8(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)]);
  xref = Buffer.concat([
    xref,
    utf8(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  ]);
  return Buffer.concat([...chunks, xref]);
}
function pdfEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/* ------------------------------------------------------------- content ---- */
// Deterministic source facts. Quotes/pages in the manifest must match these.
const BRIEF = "Лунная станция SELENE-047";
const FACTS = [
  {
    file: "brief.txt",
    page: null,
    line: 1,
    quote: "Код станции: SELENE-047",
    text: `Код станции: SELENE-047\nОбъект: ${BRIEF}\nБюджет: 19 700 ₽`
  },
  {
    file: "budget.csv",
    page: null,
    line: 2,
    quote: "00123;19700;07.11.2026",
    text: "article;amount;date\n00123;19700;07.11.2026\n00456;4300;08.11.2026"
  },
  {
    file: "report.pdf",
    page: 1,
    line: 3,
    quote: "Итог: 24 000 ₽",
    text: "Отчёт по бюджету\nИтог: 24 000 ₽\nИсточники: сметы 19 700 и 4 300"
  },
  {
    file: "memo.docx",
    page: null,
    line: 1,
    quote: "Срок сдачи: 12 октября 2027",
    text: `Срок сдачи: 12 октября 2027\n${BRIEF}: финальная проверка`
  }
];

const files = {
  "brief.txt": utf8(FACTS[0].text),
  "budget.csv": utf8(FACTS[1].text),
  "report.pdf": pdf(["Отчёт по бюджету", "Итог: 24 000 ₽", "Источники: сметы 19 700 и 4 300"]),
  "memo.docx": docx(FACTS[3].text)
};
// Multi-page PDF for page/skip coverage (blank page 2 -> one indexed page).
const longPdf = pdf(["Приложение А", "Страница 1: 19 700", "Страница 3: 4 300"], 3);
// Scanned PDF: image-only page; text extraction must be marked as missing.
const scannedPdf = pdf(["(image-only scan)"], 1);
// Incomplete material: truncated CSV (header only, no data rows).
const incompleteCsv = utf8("article;amount;date\n");
// Duplicate materials: same basename in nested archive and different case.
const duplicateTxt = utf8(FACTS[0].text);
const duplicateCaseTxt = utf8("Дубль: те же реквизиты, другое имя.\n");

const nested = zip([
  { name: "nested/brief.txt", data: duplicateTxt },
  { name: "nested/extra.csv", data: utf8("article;amount;date\n00789;1200;09.11.2026") }
]);

const simpleEntries = Object.entries(files).map(([name, data]) => ({ name, data }));
const extendedEntries = [
  ...simpleEntries,
  { name: "appendix/long.pdf", data: longPdf },
  { name: "scans/scan.pdf", data: scannedPdf },
  { name: "partial/truncated.csv", data: incompleteCsv },
  { name: "nested.zip", data: nested },
  { name: "duplicates/BRIEF.TXT", data: duplicateCaseTxt },
  { name: "__MACOSX/._brief.txt", data: utf8("mac resource fork") },
  { name: "notes.md", data: utf8("# Неподдерживаемый формат\n") }
];

const simpleZip = zip(simpleEntries);
const extendedZip = zip(extendedEntries);
writeFileSync(join(out, "simple.zip"), simpleZip);
writeFileSync(join(out, "extended.zip"), extendedZip);

/* ------------------------------------------------------------ manifest ---- */
const member = (name, data, extra = {}) => ({
  name,
  bytes: data.length,
  sha256: sha256(data),
  ...extra
});
const expectedNames = (entries) =>
  entries
    .filter((e) => /\.(pdf|docx|csv|txt)$/i.test(e.name) && !e.name.startsWith("__MACOSX/"))
    .map((e) => e.name.replaceAll("/", " › "));

const manifest = {
  format: "kosmora.studio-document-package.v1",
  version: 1,
  generated_by: "generate.mjs",
  deterministic: true,
  question: "Какой итоговый бюджет и срок сдачи по лунной станции?",
  archives: {
    simple: {
      file: "simple.zip",
      bytes: simpleZip.length,
      sha256: sha256(simpleZip),
      members: simpleEntries.map((e) => member(e.name, e.data)),
      expected_document_names: expectedNames(simpleEntries),
      skipped: [],
      duplicate_names: [],
      note: "Базовый пакет: PDF, DOCX, TXT, CSV без вложенностей и пропусков."
    },
    extended: {
      file: "extended.zip",
      bytes: extendedZip.length,
      sha256: sha256(extendedZip),
      members: extendedEntries.map((e) => member(e.name, e.data)),
      expected_document_names: expectedNames(extendedEntries),
      // Honest gaps: what the importer must report, never silently absorb.
      skipped: [
        { name: "__MACOSX/._brief.txt", reason: "macos_resource_fork" },
        { name: "notes.md", reason: "unsupported_extension" },
        { name: "nested.zip", reason: "nested_archive_not_expanded" }
      ],
      incomplete: [
        { name: "partial/truncated.csv", reason: "header_only_no_data_rows" },
        { name: "scans/scan.pdf", reason: "image_only_page_no_text_layer" }
      ],
      duplicates: [
        {
          name: "nested.zip",
          inner_name: "nested/brief.txt",
          reason: "nested_archive_member_not_flattened",
          colliding_with: "brief.txt"
        },
        {
          name: "duplicates/BRIEF.TXT",
          reason: "case_insensitive_name_collision",
          colliding_with: "brief.txt"
        }
      ],
      note: "Расширенный пакет: вложенный архив, скан, неполный CSV, повторяющиеся материалы."
    }
  },
  pages: [
    { file: "report.pdf", total_pages: 1, indexed_pages: 1, blank_pages: [] },
    { file: "appendix/long.pdf", total_pages: 3, indexed_pages: 3, blank_pages: [] },
    { file: "scans/scan.pdf", total_pages: 1, indexed_pages: 0, blank_pages: [1] }
  ],
  citations: FACTS.map((f) => ({
    file: f.file,
    page: f.page,
    line: f.line,
    quote: f.quote,
    expected_in_answer: true
  })),
  expected_answer_contains: ["24 000", "19 700", "4 300", "12 октября 2027", "SELENE-047"],
  coverage_rules: {
    supported_extensions: ["pdf", "docx", "csv", "txt"],
    name_flattening: "path.replaceAll('/', ' › ')",
    case_insensitive_names: true,
    nested_archives_expanded: false,
    blank_or_image_only_pages: "counted but not indexed"
  }
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

// SHA256SUMS for the portable package (script + archives + manifest).
const sums = ["generate.mjs", "simple.zip", "extended.zip", "manifest.json"]
  .map((name) => {
    const bytes =
      name === "generate.mjs"
        ? readFileSync(fileURLToPath(import.meta.url))
        : readFileSync(join(out, name));
    return `${sha256(bytes)}  ${name}`;
  })
  .join("\n");
writeFileSync(join(out, "SHA256SUMS"), sums + "\n", "utf8");

console.log(
  JSON.stringify(
    {
      out,
      simple: { bytes: simpleZip.length, sha256: sha256(simpleZip) },
      extended: { bytes: extendedZip.length, sha256: sha256(extendedZip) },
      members_simple: simpleEntries.length,
      members_extended: extendedEntries.length,
      skipped: manifest.archives.extended.skipped.length,
      incomplete: manifest.archives.extended.incomplete.length,
      duplicates: manifest.archives.extended.duplicates.length
    },
    null,
    2
  )
);
