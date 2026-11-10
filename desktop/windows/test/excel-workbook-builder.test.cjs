"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildExcelWorkbookXlsxBuffer,
  buildCsvString,
  saveWorkbookToWorkspace
} = require("../workspace/excel-workbook-builder.cjs");
const { extractVaultDocument } = require("../vault-document-extractor.cjs");

test("buildExcelWorkbookXlsxBuffer and saveWorkbookToWorkspace write multi-sheet .xlsx and .csv files that round-trip through vault-document-extractor", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-excel-test-"));
  try {
    const workbookSpec = {
      sheets: [
        {
          name: "Apollo Budget",
          headers: ["Milestone", "BudgetUSD", "LaunchDate"],
          rows: [
            ["Core Infrastructure", 150000, "2026-11-10"],
            ["Autonomous OS Rollout", 100000, "2026-11-15"],
            ["Total", "=SUM(B2:B3)", "2026-11-15"]
          ]
        },
        {
          name: "KPIs",
          headers: ["Metric", "Target"],
          rows: [["Prompt Cache Hit Rate", "87.3%"]]
        }
      ]
    };

    const savedXlsx = saveWorkbookToWorkspace({
      workspaceRoot: tempRoot,
      relativePath: "reports/Apollo-Budget-2026.xlsx",
      workbookSpec
    });

    assert.equal(savedXlsx.saved, true);
    assert.equal(savedXlsx.format, "xlsx");
    assert.ok(savedXlsx.sizeBytes > 200);
    assert.ok(fs.existsSync(savedXlsx.absolutePath));

    // Round-trip extract via vault-document-extractor.cjs
    const xlsxBuf = fs.readFileSync(savedXlsx.absolutePath);
    const extracted = extractVaultDocument(xlsxBuf, { filename: "Apollo-Budget-2026.xlsx" });
    assert.equal(extracted.format, "xlsx");
    assert.ok(extracted.text.includes("Core Infrastructure"));
    assert.ok(extracted.text.includes("150000"));
    assert.ok(extracted.text.includes("Autonomous OS Rollout"));
    assert.ok(extracted.text.includes("87.3%"));

    // CSV export verification
    const savedCsv = saveWorkbookToWorkspace({
      workspaceRoot: tempRoot,
      relativePath: "reports/Apollo-Summary.csv",
      workbookSpec: {
        headers: ["Project, Name", "AllocatedUSD"],
        rows: [["Apollo \"Stage-2\"", 250000]]
      }
    });

    assert.equal(savedCsv.saved, true);
    assert.equal(savedCsv.format, "csv");
    const csvContent = fs.readFileSync(savedCsv.absolutePath, "utf8");
    assert.ok(csvContent.includes('"Project, Name",AllocatedUSD'));
    assert.ok(csvContent.includes('"Apollo ""Stage-2""",250000'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
