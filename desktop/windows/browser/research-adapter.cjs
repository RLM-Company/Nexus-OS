"use strict";

const http = require("node:http");
const https = require("node:https");
const { stripHtmlTagsPreservingBlocks } = require("./document.cjs");

/**
 * Isolated Search / HTTP Provider Adapter (`desktop/windows/browser/research-adapter.cjs`).
 *
 * Rules:
 * - Never masks the origin of search results behind a fabricated "proprietary internet index".
 * - Explicitly records `providerId` (`"duckduckgo-html"`, `"local-http-search"`, `"synthetic-corpus-index"`)
 *   and `providerEndpoint` on every search response.
 * - Supports both live HTTP/HTTPS search endpoints and deterministic synthetic/local HTTP corpora.
 */

function parseDuckDuckGoHtmlSerp(html, baseOrigin = "https://html.duckduckgo.com") {
  const raw = String(html || "");
  const results = [];
  const blockRegex = /<div[^>]+class=["'][^"']*result\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  const linkRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  const snippetRegex = /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i;

  let match;
  while ((match = blockRegex.exec(raw)) !== null) {
    const chunk = match[1];
    const linkMatch = chunk.match(linkRegex);
    if (!linkMatch) continue;
    let href = linkMatch[1];
    try {
      const parsedHref = new URL(href, baseOrigin);
      const uddg = parsedHref.searchParams.get("uddg");
      if (uddg) href = uddg;
      else href = parsedHref.toString();
    } catch {
      /* keep raw href */
    }
    const title = stripHtmlTagsPreservingBlocks(linkMatch[2]);
    const snippetMatch = chunk.match(snippetRegex);
    const snippet = snippetMatch ? stripHtmlTagsPreservingBlocks(snippetMatch[1]) : "";
    if (href && title) {
      results.push({
        title,
        url: href,
        snippet
      });
    }
  }

  // Fallback generic `<a data-search-result="true" href="...">` parser for local HTTP SERP fixtures
  if (results.length === 0) {
    const genericRegex = /<article[^>]+data-serp-item=["']true["'][^>]*>([\s\S]*?)<\/article>/gi;
    let gMatch;
    while ((gMatch = genericRegex.exec(raw)) !== null) {
      const itemHtml = gMatch[1];
      const aMatch = itemHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      const pMatch = itemHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (aMatch) {
        results.push({
          url: aMatch[1],
          title: stripHtmlTagsPreservingBlocks(aMatch[2]),
          snippet: pMatch ? stripHtmlTagsPreservingBlocks(pMatch[1]) : ""
        });
      }
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

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "User-Agent": "KosworkBrowserResearch/1.0",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode || 200,
            headers: res.headers || {},
            url: targetUrl,
            body
          });
        });
      }
    );

    const onAbort = () => {
      req.destroy();
      const err = new Error("SEARCH_REQUEST_CANCELLED");
      err.code = "SEARCH_REQUEST_CANCELLED";
      reject(err);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("timeout", () => {
      req.destroy();
      const err = new Error(`HTTP_TIMEOUT: Request to ${targetUrl} timed out after ${timeoutMs}ms`);
      err.code = "HTTP_TIMEOUT";
      reject(err);
    });

    req.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    req.end();
  });
}

function createSearchProviderAdapter(options = {}) {
  const providerId = String(options.providerId || "duckduckgo-html");
  const searchEndpoint = String(options.searchEndpoint || "https://html.duckduckgo.com/html/");
  const customSearchFn = typeof options.searchFn === "function" ? options.searchFn : null;
  const syntheticCatalog = Array.isArray(options.syntheticCatalog) ? options.syntheticCatalog : null;
  const fixtureMap = new Map();

  function registerFixture(query, resultsOrSpec) {
    const key = String(query || "").trim().toLowerCase();
    const list = Array.isArray(resultsOrSpec)
      ? resultsOrSpec
      : Array.isArray(resultsOrSpec?.results)
      ? resultsOrSpec.results
      : [];
    fixtureMap.set(key, list);
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

    if (fixtureMap.has(trimmedQuery.toLowerCase())) {
      return {
        providerId,
        providerEndpoint: searchEndpoint,
        searchedAt,
        query: trimmedQuery,
        results: fixtureMap.get(trimmedQuery.toLowerCase())
      };
    }

    if (customSearchFn) {
      const rawResults = await customSearchFn(trimmedQuery, { signal, searchedAt });
      return {
        providerId,
        providerEndpoint: searchEndpoint,
        searchedAt,
        query: trimmedQuery,
        results: Array.isArray(rawResults) ? rawResults : []
      };
    }

    if (syntheticCatalog) {
      const queryTokens = trimmedQuery
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2);

      const scored = syntheticCatalog
        .map((entry) => {
          const haystack = `${entry.title || ""} ${entry.snippet || ""} ${(entry.keywords || []).join(" ")}`.toLowerCase();
          let hits = 0;
          for (const tok of queryTokens) {
            if (haystack.includes(tok)) hits += 1;
          }
          return {
            entry,
            hits: queryTokens.length === 0 ? 1 : hits
          };
        })
        .filter((item) => item.hits > 0 || syntheticCatalog.length <= 6)
        .sort((a, b) => b.hits - a.hits);

      return {
        providerId: options.providerId || "synthetic-corpus-adapter",
        providerEndpoint: "local://synthetic-corpus",
        searchedAt,
        query: trimmedQuery,
        results: scored.map((s) => ({
          title: s.entry.title,
          url: s.entry.url,
          snippet: s.entry.snippet || ""
        }))
      };
    }

    const urlObj = new URL(searchEndpoint);
    urlObj.searchParams.set("q", trimmedQuery);
    const httpRes = await fetchHttpRaw(urlObj.toString(), {
      timeoutMs: execOptions.timeoutMs ?? 6000,
      signal
    });

    let parsedResults = [];
    const contentType = String(httpRes.headers["content-type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      const json = JSON.parse(httpRes.body);
      parsedResults = Array.isArray(json.results) ? json.results : [];
    } else {
      parsedResults = parseDuckDuckGoHtmlHtmlOrSerp(httpRes.body, urlObj.origin);
    }

    return {
      providerId,
      providerEndpoint: urlObj.origin + urlObj.pathname,
      searchedAt,
      query: trimmedQuery,
      results: parsedResults
    };
  }

  return {
    providerId,
    searchEndpoint,
    registerFixture,
    registerFixtureQuery: registerFixture,
    executeQuery,
    fetchHttpRaw
  };
}

function parseDuckDuckGoHtmlHtmlOrSerp(body, origin) {
  return parseDuckDuckGoHtmlSerp(body, origin);
}

module.exports = {
  createSearchProviderAdapter,
  fetchHttpRaw,
  parseDuckDuckGoHtmlSerp
};
