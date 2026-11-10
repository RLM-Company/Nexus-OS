"use strict";

const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");

/**
 * Koswork JUnit XML & TAP v14 Epistemic Verification Exporter
 * (`desktop/windows/browser/junit-and-tap-verification-exporter.cjs`).
 *
 * Deepens Requirement #5 & End-to-End Acceptance:
 * - Exports a multi-site research report into standard CI/CD verification formats:
 *   1. JUnit XML (`reports/<slug>-junit.xml`)
 *   2. TAP Version 14 (`reports/<slug>.tap`)
 *   via `workspace-service.cjs`.
 * - Encodes each verified `(optionName, criterion)` claim with its verbatim UTF-16
 *   `[startUtf16..endUtf16]` quote and `pageDate`/`eventDate`/`fetchedAt` as a passing
 *   test case, encodes bare-link rejections as `<failure>` test cases, and encodes
 *   HTTP 503 unavailable sources as `<skipped>` diagnostic test cases.
 */

function escapeXml(raw = "") {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildJUnitXmlAndTap14ResearchReport(report = {}) {
  const question = report.question || "Koswork Browser Research Verification";
  const testCases = [];

  for (const row of report.comparisonRows || []) {
    const optionName = row.optionName || "Option";
    for (const [criterion, cell] of Object.entries(row.cells || {})) {
      const hasValidQuote =
        Boolean(cell && cell.quote && String(cell.quote).trim().length > 0) &&
        Number.isInteger(cell.startUtf16) &&
        cell.startUtf16 >= 0 &&
        Number.isInteger(cell.endUtf16) &&
        cell.endUtf16 > cell.startUtf16;

      if (hasValidQuote) {
        testCases.push({
          name: `${optionName} :: ${criterion} (${cell.displayValue || cell.value || ""})`,
          classname: "KosworkBrowserResearch.VerifiedClaim",
          status: "passed",
          detail: `Quote: "${cell.quote}" [${cell.startUtf16}..${cell.endUtf16}] (${cell.sourceUrl}, pageDate=${cell.pageDate || "n/a"}, eventDate=${cell.eventDate || "n/a"})`
        });
      } else if (cell && cell.sourceUrl) {
        testCases.push({
          name: `${optionName} :: ${criterion} (Bare Link Rejected)`,
          classname: "KosworkBrowserResearch.BareLinkGuard",
          status: "failed",
          failureType: "BARE_LINK_NOT_PROOF_OF_CLAIM",
          detail: `Bare URL ${cell.sourceUrl} rejected because no verbatim UTF-16 quote was provided.`
        });
      }
    }
  }

  for (const unav of report.unavailableSources || []) {
    testCases.push({
      name: `Unavailable Source :: ${unav.url}`,
      classname: "KosworkBrowserResearch.SourceAvailability",
      status: "skipped",
      detail: `HTTP ${unav.statusCode || 503} (${unav.reason || "Service Unavailable"})`
    });
  }

  const totalTests = testCases.length;
  const failuresCount = testCases.filter((t) => t.status === "failed").length;
  const skippedCount = testCases.filter((t) => t.status === "skipped").length;
  const passedCount = testCases.filter((t) => t.status === "passed").length;

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(question)}" tests="${totalTests}" failures="${failuresCount}" skipped="${skippedCount}">`,
    `  <testsuite name="KosworkBrowserResearchSuite" tests="${totalTests}" failures="${failuresCount}" skipped="${skippedCount}">`
  ];

  const tapLines = ["TAP version 14", `1..${totalTests}`];

  for (let i = 0; i < testCases.length; i += 1) {
    const tc = testCases[i];
    const num = i + 1;
    xmlLines.push(
      `    <testcase name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}">`
    );
    if (tc.status === "failed") {
      xmlLines.push(
        `      <failure message="${escapeXml(tc.detail)}" type="${escapeXml(tc.failureType || "EPIC_FAILURE")}">${escapeXml(tc.detail)}</failure>`
      );
      tapLines.push(`not ok ${num} - ${tc.name}`);
      tapLines.push("  ---");
      tapLines.push(`  message: ${JSON.stringify(tc.detail)}`);
      tapLines.push("  ...");
    } else if (tc.status === "skipped") {
      xmlLines.push(`      <skipped message="${escapeXml(tc.detail)}" />`);
      tapLines.push(`ok ${num} - ${tc.name} # SKIP ${tc.detail}`);
    } else {
      xmlLines.push(
        `      <system-out>${escapeXml(tc.detail)}</system-out>`
      );
      tapLines.push(`ok ${num} - ${tc.name}`);
    }
    xmlLines.push("    </testcase>");
  }

  xmlLines.push("  </testsuite>", "</testsuites>", "");

  return {
    totalTests,
    passedCount,
    failuresCount,
    skippedCount,
    junitXml: xmlLines.join("\n"),
    tap14Text: tapLines.join("\n") + "\n"
  };
}

async function saveJUnitAndTapVerificationReportViaWorkspace({
  workspaceRoot,
  slug = "research-verification",
  report = {},
  signal = null
} = {}) {
  const built = buildJUnitXmlAndTap14ResearchReport(report);
  const svc = createKosworkWorkspaceService();
  await svc.connectFolder({ folderPath: workspaceRoot, signal });

  const junitFile = await svc.createFile({
    relativePath: `reports/${slug}-junit.xml`,
    content: built.junitXml,
    createParents: true,
    signal
  });
  const tapFile = await svc.createFile({
    relativePath: `reports/${slug}.tap`,
    content: built.tap14Text,
    createParents: true,
    signal
  });

  return {
    ...built,
    junitFile,
    tapFile
  };
}

module.exports = {
  buildJUnitXmlAndTap14ResearchReport,
  saveJUnitAndTapVerificationReportViaWorkspace
};
