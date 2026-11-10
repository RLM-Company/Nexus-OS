"use strict";
/**
 * Kosmora / Koswork Zero-Dependency Native PDF 1.4 Report Builder (Wave 21)
 *
 * Generates standard-compliant multi-page PDF 1.4 documents (`%PDF-1.4`) directly inside
 * the user's connected Koswork workspace folder:
 * - Builds `/Catalog`, `/Pages`, `/Page`, `/Font` (Helvetica / Helvetica-Bold), and `BT ... ET`
 *   content streams with exact byte-offset `xref` tables and `trailer`.
 * - Compatible with `vault-document-extractor.cjs` (`extractPdfText`) for round-trip extraction.
 * - Enforces path-guard sandboxing inside the connected workspace directory.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const pathGuard = require("./path-guard.cjs");

function escapePdfLiteral(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

/**
 * Builds a valid multi-page PDF 1.4 Buffer from a specification:
 * `{ title: "Report Title", pages: [{ heading: "Section 1", lines: ["Line A", "Line B"] }] }`
 */
function buildPdfReportBuffer(spec) {
  const title = String(spec?.title || "Kosmora Executive Report");
  const rawPages =
    Array.isArray(spec?.pages) && spec.pages.length > 0
      ? spec.pages
      : [{ heading: title, lines: Array.isArray(spec?.lines) ? spec.lines : [] }];

  // Object allocation:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica)
  // 4: Font F2 (Helvetica-Bold)
  // For each page i (0..N-1):
  //   pageObjId = 5 + i * 2
  //   contentObjId = 6 + i * 2
  const objects = new Map();

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageKids = [];

  for (let i = 0; i < rawPages.length; i++) {
    const pageSpec = rawPages[i];
    const pageObjId = 5 + i * 2;
    const contentObjId = 6 + i * 2;
    pageKids.push(`${pageObjId} 0 R`);

    const streamLines = [];
    streamLines.push("BT");
    let y = 750;

    if (i === 0 && title) {
      streamLines.push(`/F2 18 Tf`);
      streamLines.push(`50 ${y} Td`);
      streamLines.push(`(${escapePdfLiteral(title)}) Tj`);
      y -= 30;
    } else {
      streamLines.push(`50 ${y} Td`);
    }

    if (pageSpec.heading && pageSpec.heading !== title) {
      streamLines.push(`/F2 14 Tf`);
      streamLines.push(`0 -24 Td`);
      streamLines.push(`(${escapePdfLiteral(pageSpec.heading)}) Tj`);
    }

    streamLines.push(`/F1 11 Tf`);
    const lines = Array.isArray(pageSpec.lines) ? pageSpec.lines : [];
    for (const line of lines) {
      streamLines.push(`0 -18 Td`);
      streamLines.push(`(${escapePdfLiteral(line)}) Tj`);
    }

    streamLines.push("ET");
    const streamBody = streamLines.join("\n");
    const streamByteLen = Buffer.byteLength(streamBody, "latin1");

    objects.set(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    objects.set(
      contentObjId,
      `<< /Length ${streamByteLen} >>\nstream\n${streamBody}\nendstream`
    );
  }

  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageKids.join(" ")}] /Count ${rawPages.length} >>`
  );

  const totalObjCount = 4 + rawPages.length * 2;
  const parts = [];
  const offsets = new Map();
  let currentOffset = 0;

  const pushStr = (s) => {
    const buf = Buffer.from(s, "latin1");
    parts.push(buf);
    currentOffset += buf.length;
  };

  pushStr("%PDF-1.4\n");

  for (let objId = 1; objId <= totalObjCount; objId++) {
    offsets.set(objId, currentOffset);
    const body = objects.get(objId);
    pushStr(`${objId} 0 obj\n${body}\nendobj\n`);
  }

  const xrefOffset = currentOffset;
  pushStr(`xref\n0 ${totalObjCount + 1}\n`);
  pushStr(`0000000000 65535 f \n`);
  for (let objId = 1; objId <= totalObjCount; objId++) {
    const off = String(offsets.get(objId)).padStart(10, "0");
    pushStr(`${off} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.concat(parts);
}

/**
 * Writes a native PDF 1.4 report safely into the connected Koswork workspace folder.
 */
function savePdfReportToWorkspace(options) {
  const workspaceRoot = options.workspaceRoot;
  const relativePath = String(options.relativePath || "Koswork-Report.pdf");

  if (!relativePath.toLowerCase().endsWith(".pdf")) {
    throw new Error("INVALID_PDF_EXTENSION: Report filename must end with .pdf");
  }

  const { canonicalRoot } = pathGuard.inspectRootDirectory(workspaceRoot);
  const resolvedTarget = pathGuard.resolveSafeWorkspaceTarget(canonicalRoot, relativePath, {
    allowMissingLeaf: true,
    allowMissingParents: true
  }).absolutePath;

  const pdfBuf = buildPdfReportBuffer(options.pdfSpec || {});
  const sha256 = crypto.createHash("sha256").update(pdfBuf).digest("hex");

  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
  fs.writeFileSync(resolvedTarget, pdfBuf);

  return {
    saved: true,
    format: "pdf",
    relativePath,
    absolutePath: resolvedTarget,
    sizeBytes: pdfBuf.length,
    sha256
  };
}

module.exports = {
  buildPdfReportBuffer,
  savePdfReportToWorkspace
};
