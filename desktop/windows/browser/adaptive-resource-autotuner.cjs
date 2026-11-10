"use strict";

/**
 * Koswork Adaptive Memory Pressure & Latency Budget Auto-Tuner
 * (`desktop/windows/browser/adaptive-resource-autotuner.cjs`).
 *
 * Deepens Requirement #6:
 * "Оптимизировать ресурсы по измерениям: лимит живых вкладок, выгрузка фоновых,
 *  отмена незавершённого чтения/поиска, повторное использование допустимого снимка.
 *  Не обещать нулевую нагрузку; выдать фактические RAM/latency на одном наборе страниц."
 *
 * Inspects actual measured RAM (`currentRssMb`, `currentHeapUsedMb`) and latency
 * (`p95Ms`) from `engine.resourceGovernor.getResourceReport()`:
 * - When `currentRssMb > softRssBudgetMb` (or when `simulatedRssMb` exceeds budget),
 *   dynamically lowers `maxLiveTabs` (down to `minLiveTabs = 1`) and immediately
 *   hibernates the oldest live background tabs.
 * - When `p95Ms > softLatencyP95BudgetMs`, reduces recommended `longPageWindowChars`
 *   to keep incremental reads responsive.
 * - Never promises zero resource usage; always reports actual measured RSS MB and latency.
 */
class KosworkAdaptiveResourceAutotuner {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("AUTOTUNER_REQUIRES_ENGINE");
    }
    this.engine = options.engine;
    this.softRssBudgetMb = Number(options.softRssBudgetMb ?? 250);
    this.softLatencyP95BudgetMs = Number(options.softLatencyP95BudgetMs ?? 120);
    this.minLiveTabs = Math.max(1, Number(options.minLiveTabs ?? 1));
    this.maxLiveTabsCeiling = Math.max(
      this.minLiveTabs,
      Number(options.maxLiveTabsCeiling ?? this.engine.resourceGovernor.maxLiveTabs ?? 3)
    );
    this.tuningHistory = [];
  }

  evaluateAndTuneResources({ simulatedRssMb = null, simulatedP95Ms = null } = {}) {
    const gov = this.engine.resourceGovernor;
    const beforeReport = gov.getResourceReport();

    const effectiveRssMb =
      typeof simulatedRssMb === "number"
        ? simulatedRssMb
        : beforeReport.ramTelemetry.currentRssMb;
    const effectiveP95Ms =
      typeof simulatedP95Ms === "number"
        ? simulatedP95Ms
        : beforeReport.latencyTelemetry.p95Ms;

    const previousMaxLiveTabs = gov.maxLiveTabs;
    let nextMaxLiveTabs = previousMaxLiveTabs;
    let recommendedWindowChars = 4000;
    const newlyHibernatedTabIds = [];
    const actionsTaken = [];

    if (effectiveRssMb > this.softRssBudgetMb) {
      nextMaxLiveTabs = Math.max(this.minLiveTabs, previousMaxLiveTabs - 1);
      gov.maxLiveTabs = nextMaxLiveTabs;
      actionsTaken.push(
        `LOWER_MAX_LIVE_TABS (${previousMaxLiveTabs} -> ${nextMaxLiveTabs}) due to RSS ${effectiveRssMb} MB > ${this.softRssBudgetMb} MB`
      );

      // Evict oldest live tabs until liveTabs.size <= nextMaxLiveTabs
      while (gov.liveTabs.size > gov.maxLiveTabs) {
        let oldestId = null;
        let oldestTouch = Infinity;
        for (const [id, entry] of gov.liveTabs.entries()) {
          const touch = Number(entry?.lastActiveMs ?? entry?.lastTouchedAtMs ?? 0);
          if (oldestId === null || touch < oldestTouch) {
            oldestTouch = touch;
            oldestId = id;
          }
        }
        if (!oldestId) break;
        const evicted = gov.liveTabs.get(oldestId);
        gov.liveTabs.delete(oldestId);
        gov.hibernatedTabs.set(oldestId, {
          tabId: oldestId,
          url: evicted.url,
          pageVersion: evicted.pageVersion,
          hibernatedAtMs: Date.now()
        });
        const tabState = this.engine.tabs.get(oldestId);
        if (tabState && !tabState.closed) {
          tabState.hibernated = true;
        }
        newlyHibernatedTabIds.push(oldestId);
      }
    } else if (
      effectiveRssMb < this.softRssBudgetMb * 0.7 &&
      previousMaxLiveTabs < this.maxLiveTabsCeiling
    ) {
      nextMaxLiveTabs = Math.min(this.maxLiveTabsCeiling, previousMaxLiveTabs + 1);
      gov.maxLiveTabs = nextMaxLiveTabs;
      actionsTaken.push(
        `RESTORE_MAX_LIVE_TABS (${previousMaxLiveTabs} -> ${nextMaxLiveTabs})`
      );
    }

    if (effectiveP95Ms > this.softLatencyP95BudgetMs) {
      recommendedWindowChars = 2000;
      actionsTaken.push(
        `REDUCE_WINDOW_CHARS (4000 -> 2000) due to p95 latency ${effectiveP95Ms} ms > ${this.softLatencyP95BudgetMs} ms`
      );
    }

    const afterReport = gov.getResourceReport();
    const decision = {
      evaluatedAt: new Date().toISOString(),
      zeroOverheadClaimed: false,
      measuredRssMb: beforeReport.ramTelemetry.currentRssMb,
      effectiveRssMb,
      measuredLatencyP95Ms: beforeReport.latencyTelemetry.p95Ms,
      effectiveP95Ms,
      previousMaxLiveTabs,
      newMaxLiveTabs: gov.maxLiveTabs,
      liveTabCountAfterTune: afterReport.liveTabCount,
      hibernatedTabCountAfterTune: afterReport.hibernatedTabCount,
      newlyHibernatedTabIds,
      recommendedWindowChars,
      actionsTaken
    };

    this.tuningHistory.push(decision);
    return decision;
  }
}

module.exports = {
  KosworkAdaptiveResourceAutotuner
};
