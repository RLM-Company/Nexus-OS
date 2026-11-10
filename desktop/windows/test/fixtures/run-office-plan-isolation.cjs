"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { input, docxFixture, ops } = require("./office-edit-brief.cjs");
const { createKosworkWorkspaceService } = require("../../workspace/workspace-service.cjs");
const { extractOfficeText } = require("../../workspace/office-text.cjs");

// Real service/grant/files; synthetic fixture identity, no provider or owner data.
async function scenario(directory, format, mutation) {
  fs.mkdirSync(directory);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "office-plan-isolation-"));
  const service = createKosworkWorkspaceService({
    userDataPath: profile,
    requireOwnerScope: true,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const auth = { ownerId: "fixture-owner", origin: "https://fixture.example.test" };
  try {
    await service.connectFolder({ ...auth, folderPath: directory });
    const name = `source.${format}`;
    const source = format === "docx" ? docxFixture() : input(format);
    fs.writeFileSync(path.join(directory, name), source, { flag: "wx" });
    const opened = service.inspectOfficeDocument({ ...auth, relativePath: name });
    const options = {
      ...auth,
      relativePath: name,
      outputPath: `approved.${format}`,
      expectedVersion: opened.version,
      operations: structuredClone(ops[format])
    };
    const preview = service.previewOfficeDocument(options);
    const approved = structuredClone(preview);
    if (mutation === "receipt") {
      preview.output_path = `unexpected.${format}`;
      preview.diff[0].after = "FORGED RECEIPT";
      preview.rejected_changes.push({ reason: "FORGED REJECTION" });
      preview.representation.limitations.push("FORGED LIMITATION");
    } else {
      const formula = options.operations.find((op) => op.value?.formula);
      assert.ok(formula);
      formula.value.formula = "SUM(A1:A1)";
    }
    const description = service.describeOfficePlan({ ...options, planId: approved.plan_id });
    const describedSnapshot = structuredClone(description);
    description.output_path = `described-unexpected.${format}`;
    description.diff[0].after = "FORGED DESCRIPTION";
    const result = await service.commitOfficeDocument({ ...options, planId: approved.plan_id });
    // Commit deliberately precedes assertions: a regression proves the real write destination.
    assert.equal(result.path, approved.output_path);
    assert.equal(fs.existsSync(path.join(directory, `unexpected.${format}`)), false);
    assert.equal(fs.existsSync(path.join(directory, `described-unexpected.${format}`)), false);
    assert.deepEqual(describedSnapshot, approved);
    assert.deepEqual(result.executed_changes, approved.diff);
    const saved = fs.readFileSync(path.join(directory, result.path));
    const reread = service.inspectOfficeDocument({ ...auth, relativePath: result.path });
    assert.equal(reread.version, approved.proposed_version);
    assert.equal(reread.sha256, approved.sha256);
    assert.equal(result.readback.verified, true);
    assert.deepEqual(fs.readFileSync(path.join(directory, name)), source);
    const text = extractOfficeText(result.path, saved).text;
    for (const literal of [
      "00123",
      "07.11.2026",
      "кроме доставки",
      format === "xlsx" ? "19700" : "19 700"
    ])
      assert.ok(text.includes(literal), literal);
    if (format === "xlsx") {
      assert.ok(text.includes("SUM(B1:B1)"));
      assert.equal(text.includes("SUM(A1:A1)"), false);
    }
    await assert.rejects(service.commitOfficeDocument({ ...options, planId: approved.plan_id }));
    const report = {
      format,
      mutation,
      source_version: opened.version,
      new_version: result.version,
      sha256: reread.sha256,
      approved_path: approved.output_path,
      actual_path: result.path,
      executed_changes: result.executed_changes,
      original_preserved: true,
      unexpected_path_absent: true,
      readback_verified: true,
      real_model_called: false,
      visual_render_verified: false,
      text
    };
    fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx"
    });
    return report;
  } finally {
    await service.revokeAccess(auth);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
const cases = [
  ["docx", "receipt"],
  ["xlsx", "receipt"],
  ["xlsx", "input"],
  ["pptx", "receipt"]
];
module.exports = { scenario, cases };
if (require.main === module) {
  (async () => {
    const directory = path.resolve(process.argv[2] || "work/office-plan-isolation");
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory);
    const results = [];
    for (const [format, mutation] of cases)
      results.push(await scenario(path.join(directory, `${format}-${mutation}`), format, mutation));
    fs.writeFileSync(
      path.join(directory, "results.json"),
      JSON.stringify(results, null, 2) + "\n",
      { flag: "wx" }
    );
    console.log(JSON.stringify({ directory, scenarios: results.length, real_model_called: false }));
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
