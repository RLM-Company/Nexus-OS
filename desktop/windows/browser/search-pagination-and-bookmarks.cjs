"use strict";

const crypto = require("node:crypto");

const MAX_QUERY_CHARS = 240;
const MAX_PAGE_SIZE = 5;
const MAX_STORED_SEARCHES = 100;
const MAX_ACTIVE_WEB_VIEWS = 3;

function sanitizeTextContent(raw) {
  return String(raw ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

/**
 * First-Party Search Journal, Deterministic SERP Paginator, Persistent Bookmarks,
 * and 3-View Resource/Token Telemetry for the Koswork Local Chromium Browser
 * (closes the remaining items in PR #415 `KOSWORK_OWN_SEARCH_2026-10-29_RU.md`
 * and `KOSWORK_BROWSER_FINISH_2026-10-29_RU.md`).
 */
class KosworkSearchAndBrowserStore {
  constructor() {
    this.searchJournal = [];
    this.bookmarks = new Map();
    this.visitHistory = [];
    this.activeViews = new Map();
  }

  recordAndPaginateSearch(input) {
    const rawQuery = sanitizeTextContent(input.query);
    if (!rawQuery || rawQuery.length > MAX_QUERY_CHARS) {
      const err = new Error("INVALID_SEARCH_QUERY_LENGTH");
      err.code = "INVALID_SEARCH_QUERY_LENGTH";
      throw err;
    }

    const allResults = Array.isArray(input.results) ? input.results : [];
    const sanitizedResults = allResults.map((r, idx) => {
      const url = String(r.url || "");
      let domain = "";
      try {
        domain = new URL(url).hostname;
      } catch {
        domain = "invalid-domain";
      }
      return {
        rank: idx + 1,
        title: sanitizeTextContent(r.title).slice(0, 200),
        domain,
        url,
        snippet: sanitizeTextContent(r.snippet).slice(0, 400)
      };
    });

    const querySha256 = crypto.createHash("sha256").update(rawQuery.toLowerCase(), "utf8").digest("hex");
    const searchId = `srch-${querySha256.slice(0, 16)}`;
    const now = input.recordedAt || new Date().toISOString();

    const existingIdx = this.searchJournal.findIndex((s) => s.searchId === searchId);
    const entry = {
      searchId,
      querySha256,
      queryPreview: rawQuery,
      engine: "duckduckgo",
      totalResults: sanitizedResults.length,
      results: sanitizedResults,
      navigationUrl: `koswork://search/${searchId}`, // Never leaks raw query text into Chromium history URL!
      recordedAt: now
    };

    if (existingIdx >= 0) {
      this.searchJournal.splice(existingIdx, 1);
    }
    this.searchJournal.unshift(entry);
    if (this.searchJournal.length > MAX_STORED_SEARCHES) {
      this.searchJournal.pop();
    }

    return this.getSearchPage(searchId, {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? MAX_PAGE_SIZE
    });
  }

  getSearchPage(searchId, options = {}) {
    const entry = this.searchJournal.find((s) => s.searchId === String(searchId));
    if (!entry) {
      const err = new Error("SEARCH_JOURNAL_ENTRY_NOT_FOUND");
      err.code = "SEARCH_JOURNAL_ENTRY_NOT_FOUND";
      throw err;
    }

    const pageSize = Math.max(1, Math.min(Number(options.pageSize) || MAX_PAGE_SIZE, MAX_PAGE_SIZE));
    const totalPages = Math.max(1, Math.ceil(entry.results.length / pageSize));
    const page = Math.max(1, Math.min(Number(options.page) || 1, totalPages));
    const start = (page - 1) * pageSize;
    const items = entry.results.slice(start, start + pageSize);

    return {
      searchId: entry.searchId,
      navigationUrl: entry.navigationUrl,
      engine: entry.engine,
      page,
      pageSize,
      totalPages,
      totalResults: entry.totalResults,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      items
    };
  }

  addBookmark(input) {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("BOOKMARK_REQUIRES_HTTP_HTTPS_URL");
    }
    const id = `bm-${crypto.createHash("sha256").update(url, "utf8").digest("hex").slice(0, 12)}`;
    const bookmark = {
      id,
      url,
      title: sanitizeTextContent(input.title || url).slice(0, 160),
      folder: sanitizeTextContent(input.folder || "Общие").slice(0, 64),
      createdAt: input.createdAt || new Date().toISOString()
    };
    this.bookmarks.set(id, bookmark);
    return bookmark;
  }

  listBookmarks() {
    return Array.from(this.bookmarks.values());
  }

  registerWebViewUsage(tabId, metrics) {
    this.activeViews.set(String(tabId), {
      tabId: String(tabId),
      ramMb: Number(metrics.ramMb ?? 0),
      cpuPercent: Number(metrics.cpuPercent ?? 0),
      domTokensEstimated: Number(metrics.domTokensEstimated ?? 0),
      lastActiveAt: Number(metrics.lastActiveAt ?? Date.now())
    });

    // Enforce the strict 3-loaded-WebContentsView cap from PR #415 by evicting oldest view
    const evictedTabIds = [];
    while (this.activeViews.size > MAX_ACTIVE_WEB_VIEWS) {
      let oldestTab = null;
      let oldestTime = Infinity;
      for (const [tid, v] of this.activeViews.entries()) {
        if (v.lastActiveAt < oldestTime) {
          oldestTime = v.lastActiveAt;
          oldestTab = tid;
        }
      }
      if (oldestTab) {
        this.activeViews.delete(oldestTab);
        evictedTabIds.push(oldestTab);
      } else {
        break;
      }
    }

    let totalRamMb = 0;
    let totalCpuPercent = 0;
    let totalDomTokens = 0;
    for (const v of this.activeViews.values()) {
      totalRamMb += v.ramMb;
      totalCpuPercent += v.cpuPercent;
      totalDomTokens += v.domTokensEstimated;
    }

    return {
      activeLoadedViews: this.activeViews.size,
      maxAllowedViews: MAX_ACTIVE_WEB_VIEWS,
      evictedTabIds,
      totalRamMb: Number(totalRamMb.toFixed(2)),
      totalCpuPercent: Number(totalCpuPercent.toFixed(2)),
      totalDomTokens
    };
  }
}

module.exports = {
  KosworkSearchAndBrowserStore,
  MAX_ACTIVE_WEB_VIEWS,
  MAX_PAGE_SIZE,
  MAX_QUERY_CHARS
};
