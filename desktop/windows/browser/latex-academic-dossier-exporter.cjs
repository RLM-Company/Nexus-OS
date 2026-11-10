"use strict";

const crypto = require("node:crypto");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork LaTeX Academic Research Dossier & BibTeX Exporter
 * (`desktop/windows/browser/latex-academic-dossier-exporter.cjs`).
 *
 * Deepens Requirement #5:
 * - Exports a multi-site research report into a publication-ready LaTeX `.tex` dossier
 *   (`reports/<slug>.tex`) and synchronized `.bib` file (`reports/<slug>.bib`) via
 *   `workspace-service.cjs`.
 * - Embeds `\cite{...}` keys, verbatim UTF-16 `[startUtf16..endUtf16]` quotes, distinct
 *   `pageDate`, `eventDate`, and `fetchedAt` timestamps, and dedicated sections for
 *   inter-site contradictions, outdated sources, HTTP 503 unavailable sources, and unknowns.
 */

function escapeLatex(raw = "") {
  return String(raw ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function makeCiteKey(url = "", idx = 1) {
  const hash = crypto
    .createHash("sha256")
    .update(String(url || idx), "utf8")
    .digest("hex")
    .slice(0, 8);
  return `kosworksrc${idx}_${hash}`;
}

function renderResearchReportLatexDossier(report = {}) {
  const question = report.question || "Многосайтовое исследование Koswork Browser";
  const citeKeyByUrl = new Map();
  const bibEntries = [];
  let srcCounter = 1;

  function ensureCiteKey(url, title, pageDate, eventDate, fetchedAt) {
    const cleanUrl = String(url || "https://corpus.local/unknown");
    if (citeKeyByUrl.has(cleanUrl)) {
      return citeKeyByUrl.get(cleanUrl);
    }
    const key = makeCiteKey(cleanUrl, srcCounter);
    srcCounter += 1;
    citeKeyByUrl.set(cleanUrl, key);

    const year =
      String(eventDate || pageDate || fetchedAt || "2026").slice(0, 4) || "2026";
    bibEntries.push(
      [
        `@misc{${key},`,
        `  title = {${escapeLatex(title || cleanUrl)}},`,
        `  howpublished = {\\url{${cleanUrl}}},`,
        `  year = {${escapeLatex(year)}},`,
        `  note = {pageDate: ${escapeLatex(pageDate || "n/a")}, eventDate: ${escapeLatex(eventDate || "n/a")}, fetchedAt: ${escapeLatex(fetchedAt || "n/a")}}`,
        `}`
      ].join("\n")
    );
    return key;
  }

  const texLines = [
    "\\documentclass[11pt,a4paper]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T2A]{fontenc}",
    "\\usepackage[russian,english]{babel}",
    "\\usepackage{booktabs}",
    "\\usepackage{longtable}",
    "\\usepackage{hyperref}",
    `\\title{${escapeLatex(question)}}`,
    "\\author{Koswork Browser Research Engine}",
    `\\date{${escapeLatex(new Date().toISOString().slice(0, 10))}}`,
    "\\begin{document}",
    "\\maketitle",
    "",
    "\\section{Подтверждённые данные и таблица сравнения (с UTF-16 выдержками)}",
    "\\begin{longtable}{p{2.8cm}p{2.8cm}p{2.2cm}p{6.5cm}}",
    "\\toprule",
    "Вариант & Критерий & Значение & Дословная выдержка UTF-16 и источник \\\\",
    "\\midrule"
  ];

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      if (!cell || !cell.quote || !Number.isInteger(cell.startUtf16) || cell.startUtf16 < 0) {
        texLines.push(
          `${escapeLatex(optionName)} & ${escapeLatex(criterion)} & Неизвестно & Нет подтверждающей UTF-16 выдержки \\\\`
        );
        continue;
      }
      const citeKey = ensureCiteKey(
        cell.sourceUrl,
        cell.sourceTitle,
        cell.pageDate,
        cell.eventDate,
        cell.fetchedAt
      );
      const quoteStr = `«${escapeLatex(cell.quote)}» [${cell.startUtf16}..${cell.endUtf16}] \\cite{${citeKey}} (pageDate: ${escapeLatex(cell.pageDate || "н/д")}, eventDate: ${escapeLatex(cell.eventDate || "н/д")})`;
      texLines.push(
        `${escapeLatex(optionName)} & ${escapeLatex(criterion)} & ${escapeLatex(cell.displayValue || cell.value || "")} & ${quoteStr} \\\\`
      );
    }
  }

  texLines.push("\\bottomrule", "\\end{longtable}", "");

  texLines.push("\\section{Межсайтовые противоречия и устаревшие данные}");
  if ((report.contradictions || []).length === 0) {
    texLines.push("Противоречий между источниками не зафиксировано.");
  } else {
    texLines.push("\\begin{itemize}");
    for (const c of report.contradictions || []) {
      texLines.push(
        `  \\item \\textbf{${escapeLatex(c.optionName || "")} / ${escapeLatex(c.criterion || "")}:} ${escapeLatex(c.summary || "")}`
      );
    }
    texLines.push("\\end{itemize}");
  }

  texLines.push("", "\\section{Недоступные источники и неизвестные поля}");
  if ((report.unavailableSources || []).length === 0 && (report.unknowns || []).length === 0) {
    texLines.push("Все проверенные источники доступны; неподтверждённых полей нет.");
  } else {
    texLines.push("\\begin{itemize}");
    for (const u of report.unavailableSources || []) {
      texLines.push(
        `  \\item Недоступный источник: \\url{${u.url}} (HTTP ${escapeLatex(String(u.statusCode || 503))})`
      );
    }
    for (const unk of report.unknowns || []) {
      texLines.push(
        `  \\item Неизвестно: \\textbf{${escapeLatex(unk.optionName || "")} / ${escapeLatex(unk.criterion || "")}}`
      );
    }
    texLines.push("\\end{itemize}");
  }

  texLines.push("", "\\end{document}", "");

  return {
    latexSource: texLines.join("\n"),
    bibtexSource: bibEntries.join("\n\n") + "\n",
    citationCount: bibEntries.length
  };
}

async function saveLatexAcademicDossierViaWorkspace({
  workspaceRoot,
  slug = "research-academic-dossier",
  report = {},
  signal = null
} = {}) {
  const rendered = renderResearchReportLatexDossier(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const texFile = await svc.createFile({
    relativePath: `reports/${slug}.tex`,
    content: rendered.latexSource,
    createParents: true,
    signal
  });
  const bibFile = await svc.createFile({
    relativePath: `reports/${slug}.bib`,
    content: rendered.bibtexSource,
    createParents: true,
    signal
  });

  return {
    citationCount: rendered.citationCount,
    texFile,
    bibFile,
    latexSource: rendered.latexSource,
    bibtexSource: rendered.bibtexSource
  };
}

module.exports = {
  escapeLatex,
  renderResearchReportLatexDossier,
  saveLatexAcademicDossierViaWorkspace
};
