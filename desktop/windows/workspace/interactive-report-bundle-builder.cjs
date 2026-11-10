"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonLdSerialize(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Generates an inline SVG bar chart from series data [{ label, value }] without external libraries.
 */
function renderInlineSvgChart(chartSpec = {}) {
  const title = escapeHtml(chartSpec.title || "Telemetry Metric Breakdown");
  const series = Array.isArray(chartSpec.series) ? chartSpec.series : [];
  if (series.length === 0) return "";

  const width = 560;
  const barHeight = 28;
  const gap = 12;
  const topPad = 42;
  const height = topPad + series.length * (barHeight + gap) + 16;
  const maxVal = Math.max(1, ...series.map((s) => Math.abs(Number(s.value) || 0)));

  const barsSvg = series
    .map((item, idx) => {
      const y = topPad + idx * (barHeight + gap);
      const val = Number(item.value) || 0;
      const barWidth = Math.max(4, Math.round((Math.abs(val) / maxVal) * 320));
      const label = escapeHtml(item.label || `Item ${idx + 1}`);
      const unit = escapeHtml(chartSpec.unit || "");
      return `
        <g transform="translate(0, ${y})">
          <text x="12" y="19" font-family="Segoe UI, system-ui, sans-serif" font-size="13" fill="#1e293b">${label}</text>
          <rect x="160" y="2" width="${barWidth}" height="24" rx="4" fill="#2563eb" />
          <text x="${168 + barWidth}" y="19" font-family="Segoe UI, system-ui, sans-serif" font-size="13" font-weight="600" fill="#0f172a">${val}${unit ? " " + unit : ""}</text>
        </g>`;
    })
    .join("\n");

  return `
    <figure class="koswork-svg-chart" style="margin: 18px 0; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc;">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${title}">
        <text x="12" y="24" font-family="Segoe UI, system-ui, sans-serif" font-size="15" font-weight="700" fill="#0f172a">${title}</text>
        ${barsSvg}
      </svg>
    </figure>`;
}

/**
 * Compiles a self-contained, CSP-hardened, print-ready interactive HTML5 report bundle
 * with inline SVG vector charts, formatted LaTeX math blocks, and SHA-256 provenance manifest.
 */
function buildInteractiveReportHtml(spec = {}) {
  const title = escapeHtml(spec.title || "Koswork Interactive Report");
  const subtitle = escapeHtml(spec.subtitle || "");
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const sources = Array.isArray(spec.sources) ? spec.sources : [];
  const generatedAtIso = spec.generatedAtIso || new Date().toISOString();

  const sectionsHtml = sections
    .map((sec, idx) => {
      const heading = escapeHtml(sec.heading || `Section ${idx + 1}`);
      const paragraphs = (Array.isArray(sec.paragraphs) ? sec.paragraphs : [sec.body || ""])
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("\n");

      const formulaHtml = sec.latexFormula
        ? `<div class="koswork-math-block" data-latex="${escapeHtml(sec.latexFormula)}" style="font-family: 'Cambria Math', 'Latin Modern Math', serif; background: #f1f5f9; padding: 10px 14px; border-left: 4px solid #3b82f6; margin: 12px 0; font-style: italic;">${escapeHtml(sec.latexFormula)}</div>`
        : "";

      const chartHtml = sec.chart ? renderInlineSvgChart(sec.chart) : "";

      return `
        <section id="section-${idx + 1}" style="margin-bottom: 28px;">
          <h2 style="font-size: 1.25rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">${heading}</h2>
          ${paragraphs}
          ${formulaHtml}
          ${chartHtml}
        </section>`;
    })
    .join("\n");

  const sourcesHtml =
    sources.length > 0
      ? `<section id="verified-sources" style="margin-top: 32px; border-top: 2px solid #cbd5e1; padding-top: 16px;">
          <h2 style="font-size: 1.15rem; color: #0f172a;">Verified Citations &amp; Provenance</h2>
          <ul>
            ${sources
              .map(
                (s) =>
                  `<li><a href="${escapeHtml(s.url)}" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`
              )
              .join("\n")}
          </ul>
        </section>`
      : "";

  const provenancePayload = JSON.stringify({
    title: spec.title || "Koswork Interactive Report",
    generatedAtIso,
    sectionCount: sections.length,
    sourceCount: sources.length
  });
  const provenanceSha256 = crypto.createHash("sha256").update(provenancePayload, "utf8").digest("hex");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #1e293b; max-width: 860px; margin: 32px auto; padding: 0 24px; line-height: 1.6; }
    header { margin-bottom: 28px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
    h1 { margin: 0 0 6px 0; font-size: 1.75rem; color: #0f172a; }
    .subtitle { color: #475569; font-size: 1rem; margin: 0; }
    @media print { body { margin: 0; max-width: 100%; } }
  </style>
  <script type="application/ld+json" id="koswork-provenance-manifest">
${safeJsonLdSerialize({ "@context": "https://schema.org", "@type": "Report", name: spec.title || "Koswork Interactive Report", dateCreated: generatedAtIso, sha256: provenanceSha256 })}
  </script>
</head>
<body>
  <header>
    <h1>${title}</h1>
    ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
  </header>
  <main>
    ${sectionsHtml}
    ${sourcesHtml}
  </main>
</body>
</html>`;
}

function saveInteractiveReportToWorkspace(workspaceDir, filename, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED: workspaceDir must be a valid path");
  }
  const safeBase = path.basename(filename || "report.html").replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalName = safeBase.endsWith(".html") ? safeBase : `${safeBase}.html`;
  const resolvedWorkspace = path.resolve(workspaceDir);
  const targetPath = path.resolve(resolvedWorkspace, finalName);

  if (!targetPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED: output file must reside inside workspaceDir");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const html = buildInteractiveReportHtml(spec);
  fs.writeFileSync(targetPath, html, "utf8");

  return {
    filePath: targetPath,
    byteLength: Buffer.byteLength(html, "utf8"),
    sha256: crypto.createHash("sha256").update(html, "utf8").digest("hex")
  };
}

module.exports = {
  renderInlineSvgChart,
  buildInteractiveReportHtml,
  saveInteractiveReportToWorkspace
};
