"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Zero-dependency JUnit XML (.junit.xml) & Test Anything Protocol v14 (.tap)
 * Verification Report Bundle Builder for Koswork Desktop & CI Pipelines.
 */
function buildJunitAndTapReports(spec = {}) {
  const suiteName = spec.suiteName || "KosmoraVerificationSuite";
  const cases = Array.isArray(spec.testCases) ? spec.testCases : [];

  let failures = 0;
  let totalTimeSec = 0;

  for (const tc of cases) {
    if (tc.passed === false) failures++;
    totalTimeSec += Number(tc.durationMs || 0) / 1000;
  }

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">`
  ];

  const tapLines = ["TAP version 14", `1..${cases.length}`];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    const name = tc.name || `TestCase_${i + 1}`;
    const cls = tc.className || suiteName;
    const sec = (Number(tc.durationMs || 1) / 1000).toFixed(3);
    const passed = tc.passed !== false;

    if (passed) {
      xmlLines.push(
        `    <testcase name="${escapeXml(name)}" classname="${escapeXml(cls)}" time="${sec}"/>`
      );
      tapLines.push(`ok ${i + 1} - ${name}`);
    } else {
      const msg = tc.failureMessage || "Assertion failed";
      xmlLines.push(
        `    <testcase name="${escapeXml(name)}" classname="${escapeXml(cls)}" time="${sec}">`,
        `      <failure message="${escapeXml(msg)}">${escapeXml(msg)}</failure>`,
        "    </testcase>"
      );
      tapLines.push(
        `not ok ${i + 1} - ${name}`,
        "  ---",
        `  message: ${JSON.stringify(msg)}`,
        "  ..."
      );
    }
  }

  xmlLines.push("  </testsuite>", "</testsuites>");

  return {
    junitXml: xmlLines.join("\n") + "\n",
    tapReport: tapLines.join("\n") + "\n",
    totalTests: cases.length,
    failureCount: failures
  };
}

function saveJunitAndTapToWorkspace(workspaceDir, baseName, spec) {
  if (!workspaceDir || typeof workspaceDir !== "string") {
    throw new Error("WORKSPACE_REQUIRED");
  }
  const cleanBase = path
    .basename(baseName || "verification-report")
    .replace(/\.(junit\.xml|xml|tap)$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolvedWorkspace = path.resolve(workspaceDir);

  const junitPath = path.resolve(resolvedWorkspace, `${cleanBase}.junit.xml`);
  const tapPath = path.resolve(resolvedWorkspace, `${cleanBase}.tap`);

  if (!junitPath.startsWith(resolvedWorkspace + path.sep)) {
    throw new Error("PATH_TRAVERSAL_BLOCKED");
  }

  fs.mkdirSync(resolvedWorkspace, { recursive: true });
  const built = buildJunitAndTapReports(spec);
  fs.writeFileSync(junitPath, built.junitXml, "utf8");
  fs.writeFileSync(tapPath, built.tapReport, "utf8");

  return {
    junitPath,
    tapPath,
    totalTests: built.totalTests,
    failureCount: built.failureCount,
    sha256: crypto
      .createHash("sha256")
      .update(built.junitXml + built.tapReport, "utf8")
      .digest("hex")
  };
}

module.exports = {
  buildJunitAndTapReports,
  saveJunitAndTapToWorkspace
};
