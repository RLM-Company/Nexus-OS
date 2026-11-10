"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Heading-Outline (`<h1>..<h6>`) & Section-Scoped Long-Page Navigator
 * (`desktop/windows/browser/heading-outline-navigator.cjs`).
 *
 * Deepens Requirement #3:
 * "Довести чтение долгих/динамических страниц и навигацию по источникам. Уже есть
 *  versioned pages, UTF-16 offsets, bounds, recovery candidates, frames/shadow scope
 *  и устойчивые tab receipts. Сохрани эти свойства; добавляй только реальные пробелы."
 *
 * Capabilities:
 * 1. Builds a structured Table of Contents / Section Outline from HTML `<h1..h6>` tags
 *    or numbered/titled paragraphs in `snapshot.fullTextUtf16`, computing exact
 *    `[sectionStartUtf16, sectionEndUtf16]` UTF-16 code unit spans for every section.
 * 2. Allows direct navigation (`jumpToSectionByHeading`) to a target section on a long
 *    article without scanning irrelevant preceding text.
 * 3. Extracts UTF-16 excerpts strictly scoped to a matched section (`extractSectionScopedExcerpt`)
 *    so identical phrases appearing in different sections are never confused.
 */

function buildDocumentHeadingOutline(snapshot, rawHtml = "") {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("HEADING_OUTLINE_REQUIRES_SNAPSHOT");
  }

  const fullText = snapshot.fullTextUtf16;
  const discoveredHeadings = [];

  // 1. Parse explicit `<h1..h6>` headings from rawHtml if available and locate their UTF-16 offsets
  if (rawHtml && rawHtml.includes("<h")) {
    const hRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m;
    let searchFrom = 0;
    while ((m = hRegex.exec(String(rawHtml))) !== null) {
      const level = Number(m[1]);
      const titleText = m[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!titleText) continue;

      const idx = fullText.indexOf(titleText, searchFrom);
      if (idx >= 0) {
        discoveredHeadings.push({
          level,
          title: titleText,
          headingStartUtf16: idx,
          headingEndUtf16: idx + titleText.length
        });
        searchFrom = idx + titleText.length;
      }
    }
  }

  // 2. Fallback / supplement: detect numbered section headers in `snapshot.blocks` (e.g., "Раздел 12...", "Глава 3...", "## ...")
  if (discoveredHeadings.length === 0 && Array.isArray(snapshot.blocks)) {
    for (const blk of snapshot.blocks) {
      const text = String(blk.text || "").trim();
      const secMatch = text.match(
        /^(?:(?:#{1,6})\s+([^\n]+)|((?:Раздел|Глава|Секция|Section|Chapter)\s+\d+[^:\n]*[:]?))/i
      );
      if (secMatch) {
        const title = (secMatch[1] || secMatch[2] || text.slice(0, 80)).trim();
        discoveredHeadings.push({
          level: 2,
          title,
          headingStartUtf16: blk.startUtf16,
          headingEndUtf16: blk.startUtf16 + title.length
        });
      }
    }
  }

  discoveredHeadings.sort((a, b) => a.headingStartUtf16 - b.headingStartUtf16);

  const sections = discoveredHeadings.map((h, idx) => {
    // A section extends until the next heading of equal or higher importance (`level <= h.level`) or end of document
    let sectionEndUtf16 = fullText.length;
    for (let nextIdx = idx + 1; nextIdx < discoveredHeadings.length; nextIdx += 1) {
      if (discoveredHeadings[nextIdx].level <= h.level) {
        sectionEndUtf16 = discoveredHeadings[nextIdx].headingStartUtf16;
        break;
      }
    }
    return {
      sectionIndex: idx + 1,
      level: h.level,
      title: h.title,
      headingStartUtf16: h.headingStartUtf16,
      headingEndUtf16: h.headingEndUtf16,
      sectionStartUtf16: h.headingStartUtf16,
      sectionEndUtf16,
      sectionLengthUtf16: sectionEndUtf16 - h.headingStartUtf16
    };
  });

  return {
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    totalLengthUtf16: fullText.length,
    sectionCount: sections.length,
    sections
  };
}

function jumpToSectionByHeading({ snapshot, rawHtml = "", headingQuery } = {}) {
  const outline = buildDocumentHeadingOutline(snapshot, rawHtml);
  const needle = String(headingQuery || "").trim().toLowerCase();
  if (!needle) {
    throw new Error("HEADING_QUERY_REQUIRED");
  }

  const matched = outline.sections.find((s) => s.title.toLowerCase().includes(needle));
  if (!matched) {
    const err = new Error(`SECTION_HEADING_NOT_FOUND: ${headingQuery}`);
    err.code = "SECTION_HEADING_NOT_FOUND";
    throw err;
  }

  const sectionText = snapshot.fullTextUtf16.slice(
    matched.sectionStartUtf16,
    matched.sectionEndUtf16
  );

  return {
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    tabReceipt: snapshot.tabReceipt,
    pageDate: snapshot.pageDate,
    eventDate: snapshot.eventDate,
    fetchedAt: snapshot.fetchedAt,
    section: matched,
    sectionText
  };
}

function extractSectionScopedExcerpt({
  snapshot,
  rawHtml = "",
  headingQuery,
  searchTerm
} = {}) {
  const jumped = jumpToSectionByHeading({ snapshot, rawHtml, headingQuery });
  const needle = String(searchTerm || "").trim();
  if (!needle) {
    throw new Error("SECTION_EXCERPT_SEARCH_TERM_REQUIRED");
  }

  const relIdx = jumped.sectionText.toLowerCase().indexOf(needle.toLowerCase());
  if (relIdx < 0) {
    return null;
  }

  const absStartUtf16 = jumped.section.sectionStartUtf16 + relIdx;
  const absEndUtf16 = absStartUtf16 + needle.length;

  const excerpt = extractVerifiableExcerpt(snapshot, {
    startUtf16: absStartUtf16,
    endUtf16: absEndUtf16
  });

  return {
    ...excerpt,
    sectionTitle: jumped.section.title,
    sectionLevel: jumped.section.level,
    sectionStartUtf16: jumped.section.sectionStartUtf16,
    sectionEndUtf16: jumped.section.sectionEndUtf16
  };
}

module.exports = {
  buildDocumentHeadingOutline,
  jumpToSectionByHeading,
  extractSectionScopedExcerpt
};
