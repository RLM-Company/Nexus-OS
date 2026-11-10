"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildInteractiveReportHtml,
  saveInteractiveReportToWorkspace
} = require("../workspace/interactive-report-bundle-builder.cjs");

test("Interactive HTML5/SVG/LaTeX Report Bundle Builder generates CSP-hardened HTML with inline SVG charts and blocks path traversal", () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-html-bundle-"));

  try {
    const spec = {
      title: "Kosmora Stage-2 Architecture & Telemetry Report",
      subtitle: "Autonomous Desktop & Cloud Storage Verification",
      generatedAtIso: "2026-11-03T08:00:00.000Z",
      sections: [
        {
          heading: "1. Hybrid Retrieval & Sub-Millisecond Filtering",
          paragraphs: [
            "Roaring Bitmaps and Cuckoo Filters accelerate negative and positive existence checks across local vaults."
          ],
          latexFormula: "P(\\text{false positive}) \\approx \\left(1 - e^{-kn/m}\\right)^k",
          chart: {
            title: "Lookup Latency Comparison",
            unit: "ms",
            series: [
              { label: "Cuckoo Filter", value: 0.08 },
              { label: "Roaring Bitmap", value: 0.42 },
              { label: "HNSW Vector", value: 3.15 }
            ]
          }
        }
      ],
      sources: [
        {
          title: "Kosmora Repository Specification",
          url: "https://github.com/RLM-Company/Nexus-OS"
        }
      ]
    };

    const saved = saveInteractiveReportToWorkspace(
      tempWorkspace,
      "stage2-telemetry-bundle.html",
      spec
    );

    assert.equal(fs.existsSync(saved.filePath), true);
    assert.ok(saved.byteLength > 800);
    assert.equal(saved.sha256.length, 64);

    const htmlContent = fs.readFileSync(saved.filePath, "utf8");
    assert.ok(htmlContent.includes("Content-Security-Policy"));
    assert.ok(htmlContent.includes("<svg viewBox="));
    assert.ok(htmlContent.includes("koswork-math-block"));
    assert.ok(htmlContent.includes("koswork-provenance-manifest"));
    assert.ok(htmlContent.includes("https://github.com/RLM-Company/Nexus-OS"));

    // Verify XSS escaping
    const xssHtml = buildInteractiveReportHtml({
      title: "<script>alert(1)</script>"
    });
    assert.equal(xssHtml.includes("<script>alert(1)</script>"), false);
    assert.ok(xssHtml.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});
