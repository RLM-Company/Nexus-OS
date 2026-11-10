"use strict";

const { canonicalizeSourceUrl } = require("./provenance-journal.cjs");
const { evaluateNavigationPolicy } = require("./policy.cjs");

/**
 * Koswork Multi-Query Research Decomposer, SERP Deduplicator & Redirect Provenance Tracker
 * (`desktop/windows/browser/query-decomposer-and-redirect-tracker.cjs`).
 *
 * Deepens Requirement #1 & #2:
 * - Decomposes a multi-option / multi-criterion research question into targeted search queries.
 * - Executes queries via `engine.searchService.search`, preserving explicit `providerId` and
 *   `providerEndpoint` for every sub-query (never hiding origin behind a fake index).
 * - Deduplicates SERP hits across sub-queries by canonical URL while retaining the full list of
 *   originating `(searchId, query, rank, providerId)` references.
 * - Follows and records bounded redirect chains (`301`/`302`/`307`/`308` or `<meta http-equiv="refresh">`)
 *   while enforcing `evaluateNavigationPolicy` on every hop to prevent SSRF via open redirects.
 */

function decomposeResearchQuestionIntoQueries({
  question = "",
  options = [],
  criteria = [],
  maxQueries = 6
} = {}) {
  const cleanQuestion = String(question || "").trim();
  const cleanOptions = (Array.isArray(options) ? options : [])
    .map((o) => String(o || "").trim())
    .filter(Boolean);
  const cleanCriteria = (Array.isArray(criteria) ? criteria : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);

  const queries = [];
  if (cleanQuestion) {
    queries.push({
      queryId: "q-primary",
      queryText: cleanQuestion,
      focusOption: null,
      focusCriteria: cleanCriteria
    });
  }

  for (const opt of cleanOptions) {
    const critSuffix = cleanCriteria.length ? ` ${cleanCriteria.join(" ")}` : "";
    const candidate = `${opt}${critSuffix}`.trim();
    if (candidate && !queries.some((q) => q.queryText.toLowerCase() === candidate.toLowerCase())) {
      queries.push({
        queryId: `q-opt-${queries.length + 1}`,
        queryText: candidate,
        focusOption: opt,
        focusCriteria: cleanCriteria
      });
    }
    if (queries.length >= maxQueries) break;
  }

  return queries.slice(0, maxQueries);
}

async function executeDecomposedSearchAndDeduplicate({
  engine,
  question,
  options = [],
  criteria = [],
  actor = "agent",
  signal = null
} = {}) {
  if (!engine || !engine.searchService) {
    throw new Error("DECOMPOSED_SEARCH_REQUIRES_ENGINE");
  }

  const subQueries = decomposeResearchQuestionIntoQueries({
    question,
    options,
    criteria
  });

  const searchRuns = [];
  const dedupedByCanonicalUrl = new Map();

  for (const sq of subQueries) {
    const res = await engine.searchService.search({
      query: sq.queryText,
      actor,
      signal
    });

    searchRuns.push({
      queryId: sq.queryId,
      queryText: sq.queryText,
      searchId: res.searchId,
      providerId: res.providerId,
      providerEndpoint: res.providerEndpoint,
      searchedAt: res.searchedAt,
      resultCount: (res.items || res.results || []).length
    });

    for (const item of res.items || res.results || []) {
      const canonical = canonicalizeSourceUrl(item.url);
      const provenanceRef = {
        searchId: res.searchId,
        queryText: sq.queryText,
        providerId: res.providerId,
        providerEndpoint: res.providerEndpoint,
        rank: item.rank,
        searchedAt: res.searchedAt
      };

      if (!dedupedByCanonicalUrl.has(canonical)) {
        dedupedByCanonicalUrl.set(canonical, {
          canonicalUrl: canonical,
          primaryUrl: item.url,
          title: item.title,
          snippet: item.snippet,
          publishedDate: item.publishedDate || null,
          matchedQueries: [provenanceRef]
        });
      } else {
        const existing = dedupedByCanonicalUrl.get(canonical);
        existing.matchedQueries.push(provenanceRef);
      }
    }
  }

  return {
    question,
    subQueries,
    searchRuns,
    deduplicatedResults: Array.from(dedupedByCanonicalUrl.values())
  };
}

/**
 * Navigates to `initialUrl` while resolving up to `maxRedirects` synthetic or meta-refresh
 * redirects, validating each hop's URL against `evaluateNavigationPolicy` (blocking SSRF redirects
 * to `file://`, `javascript:`, or disallowed private endpoints).
 */
async function navigateWithVerifiedRedirectChain({
  engine,
  tabId,
  initialUrl,
  actor = "agent",
  maxRedirects = 5,
  signal = null
} = {}) {
  if (!engine) {
    throw new Error("REDIRECT_TRACKER_REQUIRES_ENGINE");
  }

  const redirectChain = [];
  let currentUrl = String(initialUrl || "").trim();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    // Enforce navigation policy on every hop before opening (throws KosworkBrowserPolicyError on violation)
    const policyCheck = evaluateNavigationPolicy(currentUrl, {
      allowLocalLoopback: true
    });

    const siteDef = engine.syntheticSites.get(policyCheck.normalizedUrl);
    if (siteDef && siteDef.redirectTo) {
      const nextUrl = String(siteDef.redirectTo).trim();
      redirectChain.push({
        hop: hop + 1,
        fromUrl: policyCheck.normalizedUrl,
        toUrl: nextUrl,
        httpStatus: siteDef.httpStatus || 302,
        redirectType: "http_location"
      });
      currentUrl = nextUrl;
      continue;
    }

    const nav = await engine.navigate({
      tabId,
      url: currentUrl,
      actor,
      signal
    });

    // Check for `<meta http-equiv="refresh" content="0; url=...">` in raw HTML if present
    const rawHtml = String(siteDef?.html || "");
    const metaRefreshMatch = rawHtml.match(
      /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'\s>]+)["']/i
    );
    if (metaRefreshMatch && metaRefreshMatch[1]) {
      const nextUrl = metaRefreshMatch[1].trim();
      redirectChain.push({
        hop: hop + 1,
        fromUrl: nav.url,
        toUrl: nextUrl,
        httpStatus: 200,
        redirectType: "meta_refresh"
      });
      currentUrl = nextUrl;
      continue;
    }

    return {
      ...nav,
      initialRequestedUrl: initialUrl,
      finalResolvedUrl: nav.url,
      redirectCount: redirectChain.length,
      redirectChain
    };
  }

  const err = new Error(`MAX_REDIRECTS_EXCEEDED (${maxRedirects}) starting from ${initialUrl}`);
  err.code = "MAX_REDIRECTS_EXCEEDED";
  err.redirectChain = redirectChain;
  throw err;
}

module.exports = {
  decomposeResearchQuestionIntoQueries,
  executeDecomposedSearchAndDeduplicate,
  navigateWithVerifiedRedirectChain
};
