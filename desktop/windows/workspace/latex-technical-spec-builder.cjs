"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Escapes plain text for safe LaTeX2e rendering outside math environments.
 */
function escapeLatexText(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/**
 * Compiles a structured LaTeX2e (.tex) Academic & Technical Specification document
 * with formal theorems, mathematical equations, booktabs tables, and bibliography citations.
 */
function buildLatexTechnicalSpec(spec = {}) {
  const title = escapeLatexText(spec.title || "Kosmora Formal Technical Specification");
  const author = escapeLatexText(spec.author || "Kosmora Autonomous Architecture Engine");
  const dateStr = escapeLatexText(spec.date || "2026-11-04");
  const abstractText = escapeLatexText(spec.abstract || "");
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const citations = Array.isArray(spec.citations) ? spec.citations : [];

  const sectionsTex = sections
    .map((sec) => {
      const heading = escapeLatexText(sec.heading || "Section");
      const bodyParagraphs = (Array.isArray(sec.paragraphs) ? sec.paragraphs : [sec.body || ""])
        .filter(Boolean)
        .map((p) => escapeLatexText(p))
        .join("\n\n");

      const theoremTex = sec.theorem
        ? `\\begin{theorem}[${escapeLatexText(sec.theorem.name || "Invariant")}]\n${escapeLatexText(sec.theorem.statement)}\n\\end{theorem}`
        : "";

      const equationTex = sec.equationLatex
        ? `\\begin{equation}\n${sec.equationLatex}\n\\end{equation}`
        : "";

      let tableTex = "";
      if (sec.table && Array.isArray(sec.table.headers) && Array.isArray(sec.table.rows)) {
        const colSpec = sec.table.headers.map(() => "l").join(" ");
        const headerRow = sec.table.headers.map((h) => `\\textbf{${escapeLatexText(h)}}`).join(" & ");
        const dataRows = sec.table.rows
          .map((row) => row.map((cell) => escapeLatexText(cell)).join(" & ") + " \\\\")
          .join("\n    ");
        tableTex = [
          "\\begin{table}[htbp]",
          "  \\centering",
          `  \\begin{tabular}{${colSpec}}`,
          "    \\toprule",
          `    ${headerRow} \\\\`,
          "    \\midrule",
          `    ${dataRows}`,
          "    \\bottomrule",
          "  \\end{tabular}",
          sec.table.caption ? `  \\caption{${escapeLatexText(sec.table.caption)}}` : "",
          "\\end{table}"
        ]
          .filter(Boolean)
          .join("\n");
      }

      return [
        `\\section{${heading}}`,
        bodyParagraphs,
        theoremTex,
        equationTex,
        tableTex
      ]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");

  const bibTex =
    citations.length > 0
      ? [
          "\\begin{thebibliography}{99}",
          ...citations.map(
            (c, idx) =>
              `  \\bibitem{ref${idx + 1}} ${escapeLatexText(c.title || "Source")}, \\url{${String(c.url || "").replace(/[{}\\%]/g, "")}}.`
          ),
          "\\end{thebibliography}"
        ].join("\n")
      : "";

  const rawBodyForHash = JSON.stringify({ title: spec.title, sections: spec.sections, citations: spec.citations });
  const provenanceSha256 = crypto.createHash("sha256").update(rawBodyForHash, "utf8").digest("hex");

  return [
    `% KOSWORK_PROVENANCE_SHA256: ${provenanceSha256}`,
    "\\documentclass[11pt,a4paper]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1,T2A]{fontenc}",
    "\\usepackage[english,russian]{babel}",
    "\\usepackage{amsmath,amssymb,amsthm}",
    "\\usepackage{booktabs}",
    "\\usepackage{hyperref}",
    "\\newtheorem{theorem}{Theorem}",
    "",
    `\\title{${title}}`,
    `\\author{${author}}`,
    `\\date{${dateStr}}`,
    "",
    "\\begin{document}",
    "\\maketitle",
    abstractText ? `\\begin{abstract}\n${abstractText}\n\\end{abstract}` : "",
    sectionsTex,
    bibTex,
    "\\end{document}",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function saveLatexSpecToWorkspace(workspaceDir, filename, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED: workspaceDir must be a valid path");
  }
  const safeBase = path.basename(filename || "specification.tex").replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalName = safeBase.endsWith(".tex") ? safeBase : `${safeBase}.tex`;
  const resolvedWorkspace = path.resolve(workspaceDir);
  const targetPath = path.resolve(resolvedWorkspace, finalName);

  if (!targetPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED: target file must reside inside workspaceDir");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const texContent = buildLatexTechnicalSpec(spec);
  fs.writeFileSync(targetPath, texContent, "utf8");

  return {
    filePath: targetPath,
    byteLength: Buffer.byteLength(texContent, "utf8"),
    sha256: crypto.createHash("sha256").update(texContent, "utf8").digest("hex")
  };
}

module.exports = {
  escapeLatexText,
  buildLatexTechnicalSpec,
  saveLatexSpecToWorkspace
};
