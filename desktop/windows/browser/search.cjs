"use strict";

const { KosworkSearchAndBrowserStore } = require("./search-pagination-and-bookmarks.cjs");
const {
  createSearchProviderAdapter,
  deduplicateSearchResults,
  computeContentFingerprint
} = require("./research-adapter.cjs");

/**
 * Koswork Browser Search & Source Collection Controller (`desktop/windows/browser/search.cjs`).
 *
 * Implements Queue Item #3:
 * - Multi-source search via configured search adapter (`research-adapter.cjs`)
 * - Deterministic SERP pagination (`page`, `pageSize`, `hasNextPage`)
 * - URL & content deduplication across SERP pages and opened page snapshots
 * - Explicit source unavailability tracking (`HTTP 503`, `HTTP 404`, network failure)
 * - Strict no-silent-redirect and no-fabricated-results when provider errors (`SEARCH_PROVIDER_UNAVAILABLE`)
 */
class KosworkBrowserSearchService {
  constructor(options = {}) {
    this.store = options.store || new KosworkSearchAndBrowserStore();
    this.adapter = options.adapter || createSearchProviderAdapter(options.adapterOptions || {});
    this.engine = options.engine || null;
    this.openedSources = new Map(); // visitId -> source visit record
    this.unavailableSources = []; // [{ url, httpStatus, reason, recordedAt }]
    this.openedContentFingerprints = new Map(); // contentFp -> firstUrl
  }

  attachEngine(engine) {
    this.engine = engine;
  }

  async search({
    query,
    actor = "agent",
    page = 1,
    pageSize = 5,
    signal = null
  } = {}) {
    if (signal?.aborted) {
      const err = new Error("SEARCH_OPERATION_CANCELLED");
      err.code = "SEARCH_OPERATION_CANCELLED";
      throw err;
    }

    const normalizedActor = actor === "user" ? "user" : "agent";
    // Execute directly against the configured provider — never mask errors or fabricate results
    const providerResponse = await this.adapter.executeQuery(query, {
      page,
      signal
    });

    const dedup = deduplicateSearchResults(providerResponse.results || []);
    const paginated = this.store.recordAndPaginateSearch({
      query: providerResponse.query,
      results: dedup.uniqueResults,
      page,
      pageSize,
      recordedAt: providerResponse.searchedAt
    });

    const journalEntry = this.store.searchJournal.find((s) => s.searchId === paginated.searchId);
    if (journalEntry) {
      journalEntry.providerId = providerResponse.providerId;
      journalEntry.providerEndpoint = providerResponse.providerEndpoint;
      journalEntry.actor = normalizedActor;
      journalEntry.duplicatesRemovedCount =
        (providerResponse.duplicatesRemovedCount || 0) + dedup.duplicatesRemovedCount;
    }

    return {
      ...paginated,
      actor: normalizedActor,
      providerId: providerResponse.providerId,
      providerEndpoint: providerResponse.providerEndpoint,
      searchedAt: providerResponse.searchedAt,
      duplicatesRemovedCount:
        (providerResponse.duplicatesRemovedCount || 0) + dedup.duplicatesRemovedCount
    };
  }

  getSearchPage(searchId, { page = 1, pageSize = 5 } = {}) {
    const journalEntry = this.store.searchJournal.find((s) => s.searchId === String(searchId));
    const pageData = this.store.getSearchPage(searchId, { page, pageSize });
    return {
      ...pageData,
      providerId: journalEntry?.providerId || this.adapter.providerId,
      providerEndpoint: journalEntry?.providerEndpoint || this.adapter.searchEndpoint,
      actor: journalEntry?.actor || "agent"
    };
  }

  async openSearchResult({
    searchId,
    rank = 1,
    url = null,
    tabId = null,
    actor = "agent",
    extractQuery = null,
    signal = null
  } = {}) {
    if (!this.engine) {
      throw new Error("BROWSER_ENGINE_NOT_ATTACHED_TO_SEARCH");
    }

    let targetUrl = url;
    let serpEntry = null;
    if (searchId) {
      const journal = this.store.searchJournal.find((s) => s.searchId === String(searchId));
      if (!journal) {
        const err = new Error(`SEARCH_JOURNAL_ENTRY_NOT_FOUND: ${searchId}`);
        err.code = "SEARCH_JOURNAL_ENTRY_NOT_FOUND";
        throw err;
      }
      serpEntry = journal.results.find((r) => r.rank === Number(rank)) || journal.results[0];
      if (!serpEntry && !targetUrl) {
        const err = new Error(`SERP_RANK_NOT_FOUND: rank=${rank}`);
        err.code = "SERP_RANK_NOT_FOUND";
        throw err;
      }
      if (!targetUrl && serpEntry) {
        targetUrl = serpEntry.url;
      }
    }

    const navResult = await this.engine.navigate({
      tabId,
      url: targetUrl,
      actor,
      signal,
      initiatedBySearchId: searchId || null,
      initiatedByRank: rank || null
    });

    if (!navResult.available) {
      const unavRecord = {
        url: navResult.url,
        title: serpEntry?.title || navResult.title || navResult.url,
        httpStatus: navResult.httpStatus,
        networkError: navResult.networkError || null,
        fetchedAt: navResult.fetchedAt,
        searchId: searchId || null,
        rank: rank || null,
        reason: navResult.networkError
          ? `Ошибка соединения: ${navResult.networkError}`
          : `Страница вернула HTTP ${navResult.httpStatus}`
      };
      this.unavailableSources.push(unavRecord);
    }

    const bodyFp = computeContentFingerprint(navResult.snapshot?.fullTextUtf16 || "");
    let duplicateContentOfUrl = null;
    if (bodyFp && navResult.available) {
      if (this.openedContentFingerprints.has(bodyFp)) {
        const firstUrl = this.openedContentFingerprints.get(bodyFp);
        if (firstUrl !== navResult.url) {
          duplicateContentOfUrl = firstUrl;
        }
      } else {
        this.openedContentFingerprints.set(bodyFp, navResult.url);
      }
    }

    let initialExcerpt = null;
    if (extractQuery && navResult.available) {
      try {
        initialExcerpt = this.engine.extractExcerpt(navResult.tabId, {
          searchTerm: extractQuery
        });
      } catch {
        initialExcerpt = null;
      }
    }

    const visitId = `visit-${Date.now()}-${this.openedSources.size + 1}`;
    const visitRecord = {
      visitId,
      searchId: searchId || null,
      serpRank: rank || null,
      tabId: navResult.tabId,
      url: navResult.url,
      canonicalUrl: navResult.snapshot?.canonicalUrl || navResult.url,
      title: navResult.snapshot?.title || serpEntry?.title || navResult.url,
      httpStatus: navResult.httpStatus,
      available: navResult.available,
      duplicateContentOfUrl,
      pageVersion: navResult.pageVersion,
      snapshotId: navResult.snapshot?.snapshotId || null,
      pageDate: navResult.pageDate || null,
      eventDate: navResult.eventDate || null,
      fetchedAt: navResult.fetchedAt,
      readingLimitations: navResult.snapshot?.readingLimitations || null,
      excerptIds: initialExcerpt ? [initialExcerpt.excerptId] : [],
      initialExcerpt
    };

    this.openedSources.set(visitId, visitRecord);
    return visitRecord;
  }
}

module.exports = {
  KosworkBrowserSearchService
};
