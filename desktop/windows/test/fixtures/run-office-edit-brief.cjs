"use strict";
// Offline acceptance: generated sources + real service I/O; no model/provider call.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { input, docxFixture, ops } = require("./office-edit-brief.cjs");
const { createKosworkWorkspaceService } = require("../../workspace/workspace-service.cjs");
const { unpack, extractOfficeText } = require("../../workspace/office-text.cjs");
async function main() {
  const directory = path.resolve(process.argv[2] || "work/office-acceptance");
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory, { recursive: false });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "office-demo-"));
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
    const results = [];
    for (const format of ["docx", "xlsx", "pptx"]) {
      const source = format === "docx" ? docxFixture() : input(format),
        name = `offer.${format}`;
      fs.writeFileSync(path.join(directory, name), source, { flag: "wx" });
      const opened = service.inspectOfficeDocument({ ...auth, relativePath: name });
      const options = {
        ...auth,
        relativePath: name,
        outputPath: `offer.updated.${format}`,
        expectedVersion: opened.version,
        operations: ops[format]
      };
      const preview = service.previewOfficeDocument(options);
      const result = await service.commitOfficeDocument({ ...options, planId: preview.plan_id });
      const saved = fs.readFileSync(path.join(directory, result.path));
      const text = extractOfficeText(result.path, saved).text;
      for (const literal of [
        "00123",
        "07.11.2026",
        "кроме доставки",
        format === "xlsx" ? "19700" : "19 700"
      ])
        if (!text.includes(literal)) throw Error("MISSING_LITERAL:" + literal);
      if (!fs.readFileSync(path.join(directory, name)).equals(source))
        throw Error("SOURCE_CHANGED");
      const before = unpack(source, 16000000).entries,
        after = unpack(saved, 16000000).entries;
      const parts = [...after].map(([part, bytes]) => ({
        part,
        changed: !before.get(part)?.equals(bytes)
      }));
      fs.writeFileSync(
        path.join(directory, `${format}.readback.json`),
        JSON.stringify({ text }, null, 2) + "\n"
      );
      results.push({
        format,
        source_version: opened.version,
        new_version: result.version,
        sha256: result.sha256,
        diff: preview.diff,
        parts,
        original_preserved: true,
        readback_verified: true,
        model_called: false,
        visual_render_verified: false
      });
    }
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(
      JSON.stringify({ directory, formats: results.map((r) => r.format), model_called: false })
    );
  } finally {
    await service.revokeAccess(auth);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
