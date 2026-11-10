"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  applyUnifiedDiffPatchAtomically,
  saveSarifReportToWorkspace
} = require("../workspace/sarif-and-patch-bundle-builder.cjs");

test("SARIF 2.1.0 Report Builder and Atomic Unified Diff Patch Applier validate schemas and rollback on hunk mismatch", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-sarif-"));
  try {
    // 1. SARIF 2.1.0 report generation
    const saved = saveSarifReportToWorkspace(tempDir, "security-audit", {
      toolName: "Kosmora-Code-Preflight",
      toolVersion: "2.6.0",
      findings: [
        {
          ruleId: "NON_IDEMPOTENT_DDL",
          level: "error",
          message: "Missing IF NOT EXISTS in CREATE TABLE",
          fileUri: "packages/db/migrations/0063.sql",
          startLine: 42,
          startColumn: 1
        }
      ]
    });

    assert.equal(fs.existsSync(saved.filePath), true);
    const sarif = JSON.parse(fs.readFileSync(saved.filePath, "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].results.length, 1);
    assert.equal(sarif.runs[0].results[0].ruleId, "NON_IDEMPOTENT_DDL");

    // 2. Atomic Unified Diff Patch application
    const originalCode = ["function greet() {", '  return "old";', "}"].join("\n");
    const validPatch = [
      "--- a/greet.js",
      "+++ b/greet.js",
      "@@ -1,3 +1,3 @@",
      " function greet() {",
      '-  return "old";',
      '+  return "new_verified";',
      " }"
    ].join("\n");

    const patched = applyUnifiedDiffPatchAtomically(originalCode, validPatch);
    assert.equal(patched, ["function greet() {", '  return "new_verified";', "}"].join("\n"));

    // 3. Mismatched context line throws HUNK_DELETE_MISMATCH
    const badPatch = [
      "@@ -1,3 +1,3 @@",
      " function greet() {",
      '-  return "wrong_line";',
      '+  return "hacked";',
      " }"
    ].join("\n");

    assert.throws(() => {
      applyUnifiedDiffPatchAtomically(originalCode, badPatch);
    }, /HUNK_DELETE_MISMATCH/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
