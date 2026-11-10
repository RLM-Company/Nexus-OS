"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// Ensure existing Codex workspace adapters (workspace-service.cjs / word-report-builder.cjs)
// can resolve their parent helper stubs when run in standalone browser/research test worktrees
(function ensureWorkspaceAdapterPeers() {
  const desktopStatePath = path.resolve(__dirname, "../desktop-state.cjs");
  const connectionPolicyPath = path.resolve(__dirname, "../connection-policy.cjs");

  if (!fs.existsSync(desktopStatePath) && !require.cache[desktopStatePath]) {
    require.cache[desktopStatePath] = {
      id: desktopStatePath,
      filename: desktopStatePath,
      loaded: true,
      exports: {
        writeAtomicJson(targetPath, payload) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
        }
      }
    };
  }
  if (!fs.existsSync(connectionPolicyPath) && !require.cache[connectionPolicyPath]) {
    require.cache[connectionPolicyPath] = {
      id: connectionPolicyPath,
      filename: connectionPolicyPath,
      loaded: true,
      exports: {
        normalizeServerOrigin(origin) {
          return String(origin || "http://127.0.0.1");
        }
      }
    };
  }

  const origResolveFilename = Module._resolveFilename;
  if (!origResolveFilename.__kosworkPeerPatched) {
    const patched = function (request, parent, isMain, options) {
      if (request === "../desktop-state.cjs" && !fs.existsSync(desktopStatePath)) {
        return desktopStatePath;
      }
      if (request === "../connection-policy.cjs" && !fs.existsSync(connectionPolicyPath)) {
        return connectionPolicyPath;
      }
      return origResolveFilename.call(this, request, parent, isMain, options);
    };
    patched.__kosworkPeerPatched = true;
    Module._resolveFilename = patched;
  }
})();

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");
const { saveWordReportToWorkspace } = require("../workspace/word-report-builder.cjs");
const { saveWorkbookToWorkspace } = require("../workspace/excel-workbook-builder.cjs");
const { compareFactsForCriterion } = require("./claim-comparator.cjs");
const { verifyEvidenceAgainstSnapshotAndClaim } = require("./evidence-verifier.cjs");

/**
 * Koswork Verifiable Research Report Builder (`desktop/windows/browser/research-report-builder.cjs`).
 *
 * Implements Queue Items #4, #5 & #6:
 * - Every claim is verified via `verifyEvidenceAgainstSnapshotAndClaim` against its source snapshot.
 *   A non-empty quote and hash alone do NOT pass if the quote does not support `claimedValue` or negates it!
 * - Evaluates inter-source contradictions via `compareFactsForCriterion`.
 * - Marks any missing or unconfirmed criterion honestly as `"не удалось установить"`.
 * - Exports real report artifacts into the workspace folder using the existing Codex adapters:
 *   - `workspace-service.cjs` (`.md`, `.html`, `.json`)
 *   - `word-report-builder.cjs` (`.docx` Office export)
 *   - `excel-workbook-builder.cjs` (`.xlsx` Office export)
 */

