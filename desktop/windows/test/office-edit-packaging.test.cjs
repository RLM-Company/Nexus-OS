"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { input, docxFixture, ops } = require("./fixtures/office-edit-brief.cjs");
test("manifest-only Office runtime opens, previews and saves all three formats in isolation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const windows = path.resolve(__dirname, ".."),
    packaged = path.join(root, "runtime with spaces");
  const manifest = require("../package.json");
  const runtimeFiles = manifest.build.files.filter(
    (file) =>
      file === "connection-policy.cjs" || (file.startsWith("workspace/") && file.endsWith(".cjs"))
  );
  for (const name of ["office-edit", "office-view", "office-workspace"])
    assert.ok(
      runtimeFiles.includes(`workspace/${name}.cjs`),
      `missing packaged Office runtime: ${name}`
    );
  for (const file of runtimeFiles) {
    const target = path.join(packaged, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(windows, file), target);
  }
  const { createKosworkWorkspaceService } = require(
    path.join(packaged, "workspace/workspace-service.cjs")
  );
  const folder = path.join(root, "files");
  fs.mkdirSync(folder);
  const auth = { ownerId: "fixture", origin: "https://fixture.example.test" };
  const service = createKosworkWorkspaceService({
    userDataPath: path.join(root, "profile"),
    requireOwnerScope: true,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  await service.connectFolder({ ...auth, folderPath: folder });
  for (const format of ["docx", "xlsx", "pptx"]) {
    const source = format === "docx" ? docxFixture() : input(format),
      name = `source.${format}`;
    fs.writeFileSync(path.join(folder, name), source);
    const inspected = service.inspectOfficeDocument({ ...auth, relativePath: name });
    const options = {
      ...auth,
      relativePath: name,
      outputPath: `copy.${format}`,
      expectedVersion: inspected.version,
      operations: ops[format]
    };
    const preview = service.previewOfficeDocument(options);
    const saved = await service.commitOfficeDocument({ ...options, planId: preview.plan_id });
    assert.equal(saved.version, preview.proposed_version);
    assert.equal(saved.readback.version, saved.version);
    assert.deepEqual(fs.readFileSync(path.join(folder, name)), source);
    assert.ok(fs.readFileSync(path.join(folder, saved.path)).length);
  }
});
