"use strict";

const { extractVerifiableExcerpt } = require("./document.cjs");

/**
 * Koswork Interactive User-Agent Co-Browsing & Handback Coordinator
 * (`desktop/windows/browser/co-browsing-handback.cjs`).
 *
 * Deepens Requirement #7:
 * "Сохранить возможность обычного просмотра пользователем и перехвата управления.
 *  Ручное действие делает старое наблюдение непригодным для дальнейшего ввода."
 *
 * Capabilities:
 * 1. Tracks manual user takeover actions (`user_edit`, `user_scroll`, `user_navigate`, `user_highlight`),
 *    immediately incrementing `userEpoch` so any stale agent `observedSnapshot` fails with
 *    `OBSERVATION_INVALIDATED_BY_USER` if used for subsequent agent input.
 * 2. Allows the user to highlight/select text on an open tab (`captureUserHighlightedExcerpt`)
 *    and attach it as a first-class UTF-16 verified excerpt with `actor: "user"`.
 * 3. Provides `reobserveAfterUserHandback(tabId)` so the agent cleanly acquires a fresh
 *    versioned snapshot aligned to the new `userEpoch` before resuming automated actions.
 */
class KosworkCoBrowsingCoordinator {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("CO_BROWSING_COORDINATOR_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.userHighlights = [];
    this.handbackLog = [];
  }

  /**
   * Simulates or records a manual user interaction in the tab (e.g. typing into a field,
   * toggling a filter, or scrolling manually), invalidating prior agent observations.
   */
  recordManualUserAction({ tabId, actionType = "user_manual_input", fieldChanges = null } = {}) {
    const takeoverRecord = typeof this.engine.recordUserAction === "function" ? this.engine.recordUserAction(tabId, actionType) : this.engine.userTakeover.recordManualUserAction(tabId, actionType);

    if (fieldChanges && typeof fieldChanges === "object") {
      const tab = this.engine.tabs.get(String(tabId));
      if (tab) {
        for (const [k, v] of Object.entries(fieldChanges)) {
          tab.formValues.set(String(k), v);
        }
      }
    }

    return {
      tabId: String(tabId),
      actionType,
      invalidatedPriorObservations: true,
      newUserEpoch: takeoverRecord.userEpoch,
      recordedAt: new Date().toISOString()
    };
  }

  /**
   * Captures a passage highlighted by the user during manual browsing as a verified
   * UTF-16 excerpt (`startUtf16`, `endUtf16`, `quote`, `actor: "user"`) linked to the tab's source.
   */
  captureUserHighlightedExcerpt({ tabId, selectedText } = {}) {
    if (!selectedText || !String(selectedText).trim()) {
      throw new Error("USER_HIGHLIGHT_TEXT_REQUIRED");
    }

    const obs = this.engine.observePage(tabId, { reuseSnapshot: false });
    const excerpt = extractVerifiableExcerpt(obs.snapshot, {
      searchTerm: String(selectedText).trim()
    });

    if (!excerpt) {
      const err = new Error("USER_HIGHLIGHT_NOT_FOUND_IN_SNAPSHOT");
      err.code = "USER_HIGHLIGHT_NOT_FOUND_IN_SNAPSHOT";
      throw err;
    }

    const enriched = {
      ...excerpt,
      actor: "user",
      tabId: String(tabId),
      url: obs.snapshot.url,
      title: obs.snapshot.title,
      pageDate: obs.snapshot.pageDate,
      eventDate: obs.snapshot.eventDate,
      fetchedAt: obs.snapshot.fetchedAt,
      userEpoch: obs.snapshot.userEpoch
    };

    this.userHighlights.push(enriched);
    return enriched;
  }

  /**
   * Performs a clean handback from manual user control back to the agent by forcing
   * a fresh observation at the current `userEpoch` and returning the updated snapshot
   * and tabReceipt for subsequent agent input.
   */
  reobserveAfterUserHandback(tabId) {
    const freshObs = this.engine.observePage(tabId, { reuseSnapshot: false });
    const entry = {
      tabId: String(tabId),
      url: freshObs.snapshot.url,
      pageVersion: freshObs.snapshot.pageVersion,
      userEpoch: freshObs.snapshot.userEpoch,
      snapshotId: freshObs.snapshot.snapshotId,
      handbackAt: new Date().toISOString()
    };
    this.handbackLog.push(entry);
    return {
      handbackCompleted: true,
      ...entry,
      snapshot: freshObs.snapshot,
      tabReceipt: freshObs.tabReceipt
    };
  }
}

module.exports = {
  KosworkCoBrowsingCoordinator
};
