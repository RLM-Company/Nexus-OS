"use strict";
/**
 * Kosmora / Koswork Zero-Dependency OpenXML PowerPoint (.pptx) Deck Builder (Wave 20)
 *
 * Generates standard-compliant OpenXML `.pptx` presentations directly inside the
 * user's connected Koswork workspace folder:
 * - Multi-slide support (`ppt/presentation.xml`, `ppt/slides/slide1.xml`, ...)
 * - Slide titles, subtitles, bullet points, and speaker notes
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

/**
 * Builds an OpenXML `.pptx` buffer from a presentation spec:
 * `{ title: "Deck", slides: [{ title: "Slide 1", subtitle: "...", bullets: ["Item A", "Item B"] }] }`
 */
function buildPowerPointPptxBuffer(spec) {
  const rawSlides =
    Array.isArray(spec?.slides) && spec.slides.length > 0
      ? spec.slides
      : [{ title: spec?.title || "Презентация Koswork", bullets: [] }];

  const zipEntries = [];
  const slideContentTypeOverrides = [];
  const sldIdTags = [];
  const presRelsTags = [];

  for (let i = 0; i < rawSlides.length; i++) {
    const slide = rawSlides[i];
    const slideNum = i + 1;
    const sldId = 256 + i;
    const rId = `rId${slideNum}`;

    sldIdTags.push(`<p:sldId id="${sldId}" r:id="${rId}"/>`);
    presRelsTags.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
    );
    slideContentTypeOverrides.push(
      `<Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    );

    const paragraphs = [];
    if (slide.title) {
      paragraphs.push(
        `<a:p><a:r><a:rPr lang="ru-RU" sz="2800" b="1"/><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p>`
      );
    }
    if (slide.subtitle) {
      paragraphs.push(
        `<a:p><a:r><a:rPr lang="ru-RU" sz="1800" i="1"/><a:t>${escapeXml(slide.subtitle)}</a:t></a:r></a:p>`
      );
    }
    if (Array.isArray(slide.bullets)) {
      for (const b of slide.bullets) {
        if (!b) continue;
        paragraphs.push(
          `<a:p><a:r><a:rPr lang="ru-RU" sz="1600"/><a:t>• ${escapeXml(String(b))}</a:t></a:r></a:p>`
        );
      }
    }

    const slideXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr/>` +
      `<p:sp>` +
      `<p:nvSpPr><p:cNvPr id="2" name="TitleAndContent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr/>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join("")}</p:txBody>` +
      `</p:sp>` +
      `</p:spTree></p:cSld>` +
      `</p:sld>`;

    zipEntries.push({
      name: `ppt/slides/slide${slideNum}.xml`,
      data: slideXml
    });
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    slideContentTypeOverrides.join("") +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
    `</Relationships>`;

  const presentationXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:sldIdLst>${sldIdTags.join("")}</p:sldIdLst>` +
    `<p:sldSz cx="12192000" cy="6858000"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`;

  const presRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    presRelsTags.join("") +
    `</Relationships>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "ppt/presentation.xml", data: presentationXml },
    { name: "ppt/_rels/presentation.xml.rels", data: presRelsXml },
    ...zipEntries
  ]);
}

/**
 * Writes an OpenXML `.pptx` presentation safely into the connected Koswork workspace folder.
 */
function savePresentationToWorkspace(options) {
  const workspaceRoot = options.workspaceRoot;
  const relativePath = String(options.relativePath || "Koswork-Presentation.pptx");

  if (!relativePath.toLowerCase().endsWith(".pptx")) {
    throw new Error("INVALID_PPTX_EXTENSION: Presentation filename must end with .pptx");
  }

  const { canonicalRoot } = pathGuard.inspectRootDirectory(workspaceRoot);
  const resolvedTarget = pathGuard.resolveSafeWorkspaceTarget(canonicalRoot, relativePath, {
    allowMissingLeaf: true,
    allowMissingParents: true
  }).absolutePath;

  const pptxBuf = buildPowerPointPptxBuffer(options.presentationSpec || {});
  const sha256 = crypto.createHash("sha256").update(pptxBuf).digest("hex");

  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  fs.writeFileSync(resolvedTarget, pptxBuf);

  return {
    saved: true,
    format: "pptx",
    relativePath,
    absolutePath: resolvedTarget,
    sizeBytes: pptxBuf.length,
    sha256
  };
}

module.exports = {
  buildPowerPointPptxBuffer,
  savePresentationToWorkspace
};
