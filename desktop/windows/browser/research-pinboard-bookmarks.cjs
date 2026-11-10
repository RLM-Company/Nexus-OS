"use strict";

/**
 * Koswork Bookmark & Reading-List Research Pinboard Bridge
 * (`desktop/windows/browser/research-pinboard-bookmarks.cjs`).
 *
 * Connects the browser's persistent bookmark store (`KosworkSearchAndBrowserStore` in
 * `search-pagination-and-bookmarks.cjs`) directly to the multi-site Browser Research Cycle:
 * 1. Allows users or agents to pin an open tab along with a verified UTF-16 excerpt,
 *    distinct `pageDate` / `eventDate` / `fetchedAt`, and research criterion tags.
 * 2. Filters pinned bookmarks by category or tag (`listPinnedResearchSources`).
 * 3. Builds a ready-to-execute multi-site research plan (`buildResearchPlanFromPinnedBookmarks`)
 *    from the user's pinned bookmarks so manual browsing discoveries feed directly into
 *    automated comparison reports.
 */
class KosworkResearchPinboardBridge {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("PINBOARD_BRIDGE_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.store = this.engine.searchService.store;
    this.pinnedMetadataByUrl = new Map(); // normalizedUrl -> { tags, optionName, criterion, excerpt, pageDate, eventDate, fetchedAt }
  }

  pinTabToResearchBookmarks({
    tabId,
    category = "research",
    tags = [],
    optionName = null,
    criterion = null,
    searchTerm = null
  } = {}) {
    const obs = this.engine.observePage(tabId);
    const snap = obs.snapshot;

    let excerpt = null;
    if (searchTerm) {
      excerpt = this.engine.extractExcerpt(tabId, { searchTerm });
    }

    const bookmark = this.store.addBookmark({
      url: snap.url,
      title: snap.title,
      category,
      tags
    });

    const richPin = {
      bookmarkId: bookmark.bookmarkId || bookmark.id || `bm-${Date.now()}`,
      url: bookmark.url,
      title: bookmark.title,
      category: bookmark.category,
      tags: bookmark.tags,
      optionName,
      criterion,
      pageDate: snap.pageDate,
      eventDate: snap.eventDate,
      fetchedAt: snap.fetchedAt,
      tabReceipt: snap.tabReceipt,
      excerpt
    };

    this.pinnedMetadataByUrl.set(bookmark.url, richPin);
    return richPin;
  }

  listPinnedResearchSources({ category = null, tag = null } = {}) {
    const bookmarks = this.store.listBookmarks({ category, tag });
    return bookmarks.map((b) => {
      const meta = this.pinnedMetadataByUrl.get(b.url) || {};
      return {
        ...b,
        optionName: meta.optionName || null,
        criterion: meta.criterion || null,
        pageDate: meta.pageDate || null,
        eventDate: meta.eventDate || null,
        fetchedAt: meta.fetchedAt || b.createdAt,
        excerpt: meta.excerpt || null
      };
    });
  }

  buildResearchPlanFromPinnedBookmarks({
    question = "Сравнение по закладкам исследования",
    category = "research",
    tag = null,
    defaultCriteria = ["Спецификация"]
  } = {}) {
    const pinned = this.listPinnedResearchSources({ category, tag });
    const criteriaSet = new Set(defaultCriteria);
    for (const p of pinned) {
      if (p.criterion) criteriaSet.add(p.criterion);
    }

    return {
      question,
      criteria: Array.from(criteriaSet),
      seedUrls: pinned.map((p) => p.url),
      preverifiedClaims: pinned
        .filter((p) => p.excerpt && p.optionName && p.criterion)
        .map((p, idx) => ({
          claimId: `pin-claim-${idx + 1}`,
          optionName: p.optionName,
          criterion: p.criterion,
          value: p.excerpt.quote,
          claim: `${p.optionName} (${p.criterion}): ${p.excerpt.quote}`,
          excerpt: p.excerpt,
          source: {
            url: p.url,
            title: p.title,
            pageDate: p.pageDate,
            eventDate: p.eventDate,
            fetchedAt: p.fetchedAt
          }
        }))
    };
  }
}

module.exports = {
  KosworkResearchPinboardBridge
};
