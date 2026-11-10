"use strict";

const { compareFactsForCriterion } = require("./claim-comparator.cjs");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork Contradiction Resolution Audit Matrix Builder
 * (`desktop/windows/browser/contradiction-resolution-matrix.cjs`).
 *
 * Deepens Requirement #2 & #5:
 * - Takes competing claims across multiple sources for each `(optionName, criterion)`.
 * - Uses `compareFactsForCriterion` (`eventDate > pageDate > fetchedAt`) to determine:
 *   1. Whether the claims actually corroborate each other after unit/currency normalization, or
 *   2. Which claim is the current authoritative record (`authoritativeFact`) and which
 *      claims are superseded/outdated (`outdatedFacts`) or contemporaneously conflicting.
 * - Produces a dedicated Markdown and JSON Contradiction Resolution Matrix saved via
 *   `workspace-service.cjs` with side-by-side UTF-16 `[startUtf16..endUtf16]` citations.
 */

function buildContradictionResolutionMatrix(claims = []) {
  const byCell = new Map();

  for (const c of claims) {
    if (!c || !c.excerpt || !c.excerpt.quote) continue;
    const key = `${String(c.optionName || "Option").trim()}||${String(
      c.criterion || "Spec"
    ).trim()}`;
    if (!byCell.has(key)) {
      byCell.set(key, []);
    }
    byCell.get(key).push({
      optionName: c.optionName || "Option",
      criterion: c.criterion || "Spec",
      value: c.value || c.excerpt.quote,
      displayValue: c.displayValue || c.value || c.excerpt.quote,
      quote: c.excerpt.quote,
      startUtf16: c.excerpt.startUtf16,
      endUtf16: c.excerpt.endUtf16,
      sourceUrl: c.source?.url || "",
      sourceTitle: c.source?.title || c.source?.url || "",
      pageDate: c.source?.pageDate || null,
      eventDate: c.source?.eventDate || null,
      fetchedAt: c.source?.fetchedAt || null,
      excerpt: {
        quote: c.excerpt.quote,
        startUtf16: c.excerpt.startUtf16,
        endUtf16: c.excerpt.endUtf16
      },
      source: {
        url: c.source?.url || "",
        title: c.source?.title || c.source?.url || "",
        pageDate: c.source?.pageDate || null,
        eventDate: c.source?.eventDate || null,
        fetchedAt: c.source?.fetchedAt || null
      }
    });
  }

  const cells = [];
  for (const [key, cellFacts] of byCell.entries()) {
    const [optionName, criterion] = key.split("||");
    const cmp = compareFactsForCriterion(cellFacts);
    const outdatedFacts = cellFacts.filter((f) => f.isOutdated);

    cells.push({
      optionName,
      criterion,
      status: cmp.hasConflict ? "contradiction" : cmp.status,
      corroboratedByMultipleSources: Number(cmp.corroboratingSourcesCount || 0) >= 2,
      authoritativeFact: cmp.primaryFact || null,
      outdatedFacts,
      contradiction: cmp.contradiction || null,
      outdatedFinding: cmp.outdatedFinding || null,
      totalFactsCompared: cellFacts.length
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCells: cells.length,
    contradictionCellsCount: cells.filter((c) => c.status === "contradiction").length,
    corroboratedCellsCount: cells.filter((c) => c.corroboratedByMultipleSources).length,
    cells
  };
}

function renderContradictionMatrixMarkdown(matrix) {
  const lines = [
    "# Матрица разрешения противоречий и сверки дат источников",
    "",
    `| Вариант | Критерий | Статус | Актуальное значение (UTF-16 выдержка) | Устаревшие / конфликтующие данные |`,
    `| --- | --- | --- | --- | --- |`
  ];

  for (const cell of matrix.cells || []) {
    const auth = cell.authoritativeFact;
    const authCell = auth
      ? `**${auth.displayValue}** — «${auth.quote}» [${auth.startUtf16}..${auth.endUtf16}] (${auth.sourceUrl}, eventDate: ${auth.eventDate || "н/д"}, pageDate: ${auth.pageDate || "н/д"})`
      : "Неизвестно";

    const outdatedCell =
      (cell.outdatedFacts || []).length > 0
        ? cell.outdatedFacts
            .map(
              (o) =>
                `Устарело: \`${o.displayValue}\` — «${o.quote}» [${o.startUtf16}..${o.endUtf16}] (${o.sourceUrl}, eventDate: ${o.eventDate || "н/д"})`
            )
            .join("; ")
        : "Нет расхождений";

    lines.push(
      `| ${cell.optionName} | ${cell.criterion} | ${cell.status} | ${authCell} | ${outdatedCell} |`
    );
  }

  return lines.join("\n") + "\n";
}

async function saveContradictionResolutionMatrixViaWorkspace({
  workspaceRoot,
  slug = "contradiction-resolution-matrix",
  claims = [],
  signal = null
} = {}) {
  const matrix = buildContradictionResolutionMatrix(claims);
  const md = renderContradictionMatrixMarkdown(matrix);
  const json = JSON.stringify(matrix, null, 2) + "\n";

  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const mdFile = await svc.createFile({
    relativePath: `reports/${slug}.md`,
    content: md,
    createParents: true,
    signal
  });
  const jsonFile = await svc.createFile({
    relativePath: `reports/${slug}.json`,
    content: json,
    createParents: true,
    signal
  });

  return {
    matrix,
    markdownFile: mdFile,
    jsonFile
  };
}

module.exports = {
  buildContradictionResolutionMatrix,
  renderContradictionMatrixMarkdown,
  saveContradictionResolutionMatrixViaWorkspace
};
