"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildPdfReportBuffer,
  savePdfReportToWorkspace
} = require("../workspace/pdf-report-builder.cjs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");

test("buildPdfReportBuffer and savePdfReportToWorkspace generate multi-page PDF 1.4 documents that round-trip through vault-document-extractor", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-pdf-test-"));
  try {
    const pdfSpec = {
      title: "Project Apollo Final Audit PDF",
      pages: [
        {
          heading: "Executive Summary",
          lines: [
            "Approved Launch Budget: $250,000",
            "Target Release Date: 2026-11-15"
          ]
        },
        {
          heading: "Technical SLA Verification",
          lines: [
            "Prompt Caching Hit Rate: 87.3%",
            "CDC Sub-File Deduplication: Verified"
          ]
        }
      ]
    };

    const saved = savePdfReportToWorkspace({
      workspaceRoot: tempRoot,
      relativePath: "reports/Apollo-Audit-2026.pdf",
      pdfSpec
    });

    assert.equal(saved.saved, true);
    assert.equal(saved.format, "pdf");
    assert.ok(saved.sizeBytes > 300);
    assert.ok(fs.existsSync(saved.absolutePath));

    const pdfBuf = fs.readFileSync(saved.absolutePath);
    const extracted = extractVaultDocument(pdfBuf, { filename: "Apollo-Audit-2026.pdf" });
    assert.equal(extracted.format, "pdf");
    assert.equal(extracted.sectionCount, 2);
    assert.ok(extracted.text.includes("Project Apollo Final Audit PDF"));
    assert.ok(extracted.text.includes("$250,000"));
    assert.ok(extracted.text.includes("Technical SLA Verification"));
    assert.ok(extracted.text.includes("87.3%"));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
