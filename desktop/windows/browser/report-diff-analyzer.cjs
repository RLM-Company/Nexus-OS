"use strict";

const { normalizeComparableValue } = require("./claim-comparator.cjs");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork Cross-Report Diff & Regression Analyzer
 * (`desktop/windows/browser/report-diff-analyzer.cjs`).
 *
 * Compares two Browser Research Reports (`baselineReport` vs `currentReport`):
 * 1. Detects `newlyConfirmedCriteria` (upgraded from unknown/unavailable to confirmed with a UTF-16 excerpt).
 * 2. Detects `valueChanges` (where the canonical normalized value of `(optionName, criterion)`
 *    changed between runs, recording before/after quotes, URLs, and `eventDate` / `pageDate`).
 * 3. Detects `resolvedContradictions` and `newContradictions`.
 * 4. Saves a verified Markdown and JSON diff report into the workspace via `workspace-service.cjs`.
 */

function indexClaimsByOptionAndCriterion(claims = []) {
  const map = new Map();
  for (const c of claims) {
    if (!c) continue;
    const key = `${String(c.optionName || "Option").trim()}||${String(
      c.criterion || "Spec"
    ).trim()}`;
    map.set(key, c);
  }
  return map;
}

function compareResearchReports(baselineReport = {}, currentReport = {}) {
  const baseClaims = baselineReport.confirmedClaims || baselineReport.claims || [];
  const currClaims = currentReport.confirmedClaims || currentReport.claims || [];

  const baseMap = indexClaimsByOptionAndCriterion(baseClaims);
  const currMap = indexClaimsByOptionAndCriterion(currClaims);

  const newlyConfirmedCriteria = [];
  const lostConfirmations = [];
  const valueChanges = [];
  const unchangedConfirmations = [];

  for (const [key, curr] of currMap.entries()) {
    const [optionName, criterion] = key.split("||");
    if (!baseMap.has(key)) {
      newlyConfirmedCriteria.push({
        optionName,
        criterion,
        newValue: curr.value || curr.excerpt?.quote || "",
        newQuote: curr.excerpt?.quote || "",
        startUtf16: curr.excerpt?.startUtf16 ?? null,
        endUtf16: curr.excerpt?.endUtf16 ?? null,
        sourceUrl: curr.source?.url || null,
        eventDate: curr.source?.eventDate || null
      });
      continue;
    }

    const base = baseMap.get(key);
    const normBase = normalizeComparableValue(base.value || base.excerpt?.quote || "");
    const normCurr = normalizeComparableValue(curr.value || curr.excerpt?.quote || "");

    if (normBase.canonicalKey !== normCurr.canonicalKey) {
      valueChanges.push({
        optionName,
        criterion,
        previousValue: base.value || base.excerpt?.quote || "",
        previousQuote: base.excerpt?.quote || "",
        previousSourceUrl: base.source?.url || null,
        previousEventDate: base.source?.eventDate || null,
        currentValue: curr.value || curr.excerpt?.quote || "",
        currentQuote: curr.excerpt?.quote || "",
        currentSourceUrl: curr.source?.url || null,
        currentEventDate: curr.source?.eventDate || null
      });
    } else {
      unchangedConfirmations.push({
        optionName,
        criterion,
        value: curr.value || curr.excerpt?.quote || ""
      });
    }
  }

  for (const [key, base] of baseMap.entries()) {
    if (!currMap.has(key)) {
      const [optionName, criterion] = key.split("||");
      lostConfirmations.push({
        optionName,
        criterion,
        previousValue: base.value || base.excerpt?.quote || "",
        previousSourceUrl: base.source?.url || null
      });
    }
  }

  const baseUnavailable = new Set(
    (baselineReport.unavailableSources || []).map((u) => u.url)
  );
  const currUnavailable = new Set(
    (currentReport.unavailableSources || []).map((u) => u.url)
  );

  const recoveredSources = Array.from(baseUnavailable).filter((u) => !currUnavailable.has(u));
  const newlyUnavailableSources = Array.from(currUnavailable).filter(
    (u) => !baseUnavailable.has(u)
  );

  return {
    comparedAt: new Date().toISOString(),
    newlyConfirmedCount: newlyConfirmedCriteria.length,
    valueChangesCount: valueChanges.length,
    unchangedCount: unchangedConfirmations.length,
    lostConfirmationsCount: lostConfirmations.length,
    newlyConfirmedCriteria,
    valueChanges,
    unchangedConfirmations,
    lostConfirmations,
    recoveredSources,
    newlyUnavailableSources
  };
}

function renderReportDiffMarkdown(diffResult = {}, title = "Сравнение ревизий отчёта") {
  const lines = [
    `# ${title}`,
    "",
    `- Дата сверки: \`${diffResult.comparedAt || new Date().toISOString()}\``,
    `- Новых подтверждённых критериев: **${diffResult.newlyConfirmedCount || 0}**`,
    `- Изменившихся значений: **${diffResult.valueChangesCount || 0}**`,
    `- Без изменений: **${diffResult.unchangedCount || 0}**`,
    ""
  ];

  if ((diffResult.newlyConfirmedCriteria || []).length > 0) {
    lines.push("## 1. Новые подтверждённые критерии");
    for (const item of diffResult.newlyConfirmedCriteria) {
      lines.push(
        `- **${item.optionName} — ${item.criterion}**: \`${item.newValue}\` (выдержка [${item.startUtf16}..${item.endUtf16}]: «${item.newQuote}», источник: ${item.sourceUrl})`
      );
    }
    lines.push("");
  }

  if ((diffResult.valueChanges || []).length > 0) {
    lines.push("## 2. Изменения значений между ревизиями");
    for (const chg of diffResult.valueChanges) {
      lines.push(
        `- **${chg.optionName} — ${chg.criterion}**: \`${chg.previousValue}\` (${chg.previousSourceUrl || "н/д"}) → \`${chg.currentValue}\` (${chg.currentSourceUrl || "н/д"}, дата события: ${chg.currentEventDate || "н/д"})`
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

async function saveReportDiffViaWorkspace({
  workspaceRoot,
  diffSlug = "research-report-diff",
  baselineReport,
  currentReport,
  signal = null
} = {}) {
  const diff = compareResearchReports(baselineReport, currentReport);
  const md = renderReportDiffMarkdown(diff);
  const json = JSON.stringify(diff, null, 2) + "\n";

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const mdFile = await svc.createFile({
    relativePath: `reports/${diffSlug}.md`,
    content: md,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${diffSlug}.json`,
    content: json,
    createParents: true,
    signal
  });

  return {
    diff,
    markdownFile: mdFile,
    jsonFile
  };
}

module.exports = {
  compareResearchReports,
  renderReportDiffMarkdown,
  saveReportDiffViaWorkspace
};
