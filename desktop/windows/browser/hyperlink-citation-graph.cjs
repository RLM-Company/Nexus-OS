"use strict";

const { evaluateNavigationPolicy } = require("./policy.cjs");

/**
 * Koswork Cross-Page Hyperlink Citation Graph & Primary Source Verifier
 * (`desktop/windows/browser/hyperlink-citation-graph.cjs`).
 *
 * Deepens Requirement #1, #2 & #3:
 * - Extracts outbound `<a href="...">` citation links from an open page's HTML along
 *   with each anchor's exact `[anchorStartUtf16, anchorEndUtf16]` code unit offsets
 *   in `snapshot.fullTextUtf16`.
 * - Resolves relative URLs against the page's base URL and filters out unsafe schemes.
 * - Follows an inline citation link from a secondary/review article to its cited primary
 *   source (`followAndVerifyPrimaryCitation`), verifying whether the primary source
 *   actually substantiates the claimed phrase with a verifiable UTF-16 excerpt!
 */

function extractOutboundCitationLinks(snapshot, rawHtml = "") {
  if (!snapshot || typeof snapshot.fullTextUtf16 !== "string") {
    throw new Error("CITATION_GRAPH_REQUIRES_SNAPSHOT");
  }

  const fullText = snapshot.fullTextUtf16;
  const baseUrl = snapshot.url || "https://corpus.local/";
  const links = [];

  const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  let searchFrom = 0;

  while ((match = aRegex.exec(String(rawHtml || ""))) !== null) {
    const attrs = match[1] || "";
    const anchorText = match[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch || !anchorText) continue;

    let resolvedUrl = null;
    try {
      const candidate = new URL(hrefMatch[1].trim(), baseUrl).toString();
      const policy = evaluateNavigationPolicy(candidate, { allowLocalLoopback: true });
      if (policy.allowed) {
        resolvedUrl = policy.normalizedUrl;
      }
    } catch {
      resolvedUrl = null;
    }

    if (!resolvedUrl) continue;

    const idx = fullText.indexOf(anchorText, searchFrom);
    const anchorStartUtf16 = idx >= 0 ? idx : fullText.indexOf(anchorText);
    const anchorEndUtf16 =
      anchorStartUtf16 >= 0 ? anchorStartUtf16 + anchorText.length : null;
    if (idx >= 0) {
      searchFrom = idx + anchorText.length;
    }

    links.push({
      linkIndex: links.length + 1,
      anchorText,
      targetUrl: resolvedUrl,
      sameOrigin:
        new URL(resolvedUrl).origin.toLowerCase() === new URL(baseUrl).origin.toLowerCase(),
      anchorStartUtf16: anchorStartUtf16 >= 0 ? anchorStartUtf16 : null,
      anchorEndUtf16
    });
  }

  return {
    sourceUrl: snapshot.url,
    pageVersion: snapshot.pageVersion,
    linksCount: links.length,
    links
  };
}

async function followAndVerifyPrimaryCitation({
  engine,
  sourceTabId,
  rawHtml = "",
  anchorOrUrlQuery,
  expectedPrimaryPhrase,
  primaryTabId = "tab-primary-citation",
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("PRIMARY_CITATION_VERIFIER_REQUIRES_ENGINE");
  }

  const sourceObs = engine.observePage(sourceTabId);
  const tab = engine.tabs.get(String(sourceTabId));
  const graph = extractOutboundCitationLinks(
    sourceObs.snapshot,
    rawHtml || tab?.rawSiteDef?.html || ""
  );

  const needle = String(anchorOrUrlQuery || "").trim().toLowerCase();
  const matchedLink = graph.links.find(
    (l) =>
      l.anchorText.toLowerCase().includes(needle) ||
      l.targetUrl.toLowerCase().includes(needle)
  );

  if (!matchedLink) {
    const err = new Error(`CITATION_LINK_NOT_FOUND_ON_PAGE: ${anchorOrUrlQuery}`);
    err.code = "CITATION_LINK_NOT_FOUND_ON_PAGE";
    throw err;
  }

  const secondaryExcerpt =
    matchedLink.anchorStartUtf16 !== null
      ? engine.extractExcerpt(sourceTabId, {
          searchTerm: matchedLink.anchorText
        })
      : null;

  const primaryNav = await engine.navigate({
    tabId: primaryTabId,
    url: matchedLink.targetUrl,
    actor: "agent",
    signal
  });

  if (!primaryNav.available) {
    return {
      status: "primary_source_unavailable",
      primarySourceSubstantiated: false,
      citationLink: matchedLink,
      secondarySource: {
        url: sourceObs.snapshot.url,
        title: sourceObs.snapshot.title,
        excerpt: secondaryExcerpt
      },
      primarySource: {
        url: primaryNav.url,
        httpStatus: primaryNav.httpStatus,
        available: false
      }
    };
  }

  const primaryExcerpt = expectedPrimaryPhrase
    ? engine.extractExcerpt(primaryTabId, { searchTerm: expectedPrimaryPhrase })
    : null;

  return {
    status: primaryExcerpt ? "primary_source_verified" : "primary_phrase_not_found",
    primarySourceSubstantiated: Boolean(primaryExcerpt),
    citationLink: matchedLink,
    secondarySource: {
      url: sourceObs.snapshot.url,
      title: sourceObs.snapshot.title,
      pageDate: sourceObs.snapshot.pageDate,
      eventDate: sourceObs.snapshot.eventDate,
      fetchedAt: sourceObs.snapshot.fetchedAt,
      excerpt: secondaryExcerpt
    },
    primarySource: {
      url: primaryNav.url,
      title: primaryNav.snapshot.title,
      httpStatus: primaryNav.httpStatus,
      available: primaryNav.available,
      pageDate: primaryNav.pageDate,
      eventDate: primaryNav.eventDate,
      fetchedAt: primaryNav.fetchedAt,
      excerpt: primaryExcerpt
    }
  };
}

module.exports = {
  extractOutboundCitationLinks,
  followAndVerifyPrimaryCitation
};
