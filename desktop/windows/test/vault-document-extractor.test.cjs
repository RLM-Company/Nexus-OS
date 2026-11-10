"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");
const {
  DEFAULT_HANDOFF_SLICE_CHARS,
  EXTRACTION_ERROR_CODES,
  VaultDocumentError,
  extractVaultDocument,
  readAddressableVaultSlice
} = require("../vault-document-extractor.cjs");

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTestZip(entries, { deflate = true, spoofUncompressedSize = null } = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const rawBuf = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes, "utf8");
    const crc = crc32(rawBuf);
    const compressedBuf = deflate ? zlib.deflateRawSync(rawBuf) : rawBuf;
    const method = deflate ? 8 : 0;
    const reportedUncompressed = spoofUncompressedSize ?? rawBuf.byteLength;

    const localHead = Buffer.alloc(30);
    localHead.writeUInt32LE(0x04034b50, 0);
    localHead.writeUInt16LE(20, 4);
    localHead.writeUInt16LE(0x0800, 6);
    localHead.writeUInt16LE(method, 8);
    localHead.writeUInt32LE(crc, 14);
    localHead.writeUInt32LE(compressedBuf.byteLength, 18);
    localHead.writeUInt32LE(reportedUncompressed, 22);
    localHead.writeUInt16LE(nameBuf.byteLength, 26);

    localParts.push(localHead, nameBuf, compressedBuf);

    const centralHead = Buffer.alloc(46);
    centralHead.writeUInt32LE(0x02014b50, 0);
    centralHead.writeUInt16LE(20, 4);
    centralHead.writeUInt16LE(20, 6);
    centralHead.writeUInt16LE(0x0800, 8);
    centralHead.writeUInt16LE(method, 10);
    centralHead.writeUInt32LE(crc, 16);
    centralHead.writeUInt32LE(compressedBuf.byteLength, 20);
    centralHead.writeUInt32LE(reportedUncompressed, 24);
    centralHead.writeUInt16LE(nameBuf.byteLength, 28);
    centralHead.writeUInt32LE(offset, 42);

    centralParts.push(centralHead, nameBuf);
    centralSize += centralHead.byteLength + nameBuf.byteLength;
    offset += localHead.byteLength + nameBuf.byteLength + compressedBuf.byteLength;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function buildTestPdfBuffer(pages, { compress = true } = {}) {
  const chunks = ["%PDF-1.7\n"];
  pages.forEach((pageText, idx) => {
    const content = `BT /F1 12 Tf 72 720 Td (${pageText.replace(/([()\\])/g, "\\$1")}) Tj ET`;
    const contentBuf = Buffer.from(content, "latin1");
    if (compress) {
      const compressed = zlib.deflateSync(contentBuf);
      chunks.push(
        `${idx + 1} 0 obj\n<< /Length ${compressed.byteLength} /Filter /FlateDecode >>\nstream\n`,
        compressed.toString("latin1"),
        "\nendstream\nendobj\n"
      );
    } else {
      chunks.push(
        `${idx + 1} 0 obj\n<< /Length ${contentBuf.byteLength} >>\nstream\n`,
        content,
        "\nendstream\nendobj\n"
      );
    }
  });
  chunks.push("%%EOF\n");
  return Buffer.from(chunks.join(""), "latin1");
}

