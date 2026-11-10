"use strict";

const { evaluateNavigationPolicy } = require("./policy.cjs");

/**
 * Koswork RSS 2.0 / Atom 1.0 / XML Sitemap Feed Ingestor & Source Navigator
 * (`desktop/windows/browser/rss-atom-sitemap-feed-ingestor.cjs`).
 *
 * Deepens Requirements #1, #2 & #3:
 * - Parses structured RSS 2.0 (`<item>`), Atom 1.0 (`<entry>`), and XML Sitemap (`<url>`)
 *   documents into verifiable source entries with distinct `pageDate` and `eventDate`
 *   fields and exact UTF-16 `[startUtf16..endUtf16]` offsets in the feed XML.
 * - Filters out unsafe/SSRF URLs via `evaluateNavigationPolicy`.
 * - Can automatically open the top matching feed entries in the browser engine and
 *   extract verifiable UTF-16 excerpts from each opened page.
 */

function stripXmlTags(str = "") {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIsoDateDay(rawDate = "") {
  const s = String(rawDate || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function extractXmlTagValue(block = "", tagName = "") {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = re.exec(block);
  return m ? stripXmlTags(m[1]) : "";
}

function extractAtomLinkHref(block = "") {
  const hrefMatch = block.match(/<link\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i);
  if (hrefMatch) {
    return (hrefMatch[1] || hrefMatch[2] || "").trim();
  }
  return extractXmlTagValue(block, "link");
}

function parseRssAtomOrSitemapFeed(rawXml = "", { allowLocalLoopback = true } = {}) {
  const xml = String(rawXml || "");
  const entries = [];
  const rejectedEntries = [];

  let feedType = "unknown";
  if (/<rss\b/i.test(xml) || /<channel\b/i.test(xml)) {
    feedType = "rss_2_0";
  } else if (/<feed\b/i.test(xml)) {
    feedType = "atom_1_0";
  } else if (/<urlset\b/i.test(xml)) {
    feedType = "xml_sitemap";
  }

  const blockRegex = /<(item|entry|url)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRegex.exec(xml)) !== null) {
    const kind = match[1].toLowerCase();
    const blockContent = match[2] || "";
    const startUtf16 = match.index;
    const endUtf16 = match.index + match[0].length;

    let rawUrl = "";
    let title = "";
    let summary = "";
    let rawPubDate = "";
    let rawEventDate = "";

    if (kind === "item") {
      rawUrl = extractXmlTagValue(blockContent, "link");
      title = extractXmlTagValue(blockContent, "title");
      summary = extractXmlTagValue(blockContent, "description");
      rawPubDate = extractXmlTagValue(blockContent, "pubDate");
      rawEventDate =
        extractXmlTagValue(blockContent, "koswork:eventDate") ||
        extractXmlTagValue(blockContent, "dc:date") ||
        rawPubDate;
    } else if (kind === "entry") {
      rawUrl = extractAtomLinkHref(blockContent);
      title = extractXmlTagValue(blockContent, "title");
      summary =
        extractXmlTagValue(blockContent, "summary") ||
        extractXmlTagValue(blockContent, "content");
      rawPubDate =
        extractXmlTagValue(blockContent, "updated") ||
        extractXmlTagValue(blockContent, "published");
      rawEventDate =
        extractXmlTagValue(blockContent, "published") || rawPubDate;
    } else if (kind === "url") {
      rawUrl = extractXmlTagValue(blockContent, "loc");
      title = extractXmlTagValue(blockContent, "title") || rawUrl;
      summary = extractXmlTagValue(blockContent, "description") || "";
      rawPubDate = extractXmlTagValue(blockContent, "lastmod");
      rawEventDate = rawPubDate;
    }

    try {
      const policy = evaluateNavigationPolicy(rawUrl, { allowLocalLoopback });
      entries.push({
        entryKind: kind,
        url: policy.normalizedUrl,
        title: title || policy.normalizedUrl,
        summary,
        pageDate: normalizeIsoDateDay(rawPubDate),
        eventDate: normalizeIsoDateDay(rawEventDate),
        startUtf16,
        endUtf16
      });
    } catch (err) {
      rejectedEntries.push({
        rawUrl,
        reason: err.code || "INVALID_FEED_ENTRY_URL"
      });
    }
  }

  return {
    feedType,
    totalEntries: entries.length,
    rejectedCount: rejectedEntries.length,
    entries,
    rejectedEntries
  };
}

async function ingestFeedAndOpenTopEntries({
  engine,
  rawXml = "",
  queryFilter = "",
  maxEntriesToOpen = 3,
  extractSearchTerm = null,
  signal = null
} = {}) {
  const parsed = parseRssAtomOrSitemapFeed(rawXml, {
    allowLocalLoopback: engine?.allowLocalLoopback !== false
  });
  const filterLower = String(queryFilter || "").trim().toLowerCase();

  const matching = parsed.entries.filter((e) => {
    if (!filterLower) return true;
    const hay = `${e.title} ${e.summary} ${e.url}`.toLowerCase();
    return hay.includes(filterLower);
  });

  const selected = matching.slice(0, Math.max(1, Number(maxEntriesToOpen || 3)));
  const openedResults = [];

  for (let i = 0; i < selected.length; i += 1) {
    const entry = selected[i];
    const tabId = `tab-feed-${i + 1}`;
    const nav = await engine.navigate({
      tabId,
      url: entry.url,
      signal
    });

    let excerpt = null;
    if (extractSearchTerm && nav.available) {
      try {
        excerpt = engine.extractExcerpt(tabId, { searchTerm: extractSearchTerm });
      } catch (_) {
        excerpt = null;
      }
    }

    openedResults.push({
      tabId,
      feedEntry: entry,
      url: nav.url,
      title: nav.snapshot?.title || entry.title,
      available: nav.available,
      httpStatus: nav.httpStatus,
      pageDate: nav.pageDate || entry.pageDate,
      eventDate: nav.eventDate || entry.eventDate,
      fetchedAt: nav.fetchedAt,
      excerpt
    });
  }

  return {
    feedType: parsed.feedType,
    totalFeedEntries: parsed.totalEntries,
    matchedEntriesCount: matching.length,
    openedCount: openedResults.length,
    openedResults
  };
}

module.exports = {
  parseRssAtomOrSitemapFeed,
  ingestFeedAndOpenTopEntries
};
