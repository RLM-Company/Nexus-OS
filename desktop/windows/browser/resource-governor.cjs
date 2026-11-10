"use strict";

const { MAX_ACTIVE_WEB_VIEWS } = require("./search-pagination-and-bookmarks.cjs");

/**
 * Koswork Browser Resource Governor & Telemetry Collector (`desktop/windows/browser/resource-governor.cjs`).
 *
 * Implements measurement-driven resource management:
 * 1. Enforces a live tab limit (`maxLiveTabs`, default 3), automatically hibernating/unloading
 *    least-recently-used background tabs while preserving their lightweight `tabReceipt` and
 *    snapshot metadata for seamless restoration.
 * 2. Reuses valid snapshots (`snapshotTtlMs`) when `url` and `pageVersion` match, avoiding
 *    redundant DOM serialization.
 * 3. Provides cooperative cancellation (`AbortController`) for in-flight page reads and searches.
 * 4. Measures actual process RAM (`rssBytes`, `heapUsedBytes`, `externalBytes`) and per-page
 *    navigation/read latency (`p50Ms`, `p95Ms`, `totalMs`) on a benchmark page set without promising "zero load".
 */

class KosworkBrowserResourceGovernor {
  constructor(options = {}) {
    this.maxLiveTabs = Math.max(1, Number(options.maxLiveTabs ?? MAX_ACTIVE_WEB_VIEWS));
    this.snapshotTtlMs = Math.max(0, Number(options.snapshotTtlMs ?? 30000));
    this.now = typeof options.now === "function" ? options.now : () => Date.now();

    this.liveTabs = new Map(); // tabId -> { tabId, url, lastActiveAt, estimatedDomBytes, status: 'live' }
    this.hibernatedTabs = new Map(); // tabId -> { tabId, url, tabReceipt, hibernatedAt, snapshotSummary }
    this.snapshotCache = new Map(); // cacheKey -> { snapshot, cachedAtMs }
    this.activeControllers = new Map(); // taskId -> { taskId, kind, controller, startedAtMs }
    this.latencySamples = [];
    this.memorySamples = [];
    this.hibernationEvents = [];
    this.snapshotReuseCount = 0;
    this.snapshotMissCount = 0;
  }

