"use strict";

/**
 * Koswork Bounded Concurrent Tab Scheduler & Domain Politeness Governor
 * (`desktop/windows/browser/concurrent-tab-scheduler.cjs`).
 *
 * Coordinates multi-site research openings and reads across up to `maxConcurrency`
 * worker slots (`<= engine.resourceGovernor.maxLiveTabs`, default 3):
 * 1. Enforces per-domain politeness spacing (`minDomainIntervalMs`) so rapid multi-page
 *    reads never flood a single host.
 * 2. Supports cooperative cancellation (`AbortSignal`) across queued and active items,
 *    preserving already-verified results when cancelled mid-batch.
 * 3. Records per-domain and batch-level scheduling telemetry.
 */
class KosworkBrowserTabScheduler {
  constructor(options = {}) {
    if (!options.engine) {
      throw new Error("TAB_SCHEDULER_REQUIRES_BROWSER_ENGINE");
    }
    this.engine = options.engine;
    const governorMax = Number(this.engine.resourceGovernor?.maxLiveTabs ?? 3);
    this.maxConcurrency = Math.max(
      1,
      Math.min(Number(options.maxConcurrency ?? governorMax), governorMax)
    );
    this.minDomainIntervalMs = Math.max(0, Number(options.minDomainIntervalMs ?? 25));
    this.lastDomainAccessMs = new Map(); // hostname -> timestampMs
  }

  async waitForDomainPoliteness(rawUrl, signal = null) {
    if (this.minDomainIntervalMs <= 0) return 0;

    let hostname = "local";
    try {
      hostname = new URL(String(rawUrl)).hostname.toLowerCase();
    } catch {
      hostname = "local";
    }

    const nowMs = Date.now();
    const lastMs = this.lastDomainAccessMs.get(hostname) ?? 0;
    const elapsed = nowMs - lastMs;
    const waitMs = Math.max(0, this.minDomainIntervalMs - elapsed);

    this.lastDomainAccessMs.set(hostname, nowMs + waitMs);

    if (waitMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer);
            const err = new Error("SCHEDULER_BATCH_CANCELLED");
            err.code = "SCHEDULER_BATCH_CANCELLED";
            return reject(err);
          }
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              const err = new Error("SCHEDULER_BATCH_CANCELLED");
              err.code = "SCHEDULER_BATCH_CANCELLED";
              reject(err);
            },
            { once: true }
          );
        }
      });
    }

    return waitMs;
  }

  /**
   * Executes a batch of source navigation & extraction tasks across bounded worker slots
   * (`maxConcurrency <= maxLiveTabs`).
   */
  async runSourceBatch(items = [], options = {}) {
    const signal = options.signal || null;
    const results = [];
    const cancelledUrls = [];
    let cursor = 0;
    let totalPolitenessWaitMs = 0;

    const worker = async (workerIndex) => {
      while (cursor < items.length) {
        if (signal?.aborted) {
          while (cursor < items.length) {
            const skipped = items[cursor++];
            cancelledUrls.push(skipped.url);
          }
          break;
        }

        const itemIndex = cursor++;
        const item = items[itemIndex];
        // Give each item its own tabId by default so background tab hibernation (`maxLiveTabs`) is exercised
        const slotTabId = item.tabId || `sched-tab-${itemIndex + 1}`;

        try {
          const waitedMs = await this.waitForDomainPoliteness(item.url, signal);
          totalPolitenessWaitMs += waitedMs;

          const nav = await this.engine.navigate({
            tabId: slotTabId,
            url: item.url,
            actor: item.actor || "agent",
            signal
          });

          const excerpts = [];
          if (nav.available && Array.isArray(item.extractTerms)) {
            for (const term of item.extractTerms) {
              const exc = this.engine.extractExcerpt(slotTabId, { searchTerm: term });
              if (exc) excerpts.push(exc);
            }
          }

          results.push({
            index: itemIndex,
            workerIndex,
            status: nav.available ? "ok" : "unavailable",
            tabId: slotTabId,
            url: nav.url,
            httpStatus: nav.httpStatus,
            available: nav.available,
            pageDate: nav.pageDate,
            eventDate: nav.eventDate,
            fetchedAt: nav.fetchedAt,
            tabReceipt: nav.tabReceipt,
            snapshot: nav.snapshot,
            excerpts
          });
        } catch (err) {
          if (
            signal?.aborted ||
            err?.code === "SCHEDULER_BATCH_CANCELLED" ||
            err?.code === "BROWSER_NAVIGATION_CANCELLED"
          ) {
            cancelledUrls.push(item.url);
          } else {
            throw err;
          }
        }
      }
    };

    const workerCount = Math.min(this.maxConcurrency, Math.max(1, items.length));
    const workers = Array.from({ length: workerCount }, (_, idx) => worker(idx + 1));
    await Promise.all(workers);

    results.sort((a, b) => a.index - b.index);
    const resourceMetrics = this.engine.resourceGovernor.getResourceReport();

    return {
      status: cancelledUrls.length > 0 && results.length === 0 ? "cancelled" : "completed",
      completedCount: results.length,
      cancelledCount: cancelledUrls.length,
      cancelledUrls,
      maxConcurrencyUsed: workerCount,
      totalPolitenessWaitMs,
      liveTabCountAfterBatch: this.engine.resourceGovernor.liveTabs.size,
      resourceMetrics,
      results
    };
  }

  async executeBatch(items = [], options = {}) {
    return this.runSourceBatch(items, options);
  }
}

module.exports = {
  KosworkBrowserTabScheduler
};