function buildStructuredResearchReport({
  question,
  subQuestions = [],
  options = [],
  criteria = [],
  extractedFacts = [],
  snapshotsByUrl = new Map(),
  unavailableSources = [],
  queryBudgetStats = null
} = {}) {
  const verifiedFacts = [];
  const rejectedClaims = [];

  for (const rawFact of extractedFacts || []) {
    const sourceUrl = rawFact.source?.url || rawFact.excerpt?.url || "";
    const snapshot =
      rawFact.snapshot ||
      (snapshotsByUrl instanceof Map ? snapshotsByUrl.get(sourceUrl) : snapshotsByUrl?.[sourceUrl]);

    const check = verifyEvidenceAgainstSnapshotAndClaim({
      snapshot,
      excerpt: rawFact.excerpt,
      optionName: rawFact.optionName,
      criterion: rawFact.criterion,
      claimedValue: rawFact.value ?? rawFact.displayValue
    });

    if (!check.verified) {
      rejectedClaims.push({
        optionName: rawFact.optionName || "Option",
        criterion: rawFact.criterion || "Spec",
        claimedValue: rawFact.value ?? rawFact.displayValue ?? null,
        sourceUrl,
        code: check.code,
        reason: check.reason
      });
      continue;
    }

    verifiedFacts.push({
      optionName: rawFact.optionName,
      criterion: rawFact.criterion,
      value: rawFact.value,
      displayValue: rawFact.displayValue || String(rawFact.value),
      excerpt: {
        ...rawFact.excerpt,
        quoteSha256: check.quoteSha256,
        readingLimitations: check.readingLimitations
      },
      source: {
        url: check.url,
        title: check.title,
        snapshotId: check.snapshotId,
        pageVersion: check.pageVersion,
        pageDate: check.pageDate,
        eventDate: check.eventDate,
        fetchedAt: check.fetchedAt,
        readingLimitations: check.readingLimitations
      }
    });
  }

  const allOptions =
    options.length > 0
      ? options
      : Array.from(new Set(verifiedFacts.map((f) => f.optionName)));
  const allCriteria =
    criteria.length > 0
      ? criteria
      : Array.from(new Set(verifiedFacts.map((f) => f.criterion)));

  const comparisonRows = [];
  const contradictions = [];
  const outdatedSources = [];
  const unestablishedItems = [];

  for (const optionName of allOptions) {
    const cells = {};
    for (const criterion of allCriteria) {
      const cellFacts = verifiedFacts.filter(
        (f) => f.optionName === optionName && f.criterion === criterion
      );
      const cmp = compareFactsForCriterion(cellFacts);

      if (!cmp.primaryFact) {
        cells[criterion] = {
          status: "unverified",
          value: null,
          displayValue: "не удалось установить",
          quote: null,
          startUtf16: -1,
          endUtf16: -1,
          sourceUrl: null,
          sourceTitle: null,
          pageDate: null,
          eventDate: null,
          fetchedAt: null,
          readingLimitations: null
        };
        unestablishedItems.push({
          optionName,
          criterion,
          status: "не удалось установить",
          reason: "Подтверждающая выдержка в проверенных первоисточниках не найдена."
        });
      } else {
        const pf = cmp.primaryFact;
        const normalizedStatus = cmp.hasConflict ? "contradiction" : cmp.status;
        cells[criterion] = {
          status: normalizedStatus,
          value: pf.value,
          displayValue: pf.displayValue,
          quote: pf.excerpt.quote,
          quoteSha256: pf.excerpt.quoteSha256,
          startUtf16: pf.excerpt.startUtf16,
          endUtf16: pf.excerpt.endUtf16,
          sourceUrl: pf.source.url,
          sourceTitle: pf.source.title,
          pageVersion: pf.source.pageVersion,
          pageDate: pf.source.pageDate,
          eventDate: pf.source.eventDate,
          fetchedAt: pf.source.fetchedAt,
          readingLimitations: pf.source.readingLimitations
        };

        if (cmp.hasConflict && cmp.contradiction) {
          const c = cmp.contradiction;
          contradictions.push({
            optionName,
            criterion,
            discrepancyNote: c.summary,
            perspectives: [
              {
                displayValue: c.sideA.value,
                quote: c.sideA.quote,
                sourceTitle: c.sideA.title,
                sourceUrl: c.sideA.url,
                pageDate: c.sideA.pageDate,
                fetchedAt: c.sideA.fetchedAt
              },
              {
                displayValue: c.sideB.value,
                quote: c.sideB.quote,
                sourceTitle: c.sideB.title,
                sourceUrl: c.sideB.url,
                pageDate: c.sideB.pageDate,
                fetchedAt: c.sideB.fetchedAt
              }
            ]
          });
        }
        if (cmp.outdatedFinding) {
          outdatedSources.push({
            optionName,
            criterion,
            outdatedValue: cmp.secondaryFact?.displayValue || cmp.outdatedFinding.note,
            outdatedQuote: cmp.secondaryFact?.excerpt?.quote || "",
            outdatedUrl: cmp.outdatedFinding.url,
            outdatedPageDate: cmp.outdatedFinding.pageDate,
            supersededByValue: pf.displayValue,
            supersededByUrl: pf.source.url,
            supersededByPageDate: cmp.outdatedFinding.supersededByDate
          });
        }
      }
    }
    comparisonRows.push({ optionName, cells });
  }

  return {
    question: String(question || "Сравнительное исследование"),
    subQuestions,
    generatedAt: new Date().toISOString(),
    options: allOptions,
    criteria: allCriteria,
    comparisonRows,
    contradictions,
    outdatedSources,
    unestablishedItems,
    unavailableSources: unavailableSources || [],
    rejectedClaims,
    queryBudgetStats,
    totalVerifiedFacts: verifiedFacts.length
  };
}

