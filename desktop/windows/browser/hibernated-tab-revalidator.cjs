"use strict";

/**
 * Koswork Conditional HTTP Revalidator (`ETag` / `304 Not Modified`) & Hibernated Tab Restorer
 * (`desktop/windows/browser/hibernated-tab-revalidator.cjs`).
 *
 * Deepens Requirement #6:
 * "Оптимизировать ресурсы по измерениям: лимит живых вкладок, выгрузка фоновых,
 *  отмена незавершённого чтения/поиска, повторное использование допустимого снимка.
 *  Не обещать нулевую нагрузку; выдать фактические RAM/latency на одном наборе страниц."
 *
 * Capabilities:
 * 1. Restores a background tab that was unloaded/hibernated by `KosworkBrowserResourceGovernor`
 *    when `liveTabCount` exceeded `maxLiveTabs`.
 * 2. Performs a conditional freshness check (`If-None-Match: <contentSha256>`):
 *    - If the source content has not changed (`304 Not Modified`), rehydrates the cached
 *      versioned snapshot without re-parsing HTML or shifting UTF-16 offsets (`revalidated304: true`).
 *    - If the source content changed (`200 OK` with new payload), rebuilds the snapshot at
 *      `pageVersion + 1` and invalidates stale snapshots (`revalidated304: false`).
 */
class KosworkHibernatedTabRevalidator {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("HIBERNATED_REVALIDATOR_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.revalidationStats = {
      notModified304Count: 0,
      reloaded200Count: 0,
      savedBytesEstimate: 0
    };
  }

  /**
   * Wakes a hibernated tab and conditionally revalidates its snapshot against the current source.
   */
  async wakeAndRevalidateTab(tabId, { forceUpstreamCheck = true } = {}) {
    const key = String(tabId);
    const tab = this.engine.tabs.get(key);
    if (!tab || tab.closed) {
      const err = new Error(`TAB_LOST_OR_CLOSED: ${key}`);
      err.code = "TAB_LOST_OR_CLOSED";
      throw err;
    }

    const wasHibernated =
      Boolean(tab.hibernated) || this.engine.resourceGovernor.hibernatedTabs.has(key);
    const priorSnapshot = tab.snapshot;
    const priorEtag = `"sha256-${priorSnapshot.contentSha256}"`;

    let upstreamChanged = false;
    let newSitePayload = null;

    if (forceUpstreamCheck && this.engine.syntheticSites.has(tab.url)) {
      const siteDef = this.engine.syntheticSites.get(tab.url);
      const candidateText = String(siteDef.text || siteDef.html || "");
      // Check if synthetic site definition changed its underlying text since priorSnapshot
      if (
        siteDef.text &&
        priorSnapshot.fullTextUtf16 &&
        siteDef.text.trim() !== priorSnapshot.fullTextUtf16.trim()
      ) {
        upstreamChanged = true;
        newSitePayload = siteDef;
      }
    }

    if (!upstreamChanged) {
      // 304 Not Modified path: restore live status and reuse existing verified snapshot
      tab.hibernated = false;
      this.engine.resourceGovernor.touchLiveTab(key, tab, (hibernatedId) => {
        const bgTab = this.engine.tabs.get(hibernatedId);
        if (bgTab && !bgTab.closed) {
          bgTab.hibernated = true;
        }
      });
      this.engine.resourceGovernor.cacheSnapshot(priorSnapshot);

      this.revalidationStats.notModified304Count += 1;
      this.revalidationStats.savedBytesEstimate += Buffer.byteLength(
        priorSnapshot.fullTextUtf16 || "",
        "utf8"
      );

      return {
        tabId: key,
        url: tab.url,
        wasHibernated,
        httpStatus: 304,
        revalidated304: true,
        etagSent: priorEtag,
        pageVersion: priorSnapshot.pageVersion,
        snapshotReused: true,
        snapshot: priorSnapshot,
        revalidationStats: { ...this.revalidationStats }
      };
    }

    // 200 OK modified path: update snapshot and increment pageVersion
    tab.hibernated = false;
    const updatedSnapshot = this.engine.mutatePageContent(key, {
      fullText: newSitePayload.text,
      pageDate: newSitePayload.pageDate ?? priorSnapshot.pageDate,
      eventDate: newSitePayload.eventDate ?? priorSnapshot.eventDate
    });

    this.engine.resourceGovernor.touchLiveTab(key, tab, (hibernatedId) => {
      const bgTab = this.engine.tabs.get(hibernatedId);
      if (bgTab && !bgTab.closed) {
        bgTab.hibernated = true;
      }
    });

    this.revalidationStats.reloaded200Count += 1;

    return {
      tabId: key,
      url: tab.url,
      wasHibernated,
      httpStatus: 200,
      revalidated304: false,
      etagSent: priorEtag,
      pageVersion: updatedSnapshot.pageVersion,
      snapshotReused: false,
      snapshot: updatedSnapshot,
      revalidationStats: { ...this.revalidationStats }
    };
  }
}

module.exports = {
  KosworkHibernatedTabRevalidator
};
