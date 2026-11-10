"use strict";

const fs = require("node:fs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");
const { buildVersionedPageSnapshot, extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Downloaded Specification Source Ingestor
 * (`desktop/windows/browser/downloaded-source-ingestor.cjs`).
 *
 * Converts a verified file downloaded into the allowed workspace download folder
 * (`.txt`, `.csv`, `.md`, `.json`, `.pdf`, `.docx`, `.xlsx`) into an addressable
 * versioned browser document snapshot with exact UTF-16 offsets (`startUtf16`, `endUtf16`),
 * so claims in a multi-site research report can cite verifiable excerpts from downloaded
 * files alongside live web pages.
 */
function ingestDownloadedSourceIntoResearchSnapshot(downloadRecord, options = {}) {
  if (!downloadRecord || !downloadRecord.resolvedPath) {
    throw new Error("INVALID_DOWNLOAD_RECORD_FOR_INGESTION");
  }

  const buffer = fs.readFileSync(downloadRecord.resolvedPath);
  const extracted = extractVaultDocument(buffer, {
    filename: downloadRecord.filename || downloadRecord.resolvedPath
  });

  const fetchedAt = options.fetchedAt || new Date().toISOString();
  const snapshot = buildVersionedPageSnapshot({
    tabId: options.tabId || downloadRecord.tabId || "tab-download",
    pageVersion: options.pageVersion || 1,
    url: downloadRecord.sourceUrl || `koswork://download/${downloadRecord.filename}`,
    canonicalUrl: downloadRecord.sourceUrl || `koswork://download/${downloadRecord.filename}`,
    httpStatus: 200,
    title: options.title || `Скачанный материал: ${downloadRecord.filename}`,
    pageDate: options.pageDate || null,
    eventDate: options.eventDate || null,
    fetchedAt,
    text: extracted.text || ""
  });

  snapshot.downloadedFileMetadata = {
    filename: downloadRecord.filename,
    resolvedPath: downloadRecord.resolvedPath,
    sizeBytes: downloadRecord.sizeBytes,
    sha256: downloadRecord.sha256,
    extractedFormat: extracted.format
  };

  return {
    snapshot,
    extractedFormat: extracted.format,
    extractExcerpt(queryOrSpan) {
      return extractVerifiableExcerpt(snapshot, queryOrSpan);
    }
  };
}

module.exports = {
  ingestDownloadedSourceIntoResearchSnapshot
};
