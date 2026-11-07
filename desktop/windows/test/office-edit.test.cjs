"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { unpack, extractOfficeText } = require("../workspace/office-text.cjs");
const { editOffice, inspectOffice } = require("../workspace/office-edit.cjs");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");
const { input, docxFixture, ops } = require("./fixtures/office-edit-brief.cjs");
test("brief edits real OpenXML, preserves original and untouched parts, does not evaluate formulas", () => {
  for (const format of ["docx", "xlsx", "pptx"]) {
    const source = format === "docx" ? docxFixture() : input(format),
      original = Buffer.from(source);
    const result = editOffice("offer." + format, source, ops[format]);
    assert.deepEqual(source, original);
    const before = unpack(source, 16000000).entries,
      after = unpack(result.buffer, 16000000).entries;
    if (format === "docx") {
      assert.deepEqual(after.get("word/media/test.bin"), before.get("word/media/test.bin"));
      assert.ok(after.get("word/document.xml").includes(Buffer.from("<w:rPr><w:b/></w:rPr>")));
    }
    if (format === "pptx")
      assert.deepEqual(after.get("ppt/slides/slide2.xml"), before.get("ppt/slides/slide2.xml"));
    if (format === "xlsx") {
      assert.deepEqual(
        after.get("xl/worksheets/sheet1.xml"),
        before.get("xl/worksheets/sheet1.xml")
      );
      assert.ok(
        extractOfficeText("offer.xlsx", result.buffer).text.includes('"cached_value":null')
      );
    }
    const text = extractOfficeText("offer." + format, result.buffer).text;
    for (const value of [
      "00123",
      "кроме доставки",
      "07.11.2026",
      format === "xlsx" ? "19700" : "19 700"
    ])
      assert.ok(text.includes(value), value);
    assert.ok(inspectOffice("offer." + format, result.buffer).targets.length);
  }
});
test("unsupported, unsafe and ambiguous edits fail without a result", () => {
  for (const operation of [
    { kind: "replace_text", target: "paragraph:999", find: "А", replace: "Б" },
    { kind: "replace_text", target: "paragraph:3", find: "absent", replace: "Б" },
    {
      kind: "set_cell",
      target: "sheet:1",
      address: "A1",
      value: { formula: 'WEBSERVICE("https://example.test")' }
    },
    { kind: "set_cell", target: "sheet:1", address: "ZZZ1", value: 1 }
  ])
    assert.throws(() => editOffice("offer.docx", docxFixture(), [operation]));
  const broken = Buffer.from(input("docx"));
  broken[60] ^= 1;
  assert.throws(() => editOffice("offer.docx", broken, ops.docx));
});
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-edit-"));
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
test("transaction: real preview, confirm boundary, saved copy/hash/readback and stale conflict", async (t) => {
  const { service: s, auth, folder } = await setup(t);
  const source = docxFixture();
  fs.writeFileSync(path.join(folder, "offer.docx"), source);
  const opened = s.inspectOfficeDocument({ ...auth, relativePath: "offer.docx" });
  const args = {
    ...auth,
    relativePath: "offer.docx",
    expectedVersion: opened.version,
    outputPath: "result.docx",
    operations: ops.docx
  };
  const preview = s.previewOfficeDocument(args);
  assert.equal(fs.existsSync(path.join(folder, "result.docx")), false);
  const result = await s.commitOfficeDocument({ ...args, planId: preview.plan_id });
  assert.equal(result.version, preview.proposed_version);
  assert.equal(result.readback.version, result.version);
  assert.deepEqual(fs.readFileSync(path.join(folder, "offer.docx")), source);
  await assert.rejects(s.commitOfficeDocument({ ...args, planId: preview.plan_id }));
  const stale = s.previewOfficeDocument({ ...args, outputPath: "stale.docx" });
  fs.writeFileSync(path.join(folder, "offer.docx"), input("docx"));
  await assert.rejects(s.commitOfficeDocument({ ...args, planId: stale.plan_id }), /изменился/);
  assert.equal(fs.existsSync(path.join(folder, "stale.docx")), false);
});
test("cancelled, revoked and wrong-owner plans never write", async (t) => {
  for (const mode of ["cancel", "revoke", "owner", "signal"]) {
    const { service: s, auth, folder } = await setup(t);
    fs.writeFileSync(path.join(folder, "offer.docx"), docxFixture());
    const args = {
      ...auth,
      relativePath: "offer.docx",
      expectedVersion: s.inspectOfficeDocument({ ...auth, relativePath: "offer.docx" }).version,
      outputPath: "result.docx",
      operations: ops.docx
    };
    const preview = s.previewOfficeDocument(args),
      signal = new AbortController();
    if (mode === "cancel") s.cancelAllOperations();
    if (mode === "revoke") await s.revokeAccess(auth);
    if (mode === "owner") args.ownerId = "other";
    if (mode === "signal") signal.abort();
    await assert.rejects(
      s.commitOfficeDocument({ ...args, planId: preview.plan_id, signal: signal.signal })
    );
    assert.equal(fs.existsSync(path.join(folder, "result.docx")), false);
  }
});

