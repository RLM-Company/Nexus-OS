"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");
const { parseCsv } = require("../workspace/office-csv.cjs");

const source = [
  "id,title,amount",
  '"00123","Company, A",19700',
  "002,Ünïcode,19800"
].join("\r\n") + "\n";

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-csv-native-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "files");
  fs.mkdirSync(folder);
  const service = createKosworkWorkspaceService({
    userDataPath: path.join(root, "profile"),
    requireOwnerScope: true,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const auth = { ownerId: "owner", origin: "https://example.test" };
  await service.connectFolder({ ...auth, folderPath: folder });
  return { service, auth, folder };
}

test("native workspace previews and commits a real CSV copy with readback and stale conflict", async (t) => {
  const { service, auth, folder } = await setup(t);
  const original = Buffer.from(source, "utf8");
  fs.writeFileSync(path.join(folder, "prices.csv"), original);
  const opened = service.inspectOfficeDocument({ ...auth, relativePath: "prices.csv" });
  assert.equal(opened.representation.format, "csv");
  const args = {
    ...auth,
    relativePath: "prices.csv",
    expectedVersion: opened.version,
    outputPath: "result.csv",
    operations: [
      { kind: "set_cell", target: "table:1", address: "A2", value: "00456" },
      { kind: "set_cell", target: "table:1", address: "C2", value: { formula: "SUM(C1:C1)" } }
    ]
  };
  const preview = service.previewOfficeDocument(args);
  assert.equal(fs.existsSync(path.join(folder, "result.csv")), false);
  assert.equal(preview.diff.length, 2);
  const result = await service.commitOfficeDocument({ ...args, planId: preview.plan_id });
  assert.equal(result.version, preview.proposed_version);
  assert.equal(result.readback.version, result.version);
  assert.deepEqual(fs.readFileSync(path.join(folder, "prices.csv")), original);
  const saved = parseCsv(fs.readFileSync(path.join(folder, "result.csv"), "utf8"));
  assert.equal(saved.rows[1][0], "00456");
  assert.equal(saved.rows[1][2], "=SUM(C1:C1)");
  assert.deepEqual(saved.rows[2], ["002", "Ünïcode", "19800"]);
  // A second commit of the same plan must fail (consumed once).
  await assert.rejects(service.commitOfficeDocument({ ...args, planId: preview.plan_id }));
  // Stale version cannot prepare a new copy.
  const stale = service.previewOfficeDocument({ ...args, outputPath: "stale.csv" });
  fs.writeFileSync(path.join(folder, "prices.csv"), Buffer.from("changed\n", "utf8"));
  await assert.rejects(service.commitOfficeDocument({ ...args, planId: stale.plan_id }));
  assert.equal(fs.existsSync(path.join(folder, "stale.csv")), false);
});

test("native workspace rejects mismatched CSV output extension and unsafe operations", async (t) => {
  const { service, auth, folder } = await setup(t);
  fs.writeFileSync(path.join(folder, "source.csv"), Buffer.from(source, "utf8"));
  const opened = service.inspectOfficeDocument({ ...auth, relativePath: "source.csv" });
  assert.ok(opened.version);
  const base = {
    ...auth,
    relativePath: "source.csv",
    expectedVersion: opened.version,
    operations: [{ kind: "set_cell", target: "table:1", address: "A1", value: "x" }]
  };
  assert.throws(() =>
    service.previewOfficeDocument({ ...base, outputPath: "result.docx" })
  );
  assert.throws(() =>
    service.previewOfficeDocument({
      ...base,
      outputPath: "result.csv",
      operations: [{ kind: "set_cell", target: "sheet:1", address: "A1", value: "x" }]
    })
  );
});
