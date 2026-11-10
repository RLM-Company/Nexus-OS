"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { KosworkBrowserEngine } = require("./engine.cjs");
const { KosworkUnifiedTaskCoordinator } = require("../ci/unified-task-coordinator.cjs");

/**
 * Reproducible RAM & Latency Benchmark for the Koswork Browser Research Cycle
 * (`desktop/windows/browser/benchmark-browser-research.cjs`).
 *
 * Runs the 5-site acceptance corpus (including a > 18,000 UTF-16 code unit article across
 * multiple windows, dynamic lazy-loaded sections, contradiction detection, and snapshot reuse),
 * measures actual Node/V8 RAM (`rssMb`, `heapUsedMb`, `externalMb`) and per-operation latency
 * (`p50Ms`, `p95Ms`, `maxMs`), and optionally writes `BENCHMARK_METRICS.json`.
 */
async function runBrowserResearchBenchmark(options = {}) {
  const workspaceRoot =
    options.workspaceRoot ||
    fs.mkdtempSync(path.join(os.tmpdir(), "koswork-browser-bench-"));
  fs.mkdirSync(path.join(workspaceRoot, "downloads"), { recursive: true });

  const engine = new KosworkBrowserEngine({
    allowedWorkspaceRoot: workspaceRoot,
    maxLiveTabs: 3
  });

  engine.registerSyntheticSite("https://bench.local/site-1", {
    title: "Спецификация Option Alpha (2026)",
    pageDate: "15 октября 2026",
    eventDate: "1 ноября 2026",
    text: "Официальный прайс-лист: для пакета Option Alpha базовая цена составляет $49/мес при годовой подписке.\n\nДля Option Alpha поддержка SLA зафиксирована на уровне 99.95% времени доступности.",
    assertions: [
      {
        optionName: "Option Alpha",
        criterion: "Цена",
        value: "$49/мес",
        displayValue: "$49/мес",
        quote: "для пакета Option Alpha базовая цена составляет $49/мес при годовой подписке."
      },
      {
        optionName: "Option Alpha",
        criterion: "Поддержка SLA",
        value: "99.95%",
        displayValue: "99.95%",
        quote: "Для Option Alpha поддержка SLA зафиксирована на уровне 99.95% времени доступности."
      }
    ]
  });

  engine.registerSyntheticSite("https://bench.local/site-2-contradiction", {
    title: "Архивный прайс Option Alpha (Май 2025)",
    pageDate: "Май 2025",
    eventDate: "2025-05-01",
    text: "Архивный обзор: для пакета Option Alpha базовая цена составляет $79/мес без учёта скидок.",
    assertions: [
      {
        optionName: "Option Alpha",
        criterion: "Цена",
        value: "$79/мес",
        displayValue: "$79/мес",
        quote: "для пакета Option Alpha базовая цена составляет $79/мес без учёта скидок."
      }
    ]
  });

  engine.registerSyntheticSite("https://bench.local/site-3-503", {
    title: "Недоступный ресурс",
    httpStatus: 503,
    text: "503 Service Unavailable"
  });

  const longParagraphs = Array.from({ length: 45 }, (_, i) =>
    `Абзац ${i + 1}: Детальное описание протокола индексации и контрольных замеров задержки чтения длинных документов в браузере Koswork. `.repeat(
      3
    )
  );
  longParagraphs.push(
    "Для пакета Option Beta базовая цена составляет $35/мес, а поддержка SLA составляет 99.90%."
  );

  engine.registerSyntheticSite("https://bench.local/site-4-long", {
    title: "Длинная статья по Option Beta",
    pageDate: "20 октября 2026",
    eventDate: "18 октября 2026",
    text: longParagraphs.join("\n\n"),
    assertions: [
      {
        optionName: "Option Beta",
        criterion: "Цена",
        value: "$35/мес",
        displayValue: "$35/мес",
        quote: "Для пакета Option Beta базовая цена составляет $35/мес, а поддержка SLA составляет 99.90%."
      }
    ]
  });

  engine.registerSyntheticSite("https://bench.local/site-5-dynamic", {
    title: "Динамический стенд Option Beta",
    pageDate: "28 октября 2026",
    eventDate: "25 октября 2026",
    text: "Первичный экран.\n\nГарантия возврата средств: 30 дней без условий.",
    onDynamicScroll: async () => ({
      appendText: "Динамический блок: для Option Beta задержка поиска составляет < 12 мс."
    }),
    simulatePostObservationSubstitution: {
      targetPhrase: "Гарантия возврата средств: 30 дней без условий.",
      substitutedPhrase: "Гарантия возврата средств: возврат не предусмотрен."
    },
    assertions: [
      {
        optionName: "Option Beta",
        criterion: "Поддержка SLA",
        value: "99.90%",
        displayValue: "99.90%",
        quote: "Динамический блок: для Option Beta задержка поиска составляет < 12 мс."
      }
    ]
  });

  const startedAtMs = Date.now();
  const coordinator = new KosworkUnifiedTaskCoordinator({
    workspaceRoot,
    browserEngine: engine
  });

  const cycleResult = await coordinator.executeBrowserResearchCycle({
    question: "Контрольный замер RAM и задержки на 5 сайтах (Option Alpha vs Option Beta)",
    options: ["Option Alpha", "Option Beta"],
    criteria: ["Цена", "Поддержка SLA"],
    searchResults: [
      { title: "Спецификация Option Alpha (2026)", url: "https://bench.local/site-1", snippet: "Прайс 2026" },
      { title: "Архивный прайс Option Alpha (Май 2025)", url: "https://bench.local/site-2-contradiction", snippet: "Прайс 2025" },
      { title: "Недоступный ресурс", url: "https://bench.local/site-3-503", snippet: "503" },
      { title: "Длинная статья по Option Beta", url: "https://bench.local/site-4-long", snippet: "Длинная статья" },
      { title: "Динамический стенд Option Beta", url: "https://bench.local/site-5-dynamic", snippet: "Динамика" }
    ]
  });

  // Exercise snapshot reuse explicitly on active tabs
  for (const tabId of engine.resourceGovernor.liveTabs.keys()) {
    engine.observePage(tabId, { reuseSnapshot: true });
  }

  const totalWallClockMs = Date.now() - startedAtMs;
  const resourceReport = engine.resourceGovernor.getResourceReport();

  const summary = {
    benchmarkDate: new Date().toISOString(),
    corpusSitesCount: 5,
    totalWallClockMs,
    maxLiveTabs: resourceReport.maxLiveTabs,
    liveTabCount: resourceReport.liveTabCount,
    hibernatedTabCount: resourceReport.hibernatedTabCount,
    hibernationEventsCount: resourceReport.hibernationEventsCount,
    snapshotReuseCount: resourceReport.snapshotReuseCount,
    ramTelemetry: resourceReport.ramTelemetry,
    latencyTelemetry: {
      totalCompletedOps: resourceReport.latencyTelemetry.totalCompletedOps,
      p50Ms: resourceReport.latencyTelemetry.p50Ms,
      p95Ms: resourceReport.latencyTelemetry.p95Ms,
      maxMs: resourceReport.latencyTelemetry.maxMs
    },
    confirmedClaimsCount: cycleResult.confirmedClaims.length,
    contradictionsCount: cycleResult.contradictions.length,
    unavailableSourcesCount: cycleResult.unavailableSources.length,
    substitutionIncidentsCount: cycleResult.substitutionIncidents.length
  };

  if (options.outputJsonPath) {
    fs.writeFileSync(options.outputJsonPath, JSON.stringify(summary, null, 2), "utf8");
  }

  return summary;
}

if (require.main === module) {
  runBrowserResearchBenchmark().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
}

module.exports = {
  runBrowserResearchBenchmark
};
