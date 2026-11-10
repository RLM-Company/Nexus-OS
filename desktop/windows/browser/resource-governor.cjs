"use strict";

/**
 * Koswork Browser Resource Governor (`desktop/windows/browser/resource-governor.cjs`).
 *
 * Enforces:
 * - Live tab cap (`maxLiveTabs = 3`) with automatic LRU background tab hibernation
 * - Task-level `AbortController` cancellation (`beginTask`, `cancelTask`, `cancelAllTasks`)
 * - Valid snapshot cache reuse within `snapshotTtlMs`
 * - Process memory (`rssBytes`, `heapUsedBytes`) and task latency telemetry
 */
class KosworkBrowserResourceGovernor {
  constructor(options = {}) {
    this.maxLiveTabs = Math.max(1, Number(options.maxLiveTabs ?? 3));
    this.snapshotTtlMs = Math.max(100, Number(options.snapshotTtlMs ?? 30000));
    this.liveTabs = new Map(); // tabId -> { tabId, lastActiveMs, url }
    this.hibernatedTabs = new Map(); // tabId -> { tabId, hibernatedAtMs, url }
    this.snapshotCache = new Map(); // url -> { snapshot, cachedAtMs }
    this.activeTasks = new Map(); // taskId -> { taskId, kind, startedAtMs, controller }
    this.completedLatenciesMs = [];
    this.memorySamples = [];
    this.peakLiveTabs = 0;
    this.snapshotReuseHits = 0;
  }

  beginTask(taskId, kind = "browser_op", parentSignal = null) {
    const id = String(taskId || `task-${Date.now()}`);
    const controller = new AbortController();

    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort(parentSignal.reason || "parent_signal_aborted");
      } else {
        parentSignal.addEventListener(
          "abort",
          () => controller.abort(parentSignal.reason || "parent_signal_aborted"),
          { once: true }
        );
      }
    }

    const startedAtMs = Date.now();
    const entry = { taskId: id, kind, startedAtMs, controller };
    this.activeTasks.set(id, entry);

    return {
      taskId: id,
      controller,
      finish: () => {
        this.activeTasks.delete(id);
        const latencyMs = Math.max(1, Date.now() - startedAtMs);
        this.completedLatenciesMs.push(latencyMs);
        return latencyMs;
      }
    };
  }

  cancelTask(taskId, reason = "cancelled_by_governor") {
    const entry = this.activeTasks.get(String(taskId));
    if (!entry) return { cancelled: false, taskId };
    entry.controller.abort(reason);
    this.activeTasks.delete(String(taskId));
    return { cancelled: true, taskId, reason };
  }

  cancelAllTasks(reason = "cancelled_all_tasks") {
    const cancelledIds = [];
    for (const [id, entry] of this.activeTasks.entries()) {
      entry.controller.abort(reason);
      cancelledIds.push(id);
    }
    this.activeTasks.clear();
    return { cancelledCount: cancelledIds.length, cancelledIds, reason };
  }

  touchLiveTab(tabId, tabState = {}, onHibernateCallback = null) {
    const id = String(tabId);
    const now = Date.now();
    this.hibernatedTabs.delete(id);
    this.liveTabs.set(id, {
      tabId: id,
      lastActiveMs: now,
      url: tabState.url || null
    });

    const hibernatedNow = [];
    while (this.liveTabs.size > this.maxLiveTabs) {
      let oldestId = null;
      let oldestTime = Infinity;
      for (const [tid, info] of this.liveTabs.entries()) {
        if (tid === id) continue;
        if (info.lastActiveMs < oldestTime || oldestId === null) {
          oldestTime = info.lastActiveMs;
          oldestId = tid;
        }
      }
      if (!oldestId) break;
      const evicted = this.liveTabs.get(oldestId);
      this.liveTabs.delete(oldestId);
      this.hibernatedTabs.set(oldestId, {
        tabId: oldestId,
        hibernatedAtMs: now,
        url: evicted?.url || null
      });
      hibernatedNow.push(oldestId);
      if (typeof onHibernateCallback === "function") {
        onHibernateCallback(oldestId);
      }
    }

    if (this.liveTabs.size > this.peakLiveTabs) {
      this.peakLiveTabs = this.liveTabs.size;
    }

    return {
      liveTabCount: this.liveTabs.size,
      maxLiveTabs: this.maxLiveTabs,
      hibernatedTabIds: hibernatedNow,
      totalHibernatedCount: this.hibernatedTabs.size
    };
  }

  removeTab(tabId) {
    const id = String(tabId);
    this.liveTabs.delete(id);
    this.hibernatedTabs.delete(id);
  }

  cacheSnapshot(snapshot) {
    if (!snapshot || !snapshot.url) return;
    this.snapshotCache.set(snapshot.url, {
      snapshot,
      cachedAtMs: Date.now()
    });
  }

  getValidCachedSnapshot(url) {
    const entry = this.snapshotCache.get(String(url));
    if (!entry) return null;
    if (Date.now() - entry.cachedAtMs > this.snapshotTtlMs) {
      this.snapshotCache.delete(String(url));
      return null;
    }
    this.snapshotReuseHits += 1;
    return entry.snapshot;
  }

  sampleProcessMemory(label = "sample") {
    const mem = process.memoryUsage();
    const sample = {
      label,
      sampledAt: new Date().toISOString(),
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal
    };
    this.memorySamples.push(sample);
    return sample;
  }

  getTelemetry() {
    const sorted = [...this.completedLatenciesMs].sort((a, b) => a - b);
    const avgLatencyMs =
      sorted.length > 0
        ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2))
        : 0;
    const p95LatencyMs =
      sorted.length > 0
        ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
        : 0;
    const latestMem =
      this.memorySamples[this.memorySamples.length - 1] || this.sampleProcessMemory("telemetry");

    return {
      liveTabsCount: this.liveTabs.size,
      peakLiveTabs: this.peakLiveTabs,
      maxLiveTabs: this.maxLiveTabs,
      hibernatedTabsCount: this.hibernatedTabs.size,
      hibernatedTabIds: Array.from(this.hibernatedTabs.keys()),
      snapshotReuseHits: this.snapshotReuseHits,
      completedTasksCount: sorted.length,
      avgLatencyMs,
      p95LatencyMs,
      memory: latestMem
    };
  }
}

module.exports = {
  KosworkBrowserResourceGovernor
};
