"use strict";

const crypto = require("node:crypto");

/**
 * Koswork Versioned Page Snapshot, UTF-16 Excerpt & Long-Page Reader
 * (`desktop/windows/browser/document.cjs`).
 *
 * Preserves:
 * - `pageVersion`, `domEpoch`, `snapshotId`, `textSha256`, and stable `tabReceipt`
 * - Exact UTF-16 code-unit offsets (`startUtf16`, `endUtf16`) on all extracted excerpts and in-page search hits
 * - Distinct temporal fields: `pageDate` (date on page), `eventDate` (date of event), and `fetchedAt` (date retrieved)
 * - Explicit `readingLimitations` (`crossOriginFramesSkipped`, `truncatedLongPage`, `totalUtf16Length`)
 */

function stripHtmlTagsPreservingBlocks(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function extractTemporalMetadataFromHtmlOrText(html = "", text = "", explicit = {}) {
  let pageDate = explicit.pageDate || null;
  let eventDate = explicit.eventDate || null;

  if (!pageDate) {
    const metaMatch = String(html).match(
      /(?:article:published_time|datePublished|data-page-date)[^>]*?(\d{4}-\d{2}-\d{2})/i
    );
    if (metaMatch) pageDate = metaMatch[1];
  }
  if (!pageDate) {
    const textPubMatch = String(text).match(
      /(?:Опубликовано|Дата публикации|Published|Updated)[:\s]+(\d{4}-\d{2}-\d{2})/i
    );
    if (textPubMatch) pageDate = textPubMatch[1];
  }

  if (!eventDate) {
    const evMetaMatch = String(html).match(
      /(?:event:date|startDate|data-event-date)[^>]*?(\d{4}-\d{2}-\d{2})/i
    );
    if (evMetaMatch) eventDate = evMetaMatch[1];
  }
  if (!eventDate) {
    const textEvMatch = String(text).match(
      /(?:Дата события|Вступает в силу|Effective date|Event date)[:\s]+(\d{4}-\d{2}-\d{2})/i
    );
    if (textEvMatch) eventDate = textEvMatch[1];
  }

  return { pageDate, eventDate };
}

function buildVersionedPageSnapshot(rawPageData = {}, context = {}) {
  const tabId = String(context.tabId || rawPageData.tabId || "tab-1");
  const pageVersion = Number(context.pageVersion ?? rawPageData.pageVersion ?? 1);
  const domEpoch = Number(rawPageData.domEpoch ?? pageVersion);
  const url = String(context.url || rawPageData.url || "about:blank");
  const canonicalUrl = String(rawPageData.canonicalUrl || url).split("#")[0];
  const fetchedAt = String(context.fetchedAt || rawPageData.fetchedAt || new Date().toISOString());
  const httpStatus = Number(rawPageData.httpStatus ?? 200);

  const html = String(rawPageData.html || "");
  const baseText =
    typeof rawPageData.text === "string" && rawPageData.text.length > 0
      ? rawPageData.text
      : stripHtmlTagsPreservingBlocks(html);

  const frames = Array.isArray(rawPageData.frames) ? rawPageData.frames : [];
  const crossOriginFramesSkipped = Array.isArray(rawPageData.crossOriginFramesSkipped)
    ? rawPageData.crossOriginFramesSkipped
    : frames.filter((f) => f && f.sameOrigin === false);

  const fullTextUtf16 = String(baseText);
  const textSha256 = crypto.createHash("sha256").update(fullTextUtf16, "utf8").digest("hex");
  const snapshotId = `snap-${tabId}-v${pageVersion}-${textSha256.slice(0, 12)}`;
  const receiptId = `rcpt-${tabId}-v${pageVersion}-${crypto
    .createHash("sha256")
    .update(`${tabId}|${url}|${pageVersion}|${domEpoch}`, "utf8")
    .digest("hex")
    .slice(0, 10)}`;

  const { pageDate, eventDate } = extractTemporalMetadataFromHtmlOrText(html, fullTextUtf16, {
    pageDate: rawPageData.pageDate,
    eventDate: rawPageData.eventDate
  });

  const rawControls = Array.isArray(rawPageData.controls) ? rawPageData.controls : [];
  const controls = rawControls.map((c, idx) => ({
    elementRef: c.elementRef || `ref-${idx + 1}`,
    domEpoch: c.domEpoch ?? domEpoch,
    id: c.id || c.name || `ctrl-${idx + 1}`,
    name: c.name || null,
    tag: String(c.tag || "input").toLowerCase(),
    type: String(c.type || "text").toLowerCase(),
    role: String(c.role || c.tag || "generic").toLowerCase(),
    label: String(c.label || c.id || `ctrl-${idx + 1}`),
    value: c.value !== undefined ? String(c.value) : "",
    href: c.href || null,
    checked: Boolean(c.checked),
    disabled: Boolean(c.disabled),
    scope: c.scope || "main",
    bounds: c.bounds || { x: 16, y: 24 + idx * 32, width: 240, height: 28 }
  }));

  const tables = Array.isArray(rawPageData.tables) ? rawPageData.tables : [];

  const readingLimitations = {
    totalUtf16Length: fullTextUtf16.length,
    isLongPage: fullTextUtf16.length > 12000,
    crossOriginFramesSkippedCount: crossOriginFramesSkipped.length,
    crossOriginFramesSkipped,
    httpStatus,
    partialReadOnly: false
  };

  return {
    snapshotId,
    tabId,
    url,
    canonicalUrl,
    title: String(rawPageData.title || url),
    httpStatus,
    pageVersion,
    domEpoch,
    pageDate,
    eventDate,
    fetchedAt,
    text: fullTextUtf16,
    fullTextUtf16,
    totalLengthUtf16: fullTextUtf16.length,
    textSha256,
    html,
    controls,
    frames,
    tables,
    readingLimitations,
    scrollMetrics: rawPageData.scrollMetrics || {
      scrollTop: 0,
      scrollHeight: fullTextUtf16.length,
      clientHeight: 900
    },
    browserEngine: rawPageData.browserEngine || "Chromium-CDP",
    tabReceipt: {
      receiptId,
      tabId,
      url,
      pageVersion,
      domEpoch,
      snapshotId,
      fetchedAt
    }
  };
}

/**
 * Finds all in-page occurrences of `query` with exact UTF-16 `[startUtf16..endUtf16]` offsets.
 */
function findInPageTextOccurrences(snapshot, query, { contextRadius = 80 } = {}) {
  const fullText = String(snapshot?.fullTextUtf16 || snapshot?.text || "");
  const needle = String(query || "").trim();
  if (!needle || !fullText) {
    return { query: needle, totalMatches: 0, matches: [] };
  }

  const lowerFull = fullText.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  let pos = 0;

  while (pos < lowerFull.length) {
    const idx = lowerFull.indexOf(lowerNeedle, pos);
    if (idx === -1) break;
    const endIdx = idx + needle.length;
    const ctxStart = Math.max(0, idx - contextRadius);
    const ctxEnd = Math.min(fullText.length, endIdx + contextRadius);
    const quote = fullText.slice(ctxStart, ctxEnd).trim();
    const quoteStart = fullText.indexOf(quote, ctxStart);
    const quoteEnd = quoteStart + quote.length;

    matches.push({
      matchIndex: matches.length + 1,
      exactMatch: fullText.slice(idx, endIdx),
      matchStartUtf16: idx,
      matchEndUtf16: endIdx,
      contextQuote: quote,
      startUtf16: quoteStart,
      endUtf16: quoteEnd
    });
    pos = endIdx;
  }

  return {
    snapshotId: snapshot.snapshotId,
    pageVersion: snapshot.pageVersion,
    url: snapshot.url,
    query: needle,
    totalMatches: matches.length,
    matches
  };
}

/**
 * Extracts a verifiable UTF-16 excerpt (`[startUtf16..endUtf16]`) from `snapshot`.
 */
function extractVerifiableExcerpt(snapshot, options = {}) {
  const fullText = String(snapshot?.fullTextUtf16 || snapshot?.text || "");
  if (!fullText) {
    const err = new Error("EXCERPT_SOURCE_EMPTY");
    err.code = "EXCERPT_SOURCE_EMPTY";
    throw err;
  }

  let startUtf16 = -1;
  let endUtf16 = -1;

  if (
    Number.isInteger(options.startUtf16) &&
    Number.isInteger(options.endUtf16) &&
    options.startUtf16 >= 0 &&
    options.endUtf16 > options.startUtf16 &&
    options.endUtf16 <= fullText.length
  ) {
    startUtf16 = options.startUtf16;
    endUtf16 = options.endUtf16;
  } else {
    const searchTerm = String(options.searchTerm || options.query || "").trim();
    if (!searchTerm) {
      const err = new Error("EXCERPT_QUERY_REQUIRED");
      err.code = "EXCERPT_QUERY_REQUIRED";
      throw err;
    }
    const lowerText = fullText.toLowerCase();
    const hitIdx = lowerText.indexOf(searchTerm.toLowerCase());
    if (hitIdx === -1) {
      const err = new Error(`EXCERPT_NOT_FOUND_IN_SNAPSHOT: "${searchTerm}"`);
      err.code = "EXCERPT_NOT_FOUND_IN_SNAPSHOT";
      throw err;
    }

    // Expand to sentence or line boundaries around hitIdx
    let lineStart = hitIdx;
    while (lineStart > 0 && fullText[lineStart - 1] !== "\n" && fullText[lineStart - 1] !== ".") {
      lineStart -= 1;
    }
    let lineEnd = hitIdx + searchTerm.length;
    while (lineEnd < fullText.length && fullText[lineEnd] !== "\n" && fullText[lineEnd] !== ".") {
      lineEnd += 1;
    }
    if (lineEnd < fullText.length && fullText[lineEnd] === ".") {
      lineEnd += 1;
    }

    const rawSlice = fullText.slice(lineStart, lineEnd);
    const trimmed = rawSlice.trim();
    const leadingTrim = rawSlice.indexOf(trimmed);
    startUtf16 = lineStart + (leadingTrim >= 0 ? leadingTrim : 0);
    endUtf16 = startUtf16 + trimmed.length;
  }

  const quote = fullText.slice(startUtf16, endUtf16);
  const quoteSha256 = crypto.createHash("sha256").update(quote, "utf8").digest("hex");
  const excerptId = `exc-${snapshot.snapshotId}-${startUtf16}-${endUtf16}`;

  return {
    excerptId,
    snapshotId: snapshot.snapshotId,
    url: snapshot.url,
    title: snapshot.title,
    pageVersion: snapshot.pageVersion,
    domEpoch: snapshot.domEpoch,
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt,
    quote,
    startUtf16,
    endUtf16,
    quoteSha256,
    scope: options.scope || "main",
    readingLimitations: snapshot.readingLimitations || null
  };
}

/**
 * Reads a bounded UTF-16 window from a long page while tracking unread remainder and limitations.
 */
function readLongPageWindow(snapshot, options = {}) {
  const fullText = String(snapshot?.fullTextUtf16 || snapshot?.text || "");
  const totalLengthUtf16 = fullText.length;
  const cursorUtf16 = Math.max(0, Math.min(Number(options.cursorUtf16 ?? 0), totalLengthUtf16));
  const windowChars = Math.max(200, Math.min(Number(options.windowChars ?? 4000), 20000));
  const overlapChars = Math.max(0, Math.min(Number(options.overlapChars ?? 120), 1000));

  const endUtf16 = Math.min(totalLengthUtf16, cursorUtf16 + windowChars);
  const chunkText = fullText.slice(cursorUtf16, endUtf16);
  const hasMore = endUtf16 < totalLengthUtf16;
  const nextCursorUtf16 = hasMore ? Math.max(cursorUtf16 + 1, endUtf16 - overlapChars) : totalLengthUtf16;

  return {
    snapshotId: snapshot.snapshotId,
    url: snapshot.url,
    pageVersion: snapshot.pageVersion,
    startUtf16: cursorUtf16,
    endUtf16,
    chunkText,
    totalLengthUtf16,
    hasMore,
    nextCursorUtf16,
    readingLimitations: {
      ...(snapshot.readingLimitations || {}),
      windowedRead: true,
      unreadCharsRemaining: totalLengthUtf16 - endUtf16,
      truncated: hasMore
    }
  };
}

module.exports = {
  buildVersionedPageSnapshot,
  extractTemporalMetadataFromHtmlOrText,
  extractVerifiableExcerpt,
  findInPageTextOccurrences,
  readLongPageWindow,
  stripHtmlTagsPreservingBlocks
};
