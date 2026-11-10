"use strict";

const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { stripHtmlTagsPreservingBlocks } = require("./document.cjs");

/**
 * Isolated Search & HTTP Provider Adapter (`desktop/windows/browser/research-adapter.cjs`).
 *
 * Strict invariants (Queue Item #3):
 * - Never hides the search provider behind a fake "proprietary internet index".
 * - Never silently redirects to another search provider when the configured provider fails.
 * - Never fabricates search results on provider error (`SEARCH_PROVIDER_UNAVAILABLE`).
 * - Deduplicates search results by canonical URL and normalized content fingerprint.
 */

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "yclid", "mc_cid", "mc_eid", "ref"
]);

function normalizeCanonicalSearchUrl(rawUrl = "") {
  try {
    const u = new URL(String(rawUrl).trim());
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(rawUrl || "").trim();
  }
}

function computeContentFingerprint(text = "") {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return "";
  return crypto.createHash("sha256").update(tokens.join(" "), "utf8").digest("hex").slice(0, 16);
}

function deduplicateSearchResults(rawResults = []) {
  const seenCanonicalUrls = new Set();
  const seenContentFingerprints = new Set();
  const uniqueResults = [];
  const duplicatesRemoved = [];

  for (const item of rawResults || []) {
    const rawUrl = String(item?.url || "").trim();
    if (!rawUrl) continue;
    const canonicalUrl = normalizeCanonicalSearchUrl(rawUrl);
    const snippetFp = computeContentFingerprint(`${item.title || ""} ${item.snippet || ""}`);

    if (seenCanonicalUrls.has(canonicalUrl)) {
      duplicatesRemoved.push({
        url: rawUrl,
        canonicalUrl,
        reason: "duplicate_canonical_url"
      });
      continue;
    }

    if (snippetFp && seenContentFingerprints.has(snippetFp)) {
      duplicatesRemoved.push({
        url: rawUrl,
        canonicalUrl,
        reason: "duplicate_content_fingerprint"
      });
      continue;
    }

    seenCanonicalUrls.add(canonicalUrl);
    if (snippetFp) seenContentFingerprints.add(snippetFp);

    uniqueResults.push({
      ...item,
      url: rawUrl,
      canonicalUrl,
      contentFingerprint: snippetFp
    });
  }

  return {
    uniqueResults,
    duplicatesRemovedCount: duplicatesRemoved.length,
    duplicatesRemoved
  };
}

function parseSerpHtml(html, baseOrigin = "http://corpus.local") {
  const raw = String(html || "");
  const results = [];

  // 1. `<article data-serp-item="true">`
  const articleRegex = /<article[^>]+data-serp-item=["']true["'][^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(raw)) !== null) {
    const itemHtml = match[1];
    const aMatch = itemHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const pMatch = itemHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (aMatch) {
      let resolvedUrl = aMatch[1];
      try {
        resolvedUrl = new URL(aMatch[1], baseOrigin).toString();
      } catch {
        // keep as is
      }
      results.push({
        url: resolvedUrl,
        title: stripHtmlTagsPreservingBlocks(aMatch[2]),
        snippet: pMatch ? stripHtmlTagsPreservingBlocks(pMatch[1]) : ""
      });
    }
  }

  // 2. DuckDuckGo-style `.result__a`
  if (results.length === 0) {
    const blockRegex = /<div[^>]+class=["'][^"']*result\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    const linkRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
    const snippetRegex = /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i;
    while ((match = blockRegex.exec(raw)) !== null) {
      const chunk = match[1];
      const linkMatch = chunk.match(linkRegex);
      if (!linkMatch) continue;
      const title = stripHtmlTagsPreservingBlocks(linkMatch[2]);
      const snippetMatch = chunk.match(snippetRegex);
      const snippet = snippetMatch ? stripHtmlTagsPreservingBlocks(snippetMatch[1]) : "";
      results.push({
        url: linkMatch[1],
        title,
        snippet
      });
    }
  }

  return results;
}

function fetchHttpRaw(targetUrl, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 6000);
  const signal = options.signal || null;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("SEARCH_REQUEST_CANCELLED");
      err.code = "SEARCH_REQUEST_CANCELLED";
      return reject(err);
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }

    const requestHost =
      parsed.hostname === "corpus.local" ||
      parsed.hostname.endsWith(".corpus.local") ||
      parsed.hostname === "research.local" ||
      parsed.hostname.endsWith(".research.local")
        ? "127.0.0.1"
        : parsed.hostname;

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      {
        hostname: requestHost,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers: {
          Host: parsed.host,
          "User-Agent": "KosworkBrowserResearch/1.0",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          ...(options.headers || {})
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 200,
            headers: res.headers || {},
            body,
            url: targetUrl
          });
        });
      }
    );

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          const err = new Error("SEARCH_REQUEST_CANCELLED");
          err.code = "SEARCH_REQUEST_CANCELLED";
          req.destroy(err);
          reject(err);
        },
        { once: true }
      );
    }

    req.on("timeout", () => {
      const err = new Error(`HTTP_TIMEOUT: ${targetUrl}`);
      err.code = "HTTP_TIMEOUT";
      req.destroy(err);
    });
    req.on("error", reject);
    req.end();
  });
}

