"use strict";

const { buildVersionedPageSnapshot } = require("./document.cjs");
const { evaluateNavigationPolicy } = require("./policy.cjs");

/**
 * Koswork SPA `pushState` / `replaceState` & Hash-Route Observer
 * (`desktop/windows/browser/spa-route-observer.cjs`).
 *
 * Deepens Requirement #3:
 * "Довести чтение долгих/динамических страниц и навигацию по источникам. Уже есть
 *  versioned pages, UTF-16 offsets, bounds, recovery candidates, frames/shadow scope
 *  и устойчивые tab receipts. Сохрани эти свойства; добавляй только реальные пробелы."
 *
 * Handles client-side Single-Page Application (SPA) route changes (`pushState`,
 * `replaceState`, `hashchange`) on an open tab:
 * 1. Validates the new route URL via `evaluateNavigationPolicy`.
 * 2. Increments `pageVersion` (`v -> v + 1`), builds a new versioned snapshot with
 *    recomputed UTF-16 offsets and a fresh `tabReceipt` bound to the new SPA URL.
 * 3. Updates `engine.tabNavigationStacks` (`push` for `pushState`/`hashchange`,
 *    in-place replacement for `replaceState`) so `engine.goBack()` / `engine.goForward()`
 *    traverse SPA states accurately.
 */
class KosworkSpaRouteObserver {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("SPA_ROUTE_OBSERVER_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.routeTransitions = [];
  }

  recordSpaRouteTransition({
    tabId,
    nextUrl,
    transitionKind = "pushState", // "pushState" | "replaceState" | "hashchange"
    nextTitle = null,
    nextText = null,
    nextHtml = null,
    pageDate = undefined,
    eventDate = undefined
  } = {}) {
    const key = String(tabId);
    const tab = this.engine.tabs.get(key);
    if (!tab || tab.closed) {
      const err = new Error(`TAB_LOST_OR_CLOSED: ${key}`);
      err.code = "TAB_LOST_OR_CLOSED";
      throw err;
    }

    const policy = evaluateNavigationPolicy(nextUrl, { allowLocalLoopback: true });
    const resolvedUrl = policy.normalizedUrl;

    const previousUrl = tab.url;
    const previousVersion = tab.pageVersion;
    const nextVersion = previousVersion + 1;

    const updatedSnapshot = buildVersionedPageSnapshot({
      tabId: key,
      pageVersion: nextVersion,
      url: resolvedUrl,
      canonicalUrl: resolvedUrl,
      httpStatus: 200,
      title: nextTitle || tab.snapshot.title,
      pageDate: pageDate !== undefined ? pageDate : tab.snapshot.pageDate,
      eventDate: eventDate !== undefined ? eventDate : tab.snapshot.eventDate,
      fetchedAt: new Date().toISOString(),
      html: nextHtml || undefined,
      text: nextText !== null ? nextText : tab.snapshot.fullTextUtf16,
      controls: tab.snapshot.controls
    });
    updatedSnapshot.userEpoch = this.engine.userTakeover.getCurrentEpoch(key);

    tab.url = resolvedUrl;
    tab.pageVersion = nextVersion;
    tab.snapshot = updatedSnapshot;
    tab.lastObservation = updatedSnapshot;

    // Register synthetic site state for back/forward traversal if not already registered
    this.engine.registerSyntheticSite(resolvedUrl, {
      title: updatedSnapshot.title,
      pageDate: updatedSnapshot.pageDate,
      eventDate: updatedSnapshot.eventDate,
      text: updatedSnapshot.fullTextUtf16
    });

    if (!this.engine.tabNavigationStacks.has(key)) {
      this.engine.tabNavigationStacks.set(key, {
        entries: [previousUrl],
        index: 0
      });
    }
    const navStack = this.engine.tabNavigationStacks.get(key);

    if (transitionKind === "replaceState") {
      if (navStack.index >= 0 && navStack.index < navStack.entries.length) {
        navStack.entries[navStack.index] = resolvedUrl;
      } else {
        navStack.entries.push(resolvedUrl);
        navStack.index = navStack.entries.length - 1;
      }
    } else {
      navStack.entries = navStack.entries.slice(0, navStack.index + 1);
      navStack.entries.push(resolvedUrl);
      navStack.index = navStack.entries.length - 1;
    }

    this.engine.resourceGovernor.invalidateSnapshotsForTab(key);
    this.engine.resourceGovernor.cacheSnapshot(updatedSnapshot);
    this.engine.provenanceJournal.recordSourceOpen({
      url: resolvedUrl,
      canonicalUrl: updatedSnapshot.canonicalUrl,
      title: updatedSnapshot.title,
      httpStatus: 200,
      available: true,
      pageVersion: updatedSnapshot.pageVersion,
      snapshotId: updatedSnapshot.snapshotId,
      tabReceiptId: updatedSnapshot.tabReceipt.receiptId,
      pageDate: updatedSnapshot.pageDate,
      eventDate: updatedSnapshot.eventDate,
      fetchedAt: updatedSnapshot.fetchedAt
    });

    const record = {
      tabId: key,
      transitionKind,
      previousUrl,
      nextUrl: resolvedUrl,
      previousPageVersion: previousVersion,
      pageVersion: nextVersion,
      tabReceipt: updatedSnapshot.tabReceipt,
      snapshot: updatedSnapshot,
      historyLength: navStack.entries.length,
      historyIndex: navStack.index
    };

    this.routeTransitions.push(record);
    return record;
  }
}

module.exports = {
  KosworkSpaRouteObserver
};
