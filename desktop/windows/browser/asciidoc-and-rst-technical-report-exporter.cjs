"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork AsciiDoc (`.adoc`) & reStructuredText (`.rst`) Technical Report Exporter
 * (`desktop/windows/browser/asciidoc-and-rst-technical-report-exporter.cjs`).
 *
 * Deepens Requirement #5:
 * - Exports a multi-site research report into engineering documentation formats:
 *   1. AsciiDoc (`reports/<slug>.adoc`, Asciidoctor / Antora compatible)
 *   2. reStructuredText (`reports/<slug>.rst`, Sphinx / ReadTheDocs compatible)
 *   via `workspace-service.cjs`.
 * - Preserves verbatim quotes, exact UTF-16 `[startUtf16..endUtf16]` offsets, distinct
 *   `pageDate` / `eventDate` / `fetchedAt` dates, and explicit admonition blocks for
 *   contradictions, outdated sources, HTTP 503 unavailable sources, and unknowns.
 */

function renderAsciiDocAndReStructuredTextReport(report = {}) {
  const question = report.question || "Технический отчёт исследования Koswork Browser";

  // 1. AsciiDoc (.adoc)
  const adocLines = [
    `= ${question}`,
    ":doctype: article",
    ":toc: left",
    "",
    "== Сводная таблица сравнения (с дословными выдержками UTF-16)",
    "",
    '[cols="1,1,1,3", options="header"]',
    "|===",
    "| Вариант | Критерий | Значение | Дословная выдержка UTF-16 и даты источника"
  ];

  // 2. reStructuredText (.rst)
  const rstTitleBar = "=".repeat(Math.max(10, question.length));
  const rstLines = [
    rstTitleBar,
    question,
    rstTitleBar,
    "",
    "Сводная таблица сравнения (с дословными выдержками UTF-16)",
    "---------------------------------------------------------",
    "",
    ".. list-table:: Верифицированные утверждения",
    "   :header-rows: 1",
    "",
    "   * - Вариант",
    "     - Критерий",
    "     - Значение",
    "     - Дословная выдержка UTF-16 и даты источника"
  ];

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      if (!cell || !cell.quote || !Number.isInteger(cell.startUtf16) || cell.startUtf16 < 0) {
        adocLines.push(
          `| ${optionName} | ${criterion} | Неизвестно | Нет подтверждающей UTF-16 выдержки`
        );
        rstLines.push(
          `   * - ${optionName}`,
          `     - ${criterion}`,
          `     - Неизвестно`,
          `     - Нет подтверждающей UTF-16 выдержки`
        );
        continue;
      }

      const val = cell.displayValue || cell.value || "";
      const citationText = `«${cell.quote}» [${cell.startUtf16}..${cell.endUtf16}] (${cell.sourceUrl}, pageDate: ${cell.pageDate || "н/д"}, eventDate: ${cell.eventDate || "н/д"}, fetchedAt: ${cell.fetchedAt || "н/д"})`;
      adocLines.push(`| ${optionName} | ${criterion} | ${val} | ${citationText}`);
      rstLines.push(
        `   * - ${optionName}`,
        `     - ${criterion}`,
        `     - ${val}`,
        `     - ${citationText}`
      );
    }
  }

  adocLines.push("|===", "");
  rstLines.push("");

  if ((report.contradictions || []).length > 0) {
    adocLines.push("== Межсайтовые противоречия", "");
    rstLines.push("Межсайтовые противоречия", "------------------------", "");
    for (const c of report.contradictions || []) {
      adocLines.push(
        `WARNING: *${c.optionName || ""} / ${c.criterion || ""}:* ${c.summary || ""}`,
        ""
      );
      rstLines.push(
        `.. warning:: **${c.optionName || ""} / ${c.criterion || ""}:** ${c.summary || ""}`,
        ""
      );
    }
  }

  if ((report.unavailableSources || []).length > 0) {
    adocLines.push("== Недоступные источники", "");
    rstLines.push("Недоступные источники", "---------------------", "");
    for (const u of report.unavailableSources || []) {
      adocLines.push(`NOTE: Источник ${u.url} вернул статус HTTP ${u.statusCode || 503}`, "");
      rstLines.push(
        `.. note:: Источник \`\`${u.url}\`\` вернул статус HTTP ${u.statusCode || 503}`,
        ""
      );
    }
  }

  return {
    asciidocText: adocLines.join("\n") + "\n",
    rstText: rstLines.join("\n") + "\n"
  };
}

async function saveAsciiDocAndRstReportViaWorkspace({
  workspaceRoot,
  slug = "research-technical-docs",
  report = {},
  signal = null
} = {}) {
  const rendered = renderAsciiDocAndReStructuredTextReport(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const adocFile = await svc.createFile({
    relativePath: `reports/${slug}.adoc`,
    content: rendered.asciidocText,
    createParents: true,
    signal
  });
  const rstFile = await svc.createFile({
    relativePath: `reports/${slug}.rst`,
    content: rendered.rstText,
    createParents: true,
    signal
  });

  return {
    ...rendered,
    adocFile,
    rstFile
  };
}

module.exports = {
  renderAsciiDocAndReStructuredTextReport,
  saveAsciiDocAndRstReportViaWorkspace
};
