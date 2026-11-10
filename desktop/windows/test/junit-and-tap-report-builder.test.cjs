"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildJunitAndTapReports,
  saveJunitAndTapToWorkspace
} = require("../workspace/junit-and-tap-report-builder.cjs");

test("JUnit XML & TAP v14 Report Builder generates valid CI reports and saves cleanly", () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "kosmora-junit-tap-"));

  const built = buildJunitAndTapReports({
    suiteName: "KosmoraPhase11Suite",
    testCases: [
      { name: "FactorGraphBeliefPropagation converges", durationMs: 12, passed: true },
      { name: "HnswHierarchicalVectorIndex recalls top-K", durationMs: 8, passed: true },
      {
        name: "SimulatedFailureCheck",
        durationMs: 4,
        passed: false,
        failureMessage: "Expected <actual> to match <target>"
      }
    ]
  });

  assert.equal(built.totalTests, 3);
  assert.equal(built.failureCount, 1);
  assert.match(built.junitXml, /<testsuites name="KosmoraPhase11Suite"/);
  assert.match(built.junitXml, /Expected &lt;actual&gt; to match &lt;target&gt;/);
  assert.match(built.tapReport, /TAP version 14/);
  assert.match(built.tapReport, /not ok 3 - SimulatedFailureCheck/);

  const saved = saveJunitAndTapToWorkspace(workspaceDir, "phase11-ci", {
    suiteName: "KosmoraPhase11Suite",
    testCases: [{ name: "AllGreen", durationMs: 5, passed: true }]
  });

  assert.equal(fs.existsSync(saved.junitPath), true);
  assert.equal(fs.existsSync(saved.tapPath), true);
  assert.equal(saved.sha256.length, 64);

  assert.throws(() => {
    saveJunitAndTapToWorkspace("", "invalid", {});
  }, /WORKSPACE_REQUIRED/);
});