function createSearchProviderAdapter(options = {}) {
  const providerId = String(options.providerId || "local-http-search");
  let searchEndpoint = String(options.searchEndpoint || "http://corpus.local/search");
  const customSearchFn = typeof options.searchFn === "function" ? options.searchFn : null;

  function setSearchEndpoint(nextEndpoint) {
    searchEndpoint = String(nextEndpoint);
  }

  async function executeQuery(query, execOptions = {}) {
    const signal = execOptions.signal || null;
    if (signal?.aborted) {
      const err = new Error("SEARCH_REQUEST_CANCELLED");
      err.code = "SEARCH_REQUEST_CANCELLED";
      throw err;
    }

    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      const err = new Error("INVALID_SEARCH_QUERY_LENGTH");
      err.code = "INVALID_SEARCH_QUERY_LENGTH";
      throw err;
    }

    const searchedAt = execOptions.nowIso || new Date().toISOString();

    if (customSearchFn) {
      try {
        const rawResults = await customSearchFn(trimmedQuery, { signal, searchedAt });
        const dedup = deduplicateSearchResults(Array.isArray(rawResults) ? rawResults : []);
        return {
          providerId,
          providerEndpoint: searchEndpoint,
          searchedAt,
          query: trimmedQuery,
          results: dedup.uniqueResults,
          duplicatesRemovedCount: dedup.duplicatesRemovedCount,
          duplicatesRemoved: dedup.duplicatesRemoved
        };
      } catch (err) {
        const wrapped = new Error(
          `SEARCH_PROVIDER_UNAVAILABLE: Провайдер "${providerId}" вернул ошибку (${err.message}). Скрытое перенаправление и выдумывание результатов запрещены.`
        );
        wrapped.code = "SEARCH_PROVIDER_UNAVAILABLE";
        wrapped.providerId = providerId;
        wrapped.providerEndpoint = searchEndpoint;
        throw wrapped;
      }
    }

    let httpRes;
    try {
      const urlObj = new URL(searchEndpoint);
      urlObj.searchParams.set("q", trimmedQuery);
      if (execOptions.page) {
        urlObj.searchParams.set("page", String(execOptions.page));
      }
      httpRes = await fetchHttpRaw(urlObj.toString(), {
        timeoutMs: execOptions.timeoutMs ?? 6000,
        signal
      });
    } catch (err) {
      if (err.code === "SEARCH_REQUEST_CANCELLED") throw err;
      const wrapped = new Error(
        `SEARCH_PROVIDER_UNAVAILABLE: Сетевая ошибка поискового провайдера "${providerId}" (${searchEndpoint}): ${err.message}.`
      );
      wrapped.code = "SEARCH_PROVIDER_UNAVAILABLE";
      wrapped.providerId = providerId;
      wrapped.providerEndpoint = searchEndpoint;
      throw wrapped;
    }

    if (httpRes.status >= 400) {
      const err = new Error(
        `SEARCH_PROVIDER_UNAVAILABLE: Поисковый провайдер "${providerId}" вернул HTTP ${httpRes.status}. Скрытый fallback запрещён.`
      );
      err.code = "SEARCH_PROVIDER_UNAVAILABLE";
      err.httpStatus = httpRes.status;
      err.providerId = providerId;
      err.providerEndpoint = searchEndpoint;
      throw err;
    }

    let parsedResults = [];
    const contentType = String(httpRes.headers["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = JSON.parse(httpRes.body);
      parsedResults = Array.isArray(json.results) ? json.results : [];
    } else {
      const baseOrigin = new URL(searchEndpoint).origin;
      parsedResults = parseSerpHtml(httpRes.body, baseOrigin);
    }

    const dedup = deduplicateSearchResults(parsedResults);

    return {
      providerId,
      providerEndpoint: searchEndpoint,
      searchedAt,
      query: trimmedQuery,
      results: dedup.uniqueResults,
      duplicatesRemovedCount: dedup.duplicatesRemovedCount,
      duplicatesRemoved: dedup.duplicatesRemoved
    };
  }

  return {
    providerId,
    get searchEndpoint() {
      return searchEndpoint;
    },
    setSearchEndpoint,
    executeQuery,
    fetchHttpRaw
  };
}

module.exports = {
  computeContentFingerprint,
  createSearchProviderAdapter,
  deduplicateSearchResults,
  fetchHttpRaw,
  normalizeCanonicalSearchUrl,
  parseSerpHtml
};
