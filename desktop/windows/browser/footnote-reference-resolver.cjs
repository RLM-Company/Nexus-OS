"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Footnote, Endnote & Fine-Print Caveat Resolver
 * (`desktop/windows/browser/footnote-reference-resolver.cjs`).
 *
 * Deepens Requirement #3 & #5:
 * - Detects footnote markers (`[1]`, `[2]`, `[*]` or `<a href="#fn1">[1]</a>`) inside
 *   extracted body claims on long/technical/pricing pages.
 * - Locates the corresponding footnote definition block at the bottom of the page
 *   (e.g., `[1] Цена действует только при 3-летнем контракте от 100 узлов`) and
 *   extracts it as a linked UTF-16 `footnoteExcerpt` (`[startUtf16, endUtf16]`),
 *   so fine-print caveats are never silently omitted from a confirmed claim.
 */

function parseFootnotesFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("FOOTNOTE_RESOLVER_REQUIRES_SNAPSHOT");
  }

  const footnotesById = new Map();
  for (const blk of snapshot.blocks || []) {
    const text = String(blk.text || "").trim();
    // Match "[1] ...", "Примечание 1: ...", "* ..." at the start of a block
    const m = text.match(/^(?:\[(\d+|\*+)\]|Примечание\s+(\d+)\s*[:—-])\s*(.+)$/is);
    if (m) {
      const fnId = String(m[1] || m[2]).trim();
      const bodyText = m[3].trim();
      const excerpt = extractVerifiableExcerpt(snapshot, {
        startUtf16: blk.startUtf16,
        endUtf16: blk.endUtf16
      });
      footnotesById.set(fnId, {
        footnoteId: fnId,
        footnoteText: bodyText,
        fullBlockQuote: text,
        startUtf16: blk.startUtf16,
        endUtf16: blk.endUtf16,
        excerpt
      });
    }
  }

  return footnotesById;
}

function extractClaimWithResolvedFootnotes(snapshot, { searchTerm } = {}) {
  if (!snapshot) {
    throw new Error("FOOTNOTE_RESOLVER_REQUIRES_SNAPSHOT");
  }
  const primaryExcerpt = extractVerifiableExcerpt(snapshot, { searchTerm });
  if (!primaryExcerpt) {
    return null;
  }

  const footnotesMap = parseFootnotesFromSnapshot(snapshot);
  const referencedIds = [];
  const markerRegex = /\[(\d+|\*+)\]/g;
  let m;
  while ((m = markerRegex.exec(primaryExcerpt.quote)) !== null) {
    const id = m[1];
    if (!referencedIds.includes(id)) {
      referencedIds.push(id);
    }
  }

  const resolvedFootnotes = referencedIds
    .map((id) => footnotesMap.get(id))
    .filter(Boolean);

  return {
    primaryExcerpt,
    referencedFootnoteIds: referencedIds,
    resolvedFootnotesCount: resolvedFootnotes.length,
    resolvedFootnotes,
    combinedSummaryRu:
      resolvedFootnotes.length > 0
        ? `${primaryExcerpt.quote} (Сноска: ${resolvedFootnotes
            .map((f) => f.fullBlockQuote)
            .join("; ")})`
        : primaryExcerpt.quote
  };
}

module.exports = {
  parseFootnotesFromSnapshot,
  extractClaimWithResolvedFootnotes
};
