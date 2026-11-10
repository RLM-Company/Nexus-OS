"use strict";

/**
 * Koswork Tab Network Waterfall & Snapshot Cache Efficiency Profiler
 * (`desktop/windows/browser/tab-network-waterfall-and-cache-profiler.cjs`).
 *
 * Deepens Requirements #1, #3 & #6:
 * - Records detailed per-tab request timing waterfalls (`dnsLookupMs`, `tcpConnectMs`,
 *   `tlsHandshakeMs`, `ttfbMs`, `contentDownloadMs`, `totalLatencyMs`, `transferSizeBytes`,
 *   `cacheStatus`: `"network_fetch"` | `"snapshot_cache_hit"` | `"http_304_revalidated"`).
 * - Computes p50 / p95 / p99 TTFB and total load latencies, bandwidth saved by valid
 *   snapshot reuse (`bytesSavedBySnapshotReuse`), and identifies slow bottleneck origins.
 */

function percentile(sortedNumbers, pct) {
  if (!sortedNumbers.length) return 0;
  const idx = Math.min(
    sortedNumbers.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedNumbers.length) - 1)
  );
  return Number(sortedNumbers[idx].toFixed(2));
}

class KosworkTabNetworkWaterfallProfiler {
  constructor() {
    this.entries = [];
  }

  recordNavigationWaterfall({
    tabId,
    url,
    httpStatus = 200,
    cacheStatus = "network_fetch",
    dnsLookupMs = 2,
    tcpConnectMs = 4,
    tlsHandshakeMs = 6,
    ttfbMs = 18,
    contentDownloadMs = 9,
    transferSizeBytes = 16384,
    decodedBodySizeBytes = 32768
  } = {}) {
    const isCached =
      cacheStatus === "snapshot_cache_hit" || cacheStatus === "http_304_revalidated";

    const effectiveDns = isCached ? 0 : Number(dnsLookupMs || 0);
    const effectiveTcp = isCached ? 0 : Number(tcpConnectMs || 0);
    const effectiveTls = isCached ? 0 : Number(tlsHandshakeMs || 0);
    const effectiveTtfb =
      cacheStatus === "snapshot_cache_hit" ? 0.5 : Number(ttfbMs || 0);
    const effectiveDownload =
      cacheStatus === "snapshot_cache_hit" ? 0.5 : Number(contentDownloadMs || 0);

    const totalLatencyMs = Number(
      (
        effectiveDns +
        effectiveTcp +
        effectiveTls +
        effectiveTtfb +
        effectiveDownload
      ).toFixed(2)
    );

    const actualTransferBytes =
      cacheStatus === "snapshot_cache_hit"
        ? 0
        : cacheStatus === "http_304_revalidated"
          ? Math.min(512, Number(transferSizeBytes || 0))
          : Number(transferSizeBytes || 0);

    const bytesSaved = Math.max(
      0,
      Number(decodedBodySizeBytes || transferSizeBytes || 0) - actualTransferBytes
    );

    let origin = "unknown";
    try {
      origin = new URL(String(url || "https://corpus.local")).origin;
    } catch (_) {
      origin = "https://corpus.local";
    }

    const record = {
      entryId: `wf-${this.entries.length + 1}`,
      recordedAt: new Date().toISOString(),
      tabId: String(tabId || "tab-1"),
      url: String(url || ""),
      origin,
      httpStatus: Number(httpStatus || 200),
      cacheStatus,
      timings: {
        dnsLookupMs: effectiveDns,
        tcpConnectMs: effectiveTcp,
        tlsHandshakeMs: effectiveTls,
        ttfbMs: effectiveTtfb,
        contentDownloadMs: effectiveDownload,
        totalLatencyMs
      },
      transferSizeBytes: actualTransferBytes,
      decodedBodySizeBytes: Number(decodedBodySizeBytes || 0),
      bytesSavedByCache: isCached ? bytesSaved : 0
    };

    this.entries.push(record);
    return record;
  }

  buildWaterfallSummary({ slowOriginThresholdMs = 80 } = {}) {
    const totalRequests = this.entries.length;
    const ttfbList = this.entries
      .map((e) => e.timings.ttfbMs)
      .sort((a, b) => a - b);
    const totalLatList = this.entries
      .map((e) => e.timings.totalLatencyMs)
      .sort((a, b) => a - b);

    const cacheHits = this.entries.filter(
      (e) =>
        e.cacheStatus === "snapshot_cache_hit" ||
        e.cacheStatus === "http_304_revalidated"
    ).length;

    const totalTransferBytes = this.entries.reduce(
      (acc, e) => acc + e.transferSizeBytes,
      0
    );
    const totalBytesSavedByCache = this.entries.reduce(
      (acc, e) => acc + e.bytesSavedByCache,
      0
    );

    const byOrigin = new Map();
    for (const e of this.entries) {
      if (!byOrigin.has(e.origin)) {
        byOrigin.set(e.origin, []);
      }
      byOrigin.get(e.origin).push(e.timings.totalLatencyMs);
    }

    const bottleneckOrigins = [];
    for (const [origin, latencies] of byOrigin.entries()) {
      const avgMs = Number(
        (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
      );
      if (avgMs >= slowOriginThresholdMs) {
        bottleneckOrigins.push({
          origin,
          requestCount: latencies.length,
          avgLatencyMs: avgMs
        });
      }
    }

    return {
      totalRequests,
      cacheHits,
      cacheHitRatio:
        totalRequests > 0 ? Number((cacheHits / totalRequests).toFixed(4)) : 0,
      ttfbPercentilesMs: {
        p50: percentile(ttfbList, 50),
        p95: percentile(ttfbList, 95),
        p99: percentile(ttfbList, 99)
      },
      totalLatencyPercentilesMs: {
        p50: percentile(totalLatList, 50),
        p95: percentile(totalLatList, 95),
        p99: percentile(totalLatList, 99)
      },
      totalTransferBytes,
      totalBytesSavedByCache,
      bottleneckOrigins,
      entries: this.entries
    };
  }
}

module.exports = {
  KosworkTabNetworkWaterfallProfiler
};