test("typed ranges preserve leading zeros, booleans and uncalculated formulas", () => {
  const result = editOffice("offer.xlsx", input("xlsx"), [
    { kind: "add_sheet", name: "Диапазон" },
    {
      kind: "set_range",
      target: "sheet:2",
      start: "A1",
      rows: [
        ["00123", 19700, true],
        ["кроме доставки", { formula: "SUM(B1:B1)" }, null]
      ]
    }
  ]);
  const entries = unpack(result.buffer, 16000000).entries;
  const sheet = entries.get("xl/worksheets/sheet2.xml").toString();
  assert.ok(sheet.includes('r="C1" t="b"><v>1</v>'));
  assert.ok(sheet.includes('r="A1" t="inlineStr"'));
  assert.ok(sheet.includes("<f>SUM(B1:B1)</f>"));
  assert.equal(result.diff.length, 7);
  assert.throws(() =>
    editOffice("offer.xlsx", input("xlsx"), [
      { kind: "set_range", target: "sheet:1", start: "XFD1", rows: [[1, 2]] }
    ])
  );
});
test("existing PowerPoint placeholders and non-target slides survive targeted text edits", () => {
  const { zip } = require("../workspace/office-document.cjs");
  const entries = unpack(input("pptx"), 16000000).entries;
  const part = "ppt/slides/slide1.xml";
  entries.set(
    part,
    Buffer.from(
      entries
        .get(part)
        .toString()
        .replace(
          '<p:cNvPr id="2" name="Text 2"/><p:cNvSpPr txBox="1"/><p:nvPr/>',
          '<p:cNvPr id="2" name="Text 2"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title"/></p:nvPr>'
        )
    )
  );
  const result = editOffice("offer.pptx", zip([...entries]), ops.pptx);
  const after = unpack(result.buffer, 16000000).entries;
  assert.ok(after.get(part).includes(Buffer.from('<p:ph type="title"/>')));
  assert.deepEqual(after.get("ppt/slides/slide2.xml"), entries.get("ppt/slides/slide2.xml"));
});
test("source mutation, cancellation and revocation during the destination-lock await write nothing", async (t) => {
  for (const mode of ["source", "cancel", "revoke"]) {
    const { service: s, auth, folder } = await setup(t);
    fs.writeFileSync(path.join(folder, "offer.docx"), docxFixture());
    const args = {
      ...auth,
      relativePath: "offer.docx",
      outputPath: "raced.docx",
      expectedVersion: s.inspectOfficeDocument({ ...auth, relativePath: "offer.docx" }).version,
      operations: ops.docx
    };
    const plan = s.previewOfficeDocument(args);
    const committing = s.commitOfficeDocument({ ...args, planId: plan.plan_id });
    if (mode === "source") fs.writeFileSync(path.join(folder, "offer.docx"), input("docx"));
    if (mode === "cancel") s.cancelAllOperations();
    if (mode === "revoke") await s.revokeAccess(auth);
    await assert.rejects(committing);
    assert.equal(fs.existsSync(path.join(folder, "raced.docx")), false);
  }
});
test("edits reject symlink ZIP entries, macros and DTDs even in unselected XML parts", () => {
  const { zip } = require("../workspace/office-document.cjs");
  const valid = docxFixture();
  const symlink = Buffer.from(valid),
    central = symlink.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  symlink.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  assert.throws(() => editOffice("offer.docx", symlink, ops.docx));
  for (const [name, bytes] of [
    ["word/vbaProject.bin", Buffer.from([1])],
    ["word/unused.xml", Buffer.from('<!DOCTYPE x SYSTEM "https://example.test"><x/>')]
  ]) {
    const entries = unpack(valid, 16000000).entries;
    entries.set(name, bytes);
    assert.throws(() => editOffice("offer.docx", zip([...entries]), ops.docx));
  }
});
test("independent python Office fixtures retain package structure and declared slide/sheet order", () => {
  for (const fixture of require("./fixtures/office-import.json").files) {
    const source = Buffer.from(fixture.base64, "base64"),
      opened = inspectOffice(fixture.name, source);
    const format = fixture.name.split(".").at(-1);
    const operations =
      format === "docx"
        ? [
            {
              kind: "replace_text",
              target: "table:1/row:1/cell:2",
              find: "Луна",
              replace: "Луна обновлена"
            }
          ]
        : format === "xlsx"
          ? [
              { kind: "set_cell", target: "sheet:1", address: "B2", value: 19700 },
              { kind: "add_sheet", name: "Проверка" },
              { kind: "set_cell", target: "sheet:2", address: "A1", value: "00123" }
            ]
          : [
              {
                kind: "replace_text",
                target: "slide:1/shape:2",
                find: "Второй созданный",
                replace: "Обновлён выбранный"
              }
            ];
    const result = editOffice(fixture.name, source, operations);
    assert.ok(result.buffer.length);
    assert.equal(inspectOffice(fixture.name, source).version, opened.version);
    const text = extractOfficeText(fixture.name, result.buffer).text;
    assert.ok(text.includes(format === "xlsx" ? "19700" : "19 700"));
    assert.ok(text.includes(format === "xlsx" ? "00123" : "кроме доставки"));
  }
});
