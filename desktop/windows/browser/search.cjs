"use strict";

const { KosworkSearchAndBrowserStore } = require("./search-pagination-and-bookmarks.cjs");
const { createSearchProviderAdapter } = require("./research-adapter.cjs");
const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Browser Search & Result Navigation Controller (`desktop/windows/browser/search.cjs`).
 *
 * Connects user and agent search queries directly to the existing Koswork browser engine:
 * 1. Executes search via the isolated search adapter (`research-adapter.cjs`), preserving explicit
 *    provider provenance (`providerId`, `providerEndpoint`) — never claiming a fake "proprietary internet index".
 * 2. Stores and paginates SERP entries in `KosworkSearchAndBrowserStore` (`getSearchPage`, `nextSearchPage`).
 * 3. `openSearchResult` actually opens the target URL in the browser engine, records `url`, `title`,
 *    `fetchedAt`, `pageDate`, `eventDate`, and links any extracted excerpt (`excerptId`, `startUtf16`, `endUtf16`)
 *    back to the originating search and source receipt.
 */
class KosworkBrowserSearchService {
  constructor(options = {}) {
    this.store = options.store || new KosworkSearchAndBrowserStore();
    this.adapter = options.adapter || createSearchProviderAdapter(options.adapterOptions || {});
    this.engine = options.engine || null;
    this.openedSources = new Map(); // sourceVisitId -> provenance & excerpt linkages
  }

  attachEngine(engine) {
    this.engine = engine;
  }

  async search({
    query,
    actor = "agent",
    page = 1,
    pageSize = 5,
    signal = null,
    mockOrAdapterResults = null
  } = {}) {
    if (signal?.aborted) {
      const err = new Error("SEARCH_OPERATION_CANCELLED");
      err.code = "SEARCH_OPERATION_CANCELLED";
      throw err;
    }

    const normalizedActor = actor === "user" ? "user" : "agent";
    let providerResponse;
    if (Array.isArray(mockOrAdapterResults)) {
      providerResponse = {
        providerId: this.adapter.providerId || "explicit-results",
        providerEndpoint: this.adapter.searchEndpoint || "local://explicit",
        searchedAt: new Date().toISOString(),
        query: String(query || "").trim(),
        results: mockOrAdapterResults
      };
    } else {
      providerResponse = await this.adapter.executeQuery(query, { signal });
    }

    const paginated = this.store.recordAndPaginateSearch({
      query: providerResponse.query,
      results: providerResponse.results,
      page,
      pageSize,
      recordedAt: providerResponse.searchedAt
    });

    const journalEntry = this.store.searchJournal.find((s) => s.searchId === paginated.searchId);
    if (journalEntry) {
      journalEntry.providerId = providerResponse.providerId;
      journalEntry.providerEndpoint = providerResponse.providerEndpoint;
      journalEntry.actor = normalizedActor;
    }

    if (this.engine?.provenanceJournal) {
      this.engine.provenanceJournal.recordSearch({
        searchId: paginated.searchId,
        query: providerResponse.query,
        providerId: providerResponse.providerId,
        providerEndpoint: providerResponse.providerEndpoint,
        actor: normalizedActor,
        totalResults: paginated.totalResults,
        searchedAt: providerResponse.searchedAt
      });
    }

    return {
      ...paginated,
      actor: normalizedActor,
      providerId: providerResponse.providerId,
      providerEndpoint: providerResponse.providerEndpoint,
      searchedAt: providerResponse.searchedAt
    };
  }

  /**
   * Navigates to a specific SERP page (`page = 2, 3, ...`) for an existing `searchId`.
   */
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

  /**
   * Opens a search result in the attached browser engine (for both user clicks and agent navigation),
   * recording `url`, `title`, `fetchedAt`, `pageDate`, `eventDate`, and optional initial excerpt linkage.
   */
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
    if (signal?.aborted) {
      const err = new Error("SEARCH_RESULT_OPEN_CANCELLED");
      err.code = "SEARCH_RESULT_OPEN_CANCELLED";
      throw err;
    }

    let selectedItem = null;
    let journalEntry = null;
    if (searchId) {
      journalEntry = this.store.searchJournal.find((s) => s.searchId === String(searchId));
      if (!journalEntry) {
        const err = new Error("SEARCH_JOURNAL_ENTRY_NOT_FOUND");
        err.code = "SEARCH_JOURNAL_ENTRY_NOT_FOUND";
        throw err;
      }
      selectedItem =
        journalEntry.results.find((r) => Number(r.rank) === Number(rank)) ||
        (url ? journalEntry.results.find((r) => r.url === url) : null);
      if (!selectedItem && !url) {
        const err = new Error(`SEARCH_RESULT_RANK_NOT_FOUND: rank ${rank} in ${searchId}`);
        err.code = "SEARCH_RESULT_RANK_NOT_FOUND";
        throw err;
      }
    }

    const targetUrl = url || selectedItem?.url;
    if (!targetUrl) {
      throw new Error("SEARCH_RESULT_URL_MISSING");
    }

    const navResult = await this.engine.navigate({
      tabId,
      url: targetUrl,
      actor,
      signal,
      initiatedBySearchId: searchId || null,
      initiatedByRank: selectedItem ? selectedItem.rank : rank
    });

    const sourceVisitId = `src-${navResult.tabId}-v${
      navResult.snapshot?.pageVersion || 1
    }-${Date.now()}`;
    const linkedExcerpts = [];

    if (extractQuery && navResult.snapshot && navResult.httpStatus < 400) {
      const excerpt = extractVerifiableExcerpt(navResult.snapshot, {
        searchTerm: extractQuery
      });
      if (excerpt) {
        linkedExcerpts.push(excerpt);
      }
    }

    const sourceRecord = {
      sourceVisitId,
      searchId: searchId || null,
      searchQuery: journalEntry ? journalEntry.queryPreview : null,
      providerId: journalEntry
        ? journalEntry.providerId || journalEntry.engine
        : this.adapter.providerId,
      serpRank: selectedItem ? selectedItem.rank : rank,
      serpTitle: selectedItem ? selectedItem.title : null,
      serpSnippet: selectedItem ? selectedItem.snippet : null,
      actor: actor === "user" ? "user" : "agent",
      tabId: navResult.tabId,
      tabReceipt: navResult.tabReceipt,
      url: navResult.url,
      canonicalUrl: navResult.snapshot?.canonicalUrl || navResult.url,
      title: navResult.snapshot?.title || selectedItem?.title || navResult.url,
      httpStatus: navResult.httpStatus,
      available: navResult.available,
      pageDate: navResult.snapshot?.pageDate || null,
      eventDate: navResult.snapshot?.eventDate || null,
      fetchedAt: navResult.fetchedAt,
      linkedExcerpts
    };

    this.openedSources.set(sourceVisitId, sourceRecord);
    return sourceRecord;
  }

  /**
   * Links a newly extracted excerpt from an open page to its source provenance record.
   */
  linkExcerptToSource(sourceVisitId, excerpt) {
    const record = this.openedSources.get(String(sourceVisitId));
    if (!record) {
      throw new Error(`SOURCE_VISIT_NOT_FOUND: ${sourceVisitId}`);
    }
    if (excerpt && !record.linkedExcerpts.some((e) => e.excerptId === excerpt.excerptId)) {
      record.linkedExcerpts.push(excerpt);
    }
    return record;
  }

  getSourceRecord(sourceVisitId) {
    return this.openedSources.get(String(sourceVisitId)) || null;
  }

  listOpenedSources() {
    return Array.from(this.openedSources.values());
  }
}

module.exports = {
  KosworkBrowserSearchService
};
