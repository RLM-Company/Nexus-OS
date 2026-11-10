"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork In-Page All-Occurrences UTF-16 Find & Highlighter
 * (`desktop/windows/browser/find-in-page-highlighter.cjs`).
 *
 * Deepens Requirement #3 & #7:
 * - Provides deterministic `Ctrl+F`-style search across `snapshot.fullTextUtf16`,
 *   returning every occurrence with exact `[startUtf16, endUtf16]` code unit offsets,
 *   surrounding context snippets (`contextBefore`, `matchedText`, `contextAfter`),
 *   and owning block metadata (`blockId`, `bounds`).
 * - Allows promoting any occurrence index (`occurrenceIndex`) directly into a
 *   cryptographically verified citation excerpt (`extractExcerptForOccurrence`).
 */
function findAllOccurrencesInSnapshot(
  snapshot,
  { query, contextWindowChars = 60, maxMatches = 100 } = {}
) {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("FIND_IN_PAGE_REQUIRES_SNAPSHOT");
  }
  const needle = String(query || "").trim();
  if (!needle) {
    throw new Error("FIND_IN_PAGE_QUERY_REQUIRED");
  }

  const fullText = snapshot.fullTextUtf16;
  const lowerFull = fullText.toLowerCase();
  const lowerNeedle = needle.toLowerCase();

  const matches = [];
  let cursor = 0;

  while (cursor < fullText.length && matches.length < maxMatches) {
    const idx = lowerFull.indexOf(lowerNeedle, cursor);
    if (idx < 0) break;

    const startUtf16 = idx;
    const endUtf16 = idx + needle.length;
    const matchedText = fullText.slice(startUtf16, endUtf16);

    const ctxStart = Math.max(0, startUtf16 - contextWindowChars);
    const ctxEnd = Math.min(fullText.length, endUtf16 + contextWindowChars);
    const contextBefore = fullText.slice(ctxStart, startUtf16);
    const contextAfter = fullText.slice(endUtf16, ctxEnd);

    const owningBlock = (snapshot.blocks || []).find(
      (b) => startUtf16 >= b.startUtf16 && endUtf16 <= b.endUtf16
    );

    matches.push({
      occurrenceIndex: matches.length + 1,
      startUtf16,
      endUtf16,
      lengthUtf16: endUtf16 - startUtf16,
      matchedText,
      contextBefore,
      contextAfter,
      blockId: owningBlock ? owningBlock.blockId : null,
      bounds: owningBlock ? owningBlock.bounds : null
    });

    cursor = endUtf16;
  }

  return {
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    query: needle,
    totalOccurrences: matches.length,
    matches
  };
}

function promoteOccurrenceToVerifiedExcerpt(
  snapshot,
  { query, occurrenceIndex = 1, expandToBlock = true } = {}
) {
  const found = findAllOccurrencesInSnapshot(snapshot, { query });
  const target = found.matches.find((m) => m.occurrenceIndex === Number(occurrenceIndex));
  if (!target) {
    const err = new Error(
      `FIND_OCCURRENCE_OUT_OF_RANGE: requested #${occurrenceIndex} of ${found.totalOccurrences} for "${query}"`
    );
    err.code = "FIND_OCCURRENCE_OUT_OF_RANGE";
    throw err;
  }

  if (expandToBlock && target.blockId) {
    const blk = (snapshot.blocks || []).find((b) => b.blockId === target.blockId);
    if (blk) {
      return extractVerifiableExcerpt(snapshot, {
        startUtf16: blk.startUtf16,
        endUtf16: blk.endUtf16
      });
    }
  }

  return extractVerifiableExcerpt(snapshot, {
    startUtf16: target.startUtf16,
    endUtf16: target.endUtf16
  });
}

module.exports = {
  findAllOccurrencesInSnapshot,
  promoteOccurrenceToVerifiedExcerpt
};