test("extracts text from .docx, .xlsx, .pptx, and .pdf files locally without network or external binaries", () => {
  // 1. DOCX
  const docxBuf = buildTestZip([
    {
      path: "word/document.xml",
      bytes:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        "<w:document><w:body>" +
        "<w:p><w:r><w:t>Договор поставки &amp; спецификация</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Пункт 1: поставка оборудования в срок.</w:t></w:r></w:p>" +
        "</w:body></w:document>"
    }
  ]);
  const docxRes = extractVaultDocument(docxBuf, { filename: "contract.docx" });
  assert.equal(docxRes.format, "docx");
  assert.equal(docxRes.extractionStatus, "extracted");
  assert.match(docxRes.text, /Договор поставки & спецификация/);
  assert.match(docxRes.text, /Пункт 1: поставка оборудования/);

  // 2. XLSX
  const xlsxBuf = buildTestZip([
    {
      path: "xl/workbook.xml",
      bytes: '<workbook><sheets><sheet name="Бюджет 2026" sheetId="1"/></sheets></workbook>'
    },
    {
      path: "xl/sharedStrings.xml",
      bytes: "<sst><si><t>Статья</t></si><si><t>Сервер VPS</t></si></sst>"
    },
    {
      path: "xl/worksheets/sheet1.xml",
      bytes:
        "<worksheet><sheetData>" +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Сумма</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="n"><v>14500</v></c></row>' +
        "</sheetData></worksheet>"
    }
  ]);
  const xlsxRes = extractVaultDocument(xlsxBuf, { filename: "budget.xlsx" });
  assert.equal(xlsxRes.format, "xlsx");
  assert.match(xlsxRes.text, /\[Лист: Бюджет 2026\]/);
  assert.match(xlsxRes.text, /Сервер VPS\t14500/);

  // 3. PPTX
  const pptxBuf = buildTestZip([
    {
      path: "ppt/slides/slide1.xml",
      bytes: "<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>Архитектура Koswork</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>"
    },
    {
      path: "ppt/slides/slide2.xml",
      bytes: "<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>Локальное хранилище Vault</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>"
    }
  ]);
  const pptxRes = extractVaultDocument(pptxBuf, { filename: "deck.pptx" });
  assert.equal(pptxRes.format, "pptx");
  assert.equal(pptxRes.sectionCount, 2);
  assert.match(pptxRes.text, /\[Слайд 1\]\nАрхитектура Koswork/);
  assert.match(pptxRes.text, /\[Слайд 2\]\nЛокальное хранилище Vault/);

  // 4. PDF (FlateDecode compressed streams)
  const pdfBuf = buildTestPdfBuffer(["Kosmora PDF Page 1 Summary", "Kosmora PDF Page 2 Details"]);
  const pdfRes = extractVaultDocument(pdfBuf, { filename: "report.pdf" });
  assert.equal(pdfRes.format, "pdf");
  assert.equal(pdfRes.extractionStatus, "extracted");
  assert.equal(pdfRes.sectionCount, 2);
  assert.match(pdfRes.text, /\[Страница 1\]\nKosmora PDF Page 1 Summary/);
  assert.match(pdfRes.text, /\[Страница 2\]\nKosmora PDF Page 2 Details/);
});

test("provides addressable chunk reading for documents exceeding 12,000 characters without silent truncation", () => {
  const paragraph = "Строка технического регламента Koswork для проверки адресного чтения фрагментов.\n";
  const largeText = paragraph.repeat(400); // ~32,800 chars (> 12,000 limit)
  const docxBuf = buildTestZip([
    {
      path: "word/document.xml",
      bytes: `<w:document><w:body><w:p><w:r><w:t>${largeText}</w:t></w:r></w:p></w:body></w:document>`
    }
  ]);

  const extracted = extractVaultDocument(docxBuf, { filename: "large-spec.docx" });
  assert.equal(extracted.requiresChunkedHandoff, true);
  assert.ok(extracted.totalChunks >= 3);

  const reassembled = [];
  for (let i = 1; i <= extracted.totalChunks; i += 1) {
    const slice = readAddressableVaultSlice(extracted, { chunkIndex: i });
    assert.equal(slice.chunkIndex, i);
    assert.equal(slice.totalChunks, extracted.totalChunks);
    assert.equal(slice.truncatedSilently, false);
    assert.ok(slice.charLength <= DEFAULT_HANDOFF_SLICE_CHARS);
    assert.equal(slice.hasPrevious, i > 1);
    assert.equal(slice.hasNext, i < extracted.totalChunks);
    reassembled.push(slice.text);
  }
  assert.equal(reassembled.join(""), extracted.text);

  assert.throws(
    () => readAddressableVaultSlice(extracted, { chunkIndex: extracted.totalChunks + 1 }),
    (err) => err instanceof VaultDocumentError && err.code === EXTRACTION_ERROR_CODES.VAULT_DOC_SLICE_OUT_OF_RANGE
  );
});

test("rejects zip bombs, path traversal inside Office archives, and corrupt PDFs", () => {
  // Zip bomb with spoofed > 16 MiB uncompressed header
  const bombZip = buildTestZip(
    [{ path: "word/document.xml", bytes: "<w:document/>" }],
    { spoofUncompressedSize: 20 * 1024 * 1024 }
  );
  assert.throws(
    () => extractVaultDocument(bombZip, { filename: "bomb.docx" }),
    (err) => err.code === EXTRACTION_ERROR_CODES.VAULT_DOC_ZIP_BOMB_DETECTED
  );

  // Path traversal inside ZIP entry
  const traversalZip = buildTestZip([{ path: "../evil.xml", bytes: "<w:document/>" }]);
  assert.throws(
    () => extractVaultDocument(traversalZip, { filename: "evil.docx" }),
    (err) => err.code === EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_ARCHIVE
  );

  // Invalid PDF header
  assert.throws(
    () => extractVaultDocument(Buffer.from("NOT_A_PDF_FILE"), { filename: "bad.pdf" }),
    (err) => err.code === EXTRACTION_ERROR_CODES.VAULT_DOC_CORRUPT_PDF
  );
});
