"use strict";

/**
 * Koswork Hardware & Performance Benchmark Throughput Extractor
 * (`desktop/windows/browser/hardware-and-benchmark-spec-extractor.cjs`).
 *
 * Deepens Requirements #2, #3 & #5:
 * - Extracts throughput metrics (`45 000 RPS`, `120k req/sec`), tail latency percentiles
 *   (`p50 = 4 мс`, `p95 < 12 мс`, `p99 = 28 ms`), and hardware resource footprints
 *   (`16 vCPU`, `64 ГБ ОЗУ`) with exact UTF-16 `[startUtf16..endUtf16]` offsets and
 *   distinct `pageDate`, `eventDate`, and `fetchedAt`.
 * - Normalizes throughput values to canonical requests-per-second (`normalizedRps`) and
 *   compares options side-by-side while rejecting bare-link claims (`BARE_BENCHMARK_CLAIM_REJECTED`).
 */

function extractHardwareAndPerformanceBenchmarks(snapshot = {}) {
  const fullText = String(snapshot.fullTextUtf16 || snapshot.text || "");
  const throughputMetrics = [];
  const latencyMetrics = [];
  const hardwareSpecs = [];

  // 1. Throughput: e.g. "45000 RPS", "120k req/sec", "85 тыс. запросов/сек"
  const rpsRe = /(\d+(?:\.\d+)?)\s*(k|тыс\.?)?\s*(RPS|req\/sec|req\/s|запросов\/сек)/giu;
  let m;
  while ((m = rpsRe.exec(fullText)) !== null) {
    const baseNum = Number(m[1]);
    const mult = m[2] ? 1000 : 1;
    const normalizedRps = Math.round(baseNum * mult);
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    throughputMetrics.push({
      normalizedRps,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 2. Latency percentiles: e.g. "p95 < 12 мс", "p99 = 28 ms"
  const latRe = /\b(p50|p90|p95|p99)\s*(?:<|<=|=|:|составляет)?\s*(\d+(?:\.\d+)?)\s*(мс|ms|сек|sec)/giu;
  while ((m = latRe.exec(fullText)) !== null) {
    const percentile = m[1].toLowerCase();
    const rawVal = Number(m[2]);
    const unit = m[3].toLowerCase();
    const latencyMs =
      unit === "сек" || unit === "sec" ? Number((rawVal * 1000).toFixed(2)) : rawVal;
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    latencyMetrics.push({
      percentile,
      latencyMs,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  // 3. Hardware specs: e.g. "16 vCPU", "64 ГБ ОЗУ", "64 GB RAM"
  const hwRe = /(\d+)\s*(vCPU|ядер|cores|ГБ\s+ОЗУ|GB\s+RAM)/giu;
  while ((m = hwRe.exec(fullText)) !== null) {
    const amount = Number(m[1]);
    const unit = m[2].trim();
    const quote = m[0].trim();
    const startUtf16 = fullText.indexOf(quote, m.index);
    const endUtf16 = startUtf16 + quote.length;

    hardwareSpecs.push({
      amount,
      unit,
      quote,
      startUtf16,
      endUtf16,
      url: snapshot.url || "",
      pageDate: snapshot.pageDate || null,
      eventDate: snapshot.eventDate || null,
      fetchedAt: snapshot.fetchedAt || null
    });
  }

  return {
    url: snapshot.url || "",
    title: snapshot.title || "",
    pageDate: snapshot.pageDate || null,
    eventDate: snapshot.eventDate || null,
    fetchedAt: snapshot.fetchedAt || null,
    throughputMetrics,
    latencyMetrics,
    hardwareSpecs
  };
}

function compareBenchmarkThroughputAcrossOptions(submissions = []) {
  const evaluated = [];
  const rejected = [];

  for (const sub of submissions || []) {
    const optionName = String(sub?.optionName || "Option").trim();
    if (sub?.bareLinkOnly || !sub?.snapshot) {
      rejected.push({
        optionName,
        sourceUrl: sub?.sourceUrl || "",
        code: "BARE_BENCHMARK_CLAIM_REJECTED",
        reason: "Голая ссылка на бенчмарк без UTF-16 выдержки не принимается."
      });
      continue;
    }

    const extracted = extractHardwareAndPerformanceBenchmarks(sub.snapshot);
    const topRps =
      extracted.throughputMetrics.length > 0
        ? extracted.throughputMetrics.reduce((best, cur) =>
            cur.normalizedRps > best.normalizedRps ? cur : best
          )
        : null;

    if (!topRps) {
      rejected.push({
        optionName,
        sourceUrl: sub.snapshot.url || "",
        code: "BENCHMARK_RPS_NOT_FOUND",
        reason: "На странице не найдена подтверждённая метрика пропускной способности (RPS)."
      });
      continue;
    }

    const p95 = extracted.latencyMetrics.find((l) => l.percentile === "p95") || null;

    evaluated.push({
      optionName,
      normalizedRps: topRps.normalizedRps,
      rpsExcerpt: topRps,
      p95LatencyMs: p95 ? p95.latencyMs : null,
      p95Excerpt: p95,
      hardwareSpecs: extracted.hardwareSpecs,
      pageDate: sub.snapshot.pageDate || null,
      eventDate: sub.snapshot.eventDate || null,
      fetchedAt: sub.snapshot.fetchedAt || null
    });
  }

  evaluated.sort((a, b) => b.normalizedRps - a.normalizedRps);

  return {
    evaluatedCount: evaluated.length,
    rejectedCount: rejected.length,
    fastestOptionName: evaluated[0] ? evaluated[0].optionName : null,
    evaluated,
    rejected
  };
}

module.exports = {
  extractHardwareAndPerformanceBenchmarks,
  compareBenchmarkThroughputAcrossOptions
};