function renderResearchReportMarkdown(report) {
  const lines = [
    `# Отчёт исследования: ${report.question}`,
    ``,
    `Сформировано: ${report.generatedAt}`
  ];

  if (Array.isArray(report.subQuestions) && report.subQuestions.length > 0) {
    lines.push(``, `## 0. Вопросы исследования (декомпозиция цели)`);
    for (const sq of report.subQuestions) {
      lines.push(`- ${sq}`);
    }
  }

  lines.push(
    ``,
    `## 1. Сводная матрица сравнения`,
    ``,
    `| Вариант | ${report.criteria.join(" | ")} |`,
    `| --- | ${report.criteria.map(() => "---").join(" | ")} |`
  );

  for (const row of report.comparisonRows) {
    const vals = report.criteria.map((c) => {
      const cell = row.cells[c];
      if (!cell || cell.status === "unverified") return "не удалось установить";
      const badge = cell.status === "contradiction" ? " ⚠️ (противоречие)" : "";
      return `${cell.displayValue}${badge}`;
    });
    lines.push(`| ${row.optionName} | ${vals.join(" | ")} |`);
  }

  lines.push(``, `## 2. Проверяемые выдержки, позиции UTF-16 и ограничения чтения`);
  for (const row of report.comparisonRows) {
    for (const crit of report.criteria) {
      const cell = row.cells[crit];
      if (cell && cell.status !== "unverified") {
        const lim = cell.readingLimitations
          ? ` | ограничения чтения: crossOriginFramesSkipped=${cell.readingLimitations.crossOriginFramesSkippedCount || 0}, partial=${Boolean(cell.readingLimitations.partialReadOnly)}`
          : "";
        lines.push(
          `- **${row.optionName} — ${crit} (${cell.displayValue}):** «${cell.quote}» ` +
            `([${cell.sourceTitle}](${cell.sourceUrl}), версия снимка: \`v${cell.pageVersion}\`, ` +
            `UTF-16: \`[${cell.startUtf16}..${cell.endUtf16}]\`, дата источника: \`${cell.pageDate || "н/д"}\`, ` +
            `дата события: \`${cell.eventDate || "н/д"}\`, получено: \`${cell.fetchedAt}\`${lim})`
        );
      }
    }
  }

  if (report.contradictions.length > 0 || report.outdatedSources.length > 0) {
    lines.push(``, `## 3. Обнаруженные противоречия и устаревшие сведения`);
    for (const c of report.contradictions) {
      lines.push(`- **Противоречие (${c.optionName} / ${c.criterion}):** ${c.discrepancyNote}`);
      for (const p of c.perspectives) {
        lines.push(
          `  - Позиция \`${p.displayValue}\`: «${p.quote}» ([${p.sourceTitle}](${p.sourceUrl}), дата: ${p.pageDate || "н/д"}, получено: ${p.fetchedAt})`
        );
      }
    }
    for (const o of report.outdatedSources) {
      lines.push(
        `- **Расхождение по дате актуальности (${o.optionName} / ${o.criterion}):** ` +
          `значение \`${o.outdatedValue}\` из источника от \`${o.outdatedPageDate}\` (${o.outdatedUrl}) ` +
          `уступает более свежему источнику от \`${o.supersededByPageDate}\` со значением \`${o.supersededByValue}\` (${o.supersededByUrl}).`
      );
    }
  }

  if (report.unestablishedItems.length > 0 || report.unavailableSources.length > 0) {
    lines.push(``, `## 4. Что не удалось установить и недоступные источники`);
    for (const item of report.unestablishedItems) {
      lines.push(`- **${item.optionName} / ${item.criterion}:** не удалось установить (${item.reason})`);
    }
    for (const unav of report.unavailableSources) {
      lines.push(
        `- **Недоступный источник:** \`${unav.url}\` — статус \`HTTP ${unav.httpStatus || 503}\` (${unav.reason})`
      );
    }
  }

  if (report.rejectedClaims.length > 0) {
    lines.push(``, `## 5. Отклонённые неподтверждённые тезисы (защита от ложных цитат)`);
    for (const rej of report.rejectedClaims) {
      lines.push(
        `- **${rej.optionName} / ${rej.criterion}** (\`${rej.claimedValue}\`): отклонено (\`${rej.code}\` — ${rej.reason})`
      );
    }
  }

  return lines.join("\n") + "\n";
}

