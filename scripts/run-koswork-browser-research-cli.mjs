#!/usr/bin/env node
/**
 * Standalone CLI & Programmatic Runner for the Koswork Browser Research Cycle
 * (`scripts/run-koswork-browser-research-cli.mjs`).
 *
 * Executes a complete 5-site HTTP corpus research cycle + W3C PROV-JSON / BibTeX +
 * W3C HAR 1.2 + Deterministic Replay Audit and outputs a JSON verification summary.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { KosworkBrowserEngine } = require("../desktop/windows/browser/engine.cjs");
const { startReproducibleCorpusServer } = require("../desktop/windows/browser/corpus-http-server.cjs");
const { createKosworkBrowserShell } = require("../desktop/windows/browser/shell.cjs");
const { KosworkUnifiedTaskCoordinator } = require("../desktop/windows/ci/unified-task-coordinator.cjs");
const { buildBrowserResearchProvAndBibtex } = require("../desktop/windows/browser/prov-lineage-exporter.cjs");
const { buildResearchSessionHarLog } = require("../desktop/windows/browser/research-session-har-exporter.cjs");

export async function runCliBrowserResearchVerification(options = {}) {
  const workspaceRoot =
    options.workspaceRoot ||
    fs.mkdtempSync(path.join(os.tmpdir(), "koswork-cli-research-"));
  fs.mkdirSync(path.join(workspaceRoot, "downloads"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });

  const corpusServer = await startReproducibleCorpusServer();
  try {
    const engine = new KosworkBrowserEngine({
      allowedWorkspaceRoot: workspaceRoot,
      maxLiveTabs: 3,
      searchAdapterOptions: {
        providerId: "local-http-5site-corpus",
        searchEndpoint: `${corpusServer.baseOrigin}/search`
      }
    });

    const shell = createKosworkBrowserShell({
      engine,
      workspaceRoot
    });

    const coordinator = new KosworkUnifiedTaskCoordinator({
      workspaceRoot,
      browserEngine: engine
    });

    const httpCycle = await coordinator.executeBrowserResearchCycle({
      question: "Сквозная CLI проверка 5 сайтов по реальному HTTP-протоколу (Option Alpha vs Option Beta)",
      searchQuery: "Option Alpha Option Beta",
      options: ["Option Alpha", "Option Beta"],
      criteria: ["Цена", "Поддержка SLA"],
      reportSlug: "cli-5site-corpus-report",
      substitutionsByUrlPath: {
        "/site-5-dynamic-and-substituted": {
          targetPhrase: "Гарантия возврата средств: 30 дней без условий.",
          reNavigateUrl: `${corpusServer.baseOrigin}/site-5-dynamic-and-substituted`
        }
      },
      assertionsByUrlPath: {
        "/site-1-official-2026": [
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
            quote: "для Option Alpha поддержка SLA зафиксирована на уровне 99.95% времени доступности."
          }
        ],
        "/site-2-contradiction-2025": [
          {
            optionName: "Option Alpha",
            criterion: "Цена",
            value: "$79/мес",
            displayValue: "$79/мес",
            quote: "для пакета Option Alpha базовая цена составляет $79/мес без учёта скидок."
          }
        ],
        "/site-4-very-long-article": [
          {
            optionName: "Option Beta",
            criterion: "Цена",
            value: "$35/мес",
            displayValue: "$35/мес",
            quote: "Итоговая сводка по пакету Option Beta: базовая цена составляет $35/мес для малых команд."
          },
          {
            optionName: "Option Beta",
            criterion: "Поддержка SLA",
            value: "99.90%",
            displayValue: "99.90%",
            quote: "Для пакета Option Beta поддержка SLA составляет 99.90% в рабочие дни."
          }
        ]
      }
    });

    const snapshotsByUrl = {};
    for (const [, tab] of engine.tabs.entries()) {
      if (tab.snapshot) {
        snapshotsByUrl[tab.url] = tab.snapshot;
      }
    }

    const provBundle = buildBrowserResearchProvAndBibtex({
      question: httpCycle.question,
      confirmedClaims: httpCycle.savedReports.confirmedClaims
    });
    const harLog = buildResearchSessionHarLog({
      openedSources: httpCycle.openedSources
    });

    const replayAudit = await shell.dispatchToolCall("browser.verify_replay_audit", {
      savedReports: httpCycle.savedReports,
      provJsonObject: provBundle.provJsonObject,
      harLog,
      snapshotsByUrl
    });

    return {
      status: httpCycle.status,
      workspaceRoot,
      openedSourcesCount: httpCycle.openedSources.length,
      confirmedClaimsCount: httpCycle.savedReports.confirmedClaims.length,
      contradictionsCount: httpCycle.contradictions.length,
      outdatedFindingsCount: httpCycle.outdatedFindings.length,
      unavailableSourcesCount: httpCycle.unavailableSources.length,
      substitutionIncidentsCount: httpCycle.substitutionIncidents.length,
      replayAuditPassed: replayAudit.replayAuditPassed,
      reportDigestSha256: replayAudit.reportDigestSha256
    };
  } finally {
    await corpusServer.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runCliBrowserResearchVerification();
  console.log(JSON.stringify(summary));
  if (!summary.replayAuditPassed) {
    process.exit(1);
  }
}
