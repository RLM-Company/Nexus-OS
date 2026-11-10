"use strict";

const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { KosworkWorkspaceService } = require("./workspace-service.cjs");

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
    localHeader.writeUInt16LE(8, 8); // deflate
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

/**
 * Zero-dependency OpenXML Word (`.docx`) report builder for the Koswork Unified Task
 * ("поиск источников, создание отчета Word и сохранение на Рабочий стол / в рабочую папку" in PR #416).
 */
function buildWordReportDocxBuffer(spec) {
  const title = String(spec.title || "Отчёт Koswork");
  const subtitle = String(spec.subtitle || `Сформировано: ${new Date().toISOString().slice(0, 10)}`);
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const sources = Array.isArray(spec.sources) ? spec.sources : [];

  const relEntries = [];
  const bodyParagraphs = [];

  // Title & Subtitle paragraphs
  bodyParagraphs.push(
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${escapeXml(
      title
    )}</w:t></w:r></w:p>`
  );
  bodyParagraphs.push(
    `<w:p><w:r><w:rPr><w:color w:val="4B5563"/><w:sz w:val="22"/></w:rPr><w:t>${escapeXml(
      subtitle
    )}</w:t></w:r></w:p>`
  );

  // Content sections
  for (const sec of sections) {
    bodyParagraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>${escapeXml(
        sec.heading
      )}</w:t></w:r></w:p>`
    );
    const paragraphs = Array.isArray(sec.paragraphs)
      ? sec.paragraphs
      : [String(sec.body || "")];
    for (const pText of paragraphs) {
      if (!pText) continue;
      bodyParagraphs.push(
        `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${escapeXml(pText)}</w:t></w:r></w:p>`
      );
    }
  }

  // Verified Sources section with clickable hyperlinks
  if (sources.length > 0) {
    bodyParagraphs.push(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>Проверенные источники</w:t></w:r></w:p>`
    );

    sources.forEach((src, idx) => {
      const rId = `rIdLink${idx + 1}`;
      const url = String(src.url || "https://local.koswork");
      const srcTitle = String(src.title || url);
      const quote = String(src.quote || "");
      const quoteSha256 =
        src.sha256 || crypto.createHash("sha256").update(quote, "utf8").digest("hex").slice(0, 16);

      relEntries.push(
        `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(
          url
        )}" TargetMode="External"/>`
      );

      bodyParagraphs.push(
        `<w:p>` +
          `<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>${idx + 1}. </w:t></w:r>` +
          `<w:hyperlink r:id="${rId}" w:history="1"><w:r><w:rPr><w:color w:val="1D4ED8"/><w:u w:val="single"/><w:sz w:val="22"/></w:rPr><w:t>${escapeXml(
            srcTitle
          )}</w:t></w:r></w:hyperlink>` +
          `<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t> (${escapeXml(url)}) — Цитата: «${escapeXml(
            quote
          )}» [SHA-256: ${escapeXml(quoteSha256)}]</w:t></w:r>` +
          `</w:p>`
      );
    });
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    relEntries.join("") +
    `</Relationships>`;

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyParagraphs.join("")}<w:sectPr/></w:body>` +
    `</w:document>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml },
    { name: "word/document.xml", data: documentXml }
  ]);
}

/**
 * Generates a `.docx` report from unified-task research findings and writes it
 * safely into the owner-connected Koswork workspace folder (with path guard and version check).
 */
function saveWordReportToWorkspace(options) {
  const fs = require("node:fs");
  const pathGuard = require("./path-guard.cjs");

  const workspaceRoot = options.workspaceRoot;
  const relativePath = String(options.relativePath || "Koswork-Report.docx");
  if (!relativePath.toLowerCase().endsWith(".docx")) {
    throw new Error("INVALID_DOCX_EXTENSION: Report filename must end with .docx");
  }

  const { canonicalRoot } = pathGuard.inspectRootDirectory(workspaceRoot);
  const resolvedTarget = pathGuard.resolveSafeWorkspaceTarget(canonicalRoot, relativePath, { allowMissingLeaf: true, allowMissingParents: true }).absolutePath;
  const docxBuffer = buildWordReportDocxBuffer(options.reportSpec || {});
  const sha256 = crypto.createHash("sha256").update(docxBuffer).digest("hex");

  fs.mkdirSync(require("node:path").dirname(resolvedTarget), { recursive: true });
  fs.writeFileSync(resolvedTarget, docxBuffer);

  return {
    saved: true,
    relativePath,
    absolutePath: resolvedTarget,
    sizeBytes: docxBuffer.length,
    sha256
  };
}

module.exports = {
  buildWordReportDocxBuffer,
  saveWordReportToWorkspace
};
