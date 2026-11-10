"use strict";

/**
 * Koswork Incremental Dynamic Page & Infinite-Scroll Reader
 * (`desktop/windows/browser/dynamic-page-scroller.cjs`).
 *
 * Completes Requirement #3 for dynamic/long pages:
 * - Drives multi-step dynamic content expansion (infinite scroll batches,
 *   "Load More" / "Показать ещё" triggers, or accordion expansions).
 * - Tracks monotonically increasing `pageVersion` (`v1 -> v2 -> ... -> vN`)
 *   and `contentSha256` across dynamic steps.
 * - Verifies that previously captured UTF-16 excerpts (`[startUtf16, endUtf16]`)
 *   remain intact at their original offsets when new sections are appended.
 * - Detects stabilization (`stabilized: true`) when a dynamic step yields no
 *   further content change.
 */
class KosworkDynamicPageScroller {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("DYNAMIC_SCROLLER_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.maxScrollSteps = Math.max(1, Number(options.maxScrollSteps ?? 8));
  }

  /**
   * Executes incremental dynamic steps on an open tab, verifying prior UTF-16
   * slices at each step and extracting newly revealed excerpts.
   */
  async readIncrementalDynamicPage({
    tabId,
    stepLoaders = [],
    extractTerms = [],
    signal = null
  } = {}) {
    const initialObs = this.engine.observePage(tabId);
    let currentSnapshot = initialObs.snapshot;

    const versionHistory = [
      {
        stepIndex: 0,
        pageVersion: currentSnapshot.pageVersion,
        snapshotId: currentSnapshot.snapshotId,
        contentSha256: currentSnapshot.contentSha256,
        totalLengthUtf16: currentSnapshot.totalLengthUtf16,
        pageDate: currentSnapshot.pageDate,
        eventDate: currentSnapshot.eventDate,
        fetchedAt: currentSnapshot.fetchedAt
      }
    ];

    const collectedExcerptsByTerm = new Map();
    const collectMatchingExcerpts = (stepIndex) => {
      for (const term of extractTerms) {
        if (collectedExcerptsByTerm.has(term)) continue;
        const exc = this.engine.extractExcerpt(tabId, { searchTerm: term });
        if (exc) {
          collectedExcerptsByTerm.set(term, {
            ...exc,
            discoveredAtStep: stepIndex,
            discoveredPageVersion: currentSnapshot.pageVersion
          });
        }
      }
    };

    collectMatchingExcerpts(0);

    let stabilized = false;
    let priorOffsetsIntact = true;
    const offsetIntegrityChecks = [];

    const maxSteps = Math.min(this.maxScrollSteps, stepLoaders.length);
    for (let i = 0; i < maxSteps; i += 1) {
      if (signal?.aborted) {
        const err = new Error("DYNAMIC_SCROLL_CANCELLED");
        err.code = "DYNAMIC_SCROLL_CANCELLED";
        throw err;
      }

      const prevSha = currentSnapshot.contentSha256;
      const stepSpec = stepLoaders[i];
      const deltaPayload = typeof stepSpec === "function" ? await stepSpec(currentSnapshot, i + 1) : stepSpec;

      if (!deltaPayload || (!deltaPayload.appendText && !deltaPayload.fullText && !deltaPayload.html)) {
        stabilized = true;
        break;
      }

      currentSnapshot = this.engine.mutatePageContent(tabId, deltaPayload);

      versionHistory.push({
        stepIndex: i + 1,
        pageVersion: currentSnapshot.pageVersion,
        snapshotId: currentSnapshot.snapshotId,
        contentSha256: currentSnapshot.contentSha256,
        totalLengthUtf16: currentSnapshot.totalLengthUtf16,
        pageDate: currentSnapshot.pageDate,
        eventDate: currentSnapshot.eventDate,
        fetchedAt: currentSnapshot.fetchedAt
      });

      if (currentSnapshot.contentSha256 === prevSha) {
        stabilized = true;
        break;
      }

      // Verify all previously discovered UTF-16 excerpts still match at their exact offsets
      for (const [term, priorExc] of collectedExcerptsByTerm.entries()) {
        const currentSlice = currentSnapshot.fullTextUtf16.slice(
          priorExc.startUtf16,
          priorExc.endUtf16
        );
        const intact = currentSlice === priorExc.quote;
        if (!intact) {
          priorOffsetsIntact = false;
        }
        offsetIntegrityChecks.push({
          stepIndex: i + 1,
          term,
          startUtf16: priorExc.startUtf16,
          endUtf16: priorExc.endUtf16,
          intact
        });
      }

      collectMatchingExcerpts(i + 1);
    }

    return {
      tabId,
      url: currentSnapshot.url,
      initialPageVersion: versionHistory[0].pageVersion,
      finalPageVersion: currentSnapshot.pageVersion,
      stepsExecuted: versionHistory.length - 1,
      stabilized,
      priorOffsetsIntact,
      offsetIntegrityChecks,
      versionHistory,
      excerpts: Array.from(collectedExcerptsByTerm.values()),
      finalSnapshot: currentSnapshot
    };
  }
}

module.exports = {
  KosworkDynamicPageScroller
};
