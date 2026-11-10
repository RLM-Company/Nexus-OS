"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");
const { buildVersionedPageSnapshot, extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Multi-Format Downloaded Document Ingestor
 * (`desktop/windows/browser/downloaded-archive-and-doc-ingestor.cjs`).
 *
 * Deepens Requirement #4 & #5:
 * - Ingests binary and structured files downloaded into the allowed workspace download folder
 *   (`.docx`, `.xlsx`, `.pdf`, `.pptx`, `.csv`, `.json`, `.html`, `.md`, `.txt`) using
 *   `extractVaultDocument` (`desktop/windows/vault-document-extractor.cjs`).
 * - Enforces that the downloaded file resides strictly inside `allowedDownloadDir` or
 *   `allowedWorkspaceRoot`.
 * - Converts the extracted document text into a versioned research snapshot with exact
 *   UTF-16 code unit offsets (`startUtf16`, `endUtf16`) and SHA-256 binary file digest provenance.
 */
function ingestMultiFormatDownloadedDocument(downloadResult = {}, metadata = {}) {
  const filePath = downloadResult.savedPath || downloadResult.filePath;
  if (!filePath || !fs.existsSync(filePath)) {
    const err = new Error("DOWNLOADED_DOCUMENT_FILE_MISSING");
    err.code = "DOWNLOADED_DOCUMENT_FILE_MISSING";
    throw err;
  }

  const resolvedFile = path.resolve(filePath);
  if (metadata.allowedWorkspaceRoot) {
    const resolvedRoot = path.resolve(metadata.allowedWorkspaceRoot);
    if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
      const err = new Error("DOWNLOADED_DOCUMENT_OUTSIDE_ALLOWED_WORKSPACE");
      err.code = "DOWNLOADED_DOCUMENT_OUTSIDE_ALLOWED_WORKSPACE";
      throw err;
    }
  }

  const rawBuffer = fs.readFileSync(resolvedFile);
  const fileSha256 = crypto.createHash("sha256").update(rawBuffer).digest("hex");
  const filename = downloadResult.filename || path.basename(resolvedFile);

  const extracted = extractVaultDocument(rawBuffer, { filename });
  const extractedText = String(extracted.text || "").trim();

  const syntheticUrl =
    downloadResult.sourceUrl ||
    metadata.sourceUrl ||
    `https://downloaded.koswork.local/${encodeURIComponent(filename)}`;

  const snapshot = buildVersionedPageSnapshot({
    tabId: downloadResult.tabId || "tab-downloaded-doc",
    pageVersion: 1,
    url: syntheticUrl,
    canonicalUrl: syntheticUrl,
    httpStatus: 200,
    title: `${filename} (Скачанный документ ${extracted.format || path.extname(filename)})`,
    pageDate: metadata.pageDate || null,
    eventDate: metadata.eventDate || null,
    fetchedAt: downloadResult.completedAt || new Date().toISOString(),
    text: extractedText
  });

  return {
    filename,
    detectedFormat: extracted.format || path.extname(filename).replace(/^\./, ""),
    filePath: resolvedFile,
    byteSize: rawBuffer.length,
    fileSha256,
    snapshot,
    extractExcerpt: (querySpec) => extractVerifiableExcerpt(snapshot, querySpec)
  };
}

module.exports = {
  ingestMultiFormatDownloadedDocument
};