  sampleProcessMemory(label = "sample") {
    const usage = process.memoryUsage();
    const entry = {
      label,
      sampledAtMs: this.now(),
      rssMb: Number((usage.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((usage.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((usage.heapTotal / (1024 * 1024)).toFixed(2)),
      externalMb: Number((usage.external / (1024 * 1024)).toFixed(2)),
      liveTabCount: this.liveTabs.size,
      hibernatedTabCount: this.hibernatedTabs.size
    };
    this.memorySamples.push(entry);
    return entry;
  }

  /**
   * Registers or touches a live tab and unloads/hibernates the oldest background tab(s)
   * if `liveTabs.size > maxLiveTabs`.
   */
  touchLiveTab(tabId, tabState = {}, onHibernateCallback = null) {
    const key = String(tabId);
    const nowMs = this.now();

    if (this.hibernatedTabs.has(key)) {
      this.hibernatedTabs.delete(key);
    }

    const domChars = Number(tabState.snapshot?.totalUtf16CodeUnits || 0);
    this.liveTabs.set(key, {
      tabId: key,
      url: String(tabState.url || "about:blank"),
      lastActiveAt: nowMs,
      estimatedDomBytes: domChars * 2,
      tabReceipt: tabState.snapshot?.tabReceipt || tabState.tabReceipt || null,
      status: "live"
    });

    const newlyHibernated = [];
    while (this.liveTabs.size > this.maxLiveTabs) {
      let oldestId = null;
      let oldestTime = Infinity;
      for (const [id, info] of this.liveTabs.entries()) {
        if (id === key) continue;
        if (info.lastActiveAt < oldestTime) {
          oldestTime = info.lastActiveAt;
          oldestId = id;
        }
      }
      if (!oldestId) break;

      const evicted = this.liveTabs.get(oldestId);
      this.liveTabs.delete(oldestId);

      const hibRecord = {
        tabId: oldestId,
        url: evicted.url,
        tabReceipt: evicted.tabReceipt,
        hibernatedAtMs: nowMs,
        freedDomBytes: evicted.estimatedDomBytes,
        status: "hibernated"
      };
      this.hibernatedTabs.set(oldestId, hibRecord);
      this.hibernationEvents.push(hibRecord);
      newlyHibernated.push(oldestId);

      if (typeof onHibernateCallback === "function") {
        onHibernateCallback(oldestId, hibRecord);
      }
    }

    return {
      liveTabCount: this.liveTabs.size,
      maxLiveTabs: this.maxLiveTabs,
      hibernatedTabCount: this.hibernatedTabs.size,
      newlyHibernatedTabIds: newlyHibernated
    };
  }

  removeTab(tabId) {
    const key = String(tabId);
    this.liveTabs.delete(key);
    this.hibernatedTabs.delete(key);
    for (const cacheKey of this.snapshotCache.keys()) {
      if (cacheKey.startsWith(`${key}|`)) {
        this.snapshotCache.delete(cacheKey);
      }
    }
  }

  /**
   * Stores a versioned snapshot for reuse within `snapshotTtlMs`.
   */
  cacheSnapshot(snapshot) {
    if (!snapshot || !snapshot.tabId) return;
    const key = `${snapshot.tabId}|${snapshot.url}|v${snapshot.pageVersion}`;
    this.snapshotCache.set(key, {
      snapshot,
      cachedAtMs: this.now()
    });
  }

  /**
   * Returns a cached snapshot if it matches `tabId`, `url`, and `pageVersion` and is within `snapshotTtlMs`.
   */
  getReusableSnapshot(tabId, url, pageVersion) {
    const key = `${tabId}|${url}|v${pageVersion}`;
    const entry = this.snapshotCache.get(key);
    if (!entry) {
      this.snapshotMissCount += 1;
      return null;
    }
    const ageMs = this.now() - entry.cachedAtMs;
    if (ageMs > this.snapshotTtlMs) {
      this.snapshotCache.delete(key);
      this.snapshotMissCount += 1;
      return null;
    }
    this.snapshotReuseCount += 1;
    return entry.snapshot;
  }

  invalidateSnapshotsForTab(tabId) {
    const prefix = `${tabId}|`;
    for (const key of this.snapshotCache.keys()) {
      if (key.startsWith(prefix)) {
        this.snapshotCache.delete(key);
      }
    }
  }

  /**
   * Begins a cancellable read or search operation and links any external AbortSignal.
   */
  beginTask(taskId, kind = "read", externalSignal = null) {
    const id = String(taskId || `task-${this.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const controller = new AbortController();
    const startedAtMs = this.now();

    const onExternalAbort = () => {
      controller.abort(externalSignal?.reason || "cancelled_by_caller");
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    const record = {
      taskId: id,
      kind,
      controller,
      startedAtMs,
      finish: (meta = {}) => {
        const durationMs = Math.max(0, this.now() - startedAtMs);
        this.activeControllers.delete(id);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
        this.latencySamples.push({
          taskId: id,
          kind,
          durationMs,
          url: meta.url || null,
          aborted: controller.signal.aborted,
          recordedAtMs: this.now()
        });
        return durationMs;
      }
    };

    this.activeControllers.set(id, record);
    return record;
  }

  cancelTask(taskId, reason = "cancelled_by_user") {
    const record = this.activeControllers.get(String(taskId));
    if (!record) return { cancelled: false, taskId };
    if (!record.controller.signal.aborted) {
      record.controller.abort(reason);
    }
    this.activeControllers.delete(String(taskId));
    return { cancelled: true, taskId, reason };
  }

  cancelAllTasks(reason = "cancelled_all") {
    const cancelledIds = [];
    for (const [id, rec] of this.activeControllers.entries()) {
      if (!rec.controller.signal.aborted) {
        rec.controller.abort(reason);
        cancelledIds.push(id);
      }
    }
    this.activeControllers.clear();
    return {
      cancelledCount: cancelledIds.length,
      cancelledTaskIds: cancelledIds,
      reason
    };
  }

  getResourceReport() {
    const mem = this.sampleProcessMemory("report");
    const completedLatencies = this.latencySamples
      .filter((s) => !s.aborted)
      .map((s) => s.durationMs)
      .sort((a, b) => a - b);

    const percentile = (sorted, p) => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
      return Number(sorted[idx].toFixed(2));
    };

    let peakRssMb = mem.rssMb;
    let peakHeapUsedMb = mem.heapUsedMb;
    for (const s of this.memorySamples) {
      if (s.rssMb > peakRssMb) peakRssMb = s.rssMb;
      if (s.heapUsedMb > peakHeapUsedMb) peakHeapUsedMb = s.heapUsedMb;
    }

    return {
      maxLiveTabs: this.maxLiveTabs,
      liveTabCount: this.liveTabs.size,
      liveTabIds: Array.from(this.liveTabs.keys()),
      hibernatedTabCount: this.hibernatedTabs.size,
      hibernatedTabIds: Array.from(this.hibernatedTabs.keys()),
      hibernationEventsCount: this.hibernationEvents.length,
      snapshotReuseCount: this.snapshotReuseCount,
      snapshotMissCount: this.snapshotMissCount,
      activeTasksCount: this.activeControllers.size,
      ramTelemetry: {
        currentRssMb: mem.rssMb,
        currentHeapUsedMb: mem.heapUsedMb,
        peakRssMb,
        peakHeapUsedMb,
        externalMb: mem.externalMb
      },
      latencyTelemetry: {
        totalCompletedOps: completedLatencies.length,
        p50Ms: percentile(completedLatencies, 50),
        p95Ms: percentile(completedLatencies, 95),
        maxMs: completedLatencies.length ? Number(completedLatencies[completedLatencies.length - 1].toFixed(2)) : 0,
        samples: this.latencySamples.slice(-20)
      }
    };
  }
}

module.exports = {
  KosworkBrowserResourceGovernor
};
