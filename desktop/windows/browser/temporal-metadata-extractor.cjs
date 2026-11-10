"use strict";

const { normalizeDateCandidate } = require("./document.cjs");

/**
 * Koswork Structured Temporal & Schema.org / JSON-LD Metadata Extractor
 * (`desktop/windows/browser/temporal-metadata-extractor.cjs`).
 *
 * Deepens Requirement #3:
 * "Дата на странице, дата события и дата получения — разные поля, если они известны."
 *
 * Extracts and normalizes distinct temporal fields from:
 * 1. `<script type="application/ld+json">` (`datePublished`, `dateModified`, `startDate`,
 *    `eventDate`, `temporalCoverage`, nested `@graph` arrays).
 * 2. Dublin Core / OpenGraph `<meta>` tags (`article:published_time`, `DC.date.issued`,
 *    `event-date`, `last-modified`).
 * 3. Semantic HTML `<time datetime="..." data-role="page-date|event-date">` elements.
 * 4. Visible Russian and English prose patterns (`"Опубликовано: ..."`, `"Дата события: ..."`).
 *
 * Never collapses `pageDate`, `eventDate`, and `fetchedAt` into a single timestamp.
 */
function extractJsonLdBlocks(html = "") {
  const blocks = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        blocks.push(...parsed);
      } else if (parsed && Array.isArray(parsed["@graph"])) {
        blocks.push(...parsed["@graph"]);
      } else if (parsed && typeof parsed === "object") {
        blocks.push(parsed);
      }
    } catch {
      // Ignore malformed JSON-LD blocks safely
    }
  }
  return blocks;
}

function extractTimeElements(html = "") {
  const results = [];
  const regex = /<time\b([^>]*)>([\s\S]*?)<\/time>/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null) {
    const attrs = match[1] || "";
    const innerText = match[2].replace(/<[^>]+>/g, " ").trim();
    const dtMatch = attrs.match(/\bdatetime=["']([^"']+)["']/i);
    const roleMatch = attrs.match(/\b(?:data-role|itemprop|property)=["']([^"']+)["']/i);
    results.push({
      datetime: dtMatch ? dtMatch[1].trim() : null,
      role: roleMatch ? roleMatch[1].trim().toLowerCase() : null,
      text: innerText
    });
  }
  return results;
}

function extractStructuredTemporalProvenance({
  html = "",
  text = "",
  explicitPageDate = null,
  explicitEventDate = null,
  fetchedAt = null
} = {}) {
  const resolvedFetchedAt = fetchedAt || new Date().toISOString();
  const dateSources = {
    pageDateSource: null,
    eventDateSource: null,
    fetchedAtSource: "browser_network_receipt"
  };

  let pageDate = normalizeDateCandidate(explicitPageDate);
  if (pageDate) {
    dateSources.pageDateSource = "explicit_input";
  }

  let eventDate = normalizeDateCandidate(explicitEventDate);
  if (eventDate) {
    dateSources.eventDateSource = "explicit_input";
  }

  let pageModifiedDate = null;

  // 1. Inspect JSON-LD blocks
  const jsonLdNodes = extractJsonLdBlocks(html);
  for (const node of jsonLdNodes) {
    if (!node || typeof node !== "object") continue;

    if (!pageDate) {
      const pubRaw = node.datePublished || node.dateCreated || node.uploadDate;
      const normPub = normalizeDateCandidate(pubRaw);
      if (normPub) {
        pageDate = normPub;
        dateSources.pageDateSource = "json_ld_datePublished";
      }
    }

    if (!pageModifiedDate && node.dateModified) {
      pageModifiedDate = normalizeDateCandidate(node.dateModified);
    }

    if (!eventDate) {
      const evRaw =
        node.startDate ||
        node.eventDate ||
        node.temporalCoverage ||
        (node.about && (node.about.startDate || node.about.eventDate));
      const normEv = normalizeDateCandidate(evRaw);
      if (normEv) {
        eventDate = normEv;
        dateSources.eventDateSource = "json_ld_eventDate";
      }
    }
  }

  // 2. Inspect `<time datetime="...">` elements
  const timeEls = extractTimeElements(html);
  for (const t of timeEls) {
    const candidate = normalizeDateCandidate(t.datetime || t.text);
    if (!candidate) continue;
    const role = String(t.role || "");
    if (!eventDate && (role.includes("event") || role.includes("startdate") || role.includes("effective"))) {
      eventDate = candidate;
      dateSources.eventDateSource = "html_time_element";
    } else if (!pageDate && (role.includes("publish") || role.includes("page") || role.includes("datepublished") || !role)) {
      pageDate = candidate;
      dateSources.pageDateSource = "html_time_element";
    }
  }

  // 3. Inspect Dublin Core / OpenGraph `<meta>` tags
  if (!pageDate) {
    const metaPub = String(html || "").match(
      /<meta\b[^>]+(?:name|property)=["'](?:article:published_time|DC\.date\.issued|publish-date|date)["'][^>]+content=["']([^"']+)["']/i
    );
    if (metaPub) {
      const norm = normalizeDateCandidate(metaPub[1]);
      if (norm) {
        pageDate = norm;
        dateSources.pageDateSource = "meta_tag";
      }
    }
  }

  if (!eventDate) {
    const metaEv = String(html || "").match(
      /<meta\b[^>]+(?:name|property)=["'](?:event-date|effective-date|DC\.date\.valid)["'][^>]+content=["']([^"']+)["']/i
    );
    if (metaEv) {
      const norm = normalizeDateCandidate(metaEv[1]);
      if (norm) {
        eventDate = norm;
        dateSources.eventDateSource = "meta_tag";
      }
    }
  }

  // 4. Inspect visible prose patterns
  const combinedText = `${text || ""}\n${String(html || "").replace(/<[^>]+>/g, " ")}`;
  if (!pageDate) {
    const m = combinedText.match(
      /(?:дата публикации|опубликовано|дата на странице|published(?:\s+on)?)\s*[:—-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\s+[а-яёa-z]+\s+[0-9]{4})/iu
    );
    if (m) {
      const norm = normalizeDateCandidate(m[1]);
      if (norm) {
        pageDate = norm;
        dateSources.pageDateSource = "visible_text";
      }
    }
  }

  if (!eventDate) {
    const m = combinedText.match(
      /(?:дата события|вступает в силу|событие от|действует с|event date|effective(?:\s+from)?)\s*[:—-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\s+[а-яёa-z]+\s+[0-9]{4})/iu
    );
    if (m) {
      const norm = normalizeDateCandidate(m[1]);
      if (norm) {
        eventDate = norm;
        dateSources.eventDateSource = "visible_text";
      }
    }
  }

  return {
    pageDate: pageDate || null,
    pageModifiedDate: pageModifiedDate || null,
    eventDate: eventDate || null,
    fetchedAt: resolvedFetchedAt,
    distinctFieldsVerified:
      pageDate !== resolvedFetchedAt && eventDate !== resolvedFetchedAt,
    dateSources
  };
}

module.exports = {
  extractJsonLdBlocks,
  extractTimeElements,
  extractStructuredTemporalProvenance
};