function renderResearchReportHtml(report) {
  const md = renderResearchReportMarkdown(report);
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>${report.question}</title></head><body><pre>${escaped}</pre></body></html>\n`;
}

async function saveResearchReportArtifactsViaCodexAdapters({
  workspaceRoot,
  slug = "deep-research-report",
  report,
  exportDocx = true,
  exportXlsx = true,
  signal = null
} = {}) {
  const mdContent = renderResearchReportMarkdown(report);
  const htmlContent = renderResearchReportHtml(report);
  const jsonContent = JSON.stringify(report, null, 2) + "\n";

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const mdFile = await svc.createFile({
    relativePath: `reports/${slug}.md`,
    content: mdContent,
    createParents: true,
    signal
  });
  const htmlFile = await svc.createFile({
    relativePath: `reports/${slug}.html`,
    content: htmlContent,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${slug}.json`,
    content: jsonContent,
    createParents: true,
    signal
  });

  let docxArtifact = null;
  if (exportDocx) {
    const sources = [];
    for (const row of report.comparisonRows) {
      for (const cell of Object.values(row.cells)) {
        if (cell.sourceUrl && !sources.some((s) => s.url === cell.sourceUrl)) {
          sources.push({
            title: cell.sourceTitle || cell.sourceUrl,
            url: cell.sourceUrl,
            retrievedAt: cell.fetchedAt
          });
        }
      }
    }
    docxArtifact = saveWordReportToWorkspace({
      workspaceRoot,
      relativePath: `reports/${slug}.docx`,
      reportSpec: {
        title: report.question,
        sections: [
          {
            heading: "Сводка исследования и проверяемые выдержки",
            paragraphs: mdContent.split("\n").filter(Boolean)
          }
        ],
        sources
      }
    });
  }

  let xlsxArtifact = null;
  if (exportXlsx && typeof saveWorkbookToWorkspace === "function") {
    const rows = [
      ["Вариант", "Критерий", "Значение", "Статус", "Цитата", "UTF-16", "URL", "pageDate", "eventDate", "fetchedAt"]
    ];
    for (const row of report.comparisonRows) {
      for (const crit of report.criteria) {
        const c = row.cells[crit];
        rows.push([
          row.optionName,
          crit,
          c?.displayValue || "не удалось установить",
          c?.status || "unverified",
          c?.quote || "",
          c?.startUtf16 >= 0 ? `${c.startUtf16}..${c.endUtf16}` : "",
          c?.sourceUrl || "",
          c?.pageDate || "",
          c?.eventDate || "",
          c?.fetchedAt || ""
        ]);
      }
    }
    xlsxArtifact = saveWorkbookToWorkspace({
      workspaceRoot,
      relativePath: `reports/${slug}.xlsx`,
      workbookSpec: {
        sheets: [{ name: "Comparison", rows }]
      }
    });
  }

  return {
    markdownFile: mdFile,
    htmlFile: htmlFile,
    jsonFile: jsonFile,
    docxArtifact,
    xlsxArtifact
  };
}

module.exports = {
  buildStructuredResearchReport,
  renderResearchReportHtml,
  renderResearchReportMarkdown,
  saveResearchReportArtifactsViaCodexAdapters
};
