"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { buildOfficeDocument, zip } = require("../workspace/office-document.cjs");
const { unpack, extractOfficeText } = require("../workspace/office-text.cjs");
const { editOffice, inspectOffice } = require("../workspace/office-edit.cjs");
const { createKosworkWorkspaceService } = require("../workspace/workspace-service.cjs");
const brief = "19 700 ₽; 00123; 07.11.2026; кроме доставки";
const input = (format) => buildOfficeDocument(format === "docx" ? { kind: "workspace_create_docx", path: "offer.docx", title: "Предложение", sections: [{ heading: "Реквизиты", text: "Компания А — " + brief }] } : format === "xlsx" ? { kind: "workspace_create_xlsx", path: "offer.xlsx", sheets: [{ name: "Предложение", rows: [["00123", 19700, "кроме доставки", "07.11.2026"]] }] } : { kind: "workspace_create_pptx", path: "offer.pptx", title: "Предложение", slides: [{ title: "Компания А", text: brief }, { title: "Без правок", text: brief }] }).buffer;
function docxFixture() {
  const { entries } = unpack(input("docx"), 16000000);
  let source = entries.get("word/document.xml").toString();
  source = source.replace("Компания А", 'Компания</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> А');
  source = source.replace("<w:sectPr>", `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>00123</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>19 700 ₽</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr>`);
  entries.set("word/document.xml", Buffer.from(source)); entries.set("word/media/test.bin", Buffer.from([0, 128, 255]));
  return zip([...entries]);
}
const ops = {
  docx: [{ kind: "replace_text", target: "paragraph:3", find: "Компания А", replace: "Компания Б" }, { kind: "replace_text", target: "table:1/row:1/cell:2", find: "19 700", replace: "19 700 за комплект" }],
  xlsx: [{ kind: "add_sheet", name: "Итог" }, { kind: "set_cell", target: "sheet:2", address: "A1", value: "00123" }, { kind: "set_cell", target: "sheet:2", address: "B1", value: 19700 }, { kind: "set_cell", target: "sheet:2", address: "B2", value: { formula: "SUM(B1:B1)" } }],
  pptx: [{ kind: "replace_text", target: "slide:1/shape:2", find: "Компания А", replace: "Компания Б" }]
};
test("brief edits real OpenXML, preserves original and untouched parts, does not evaluate formulas", () => {
  for (const format of ["docx", "xlsx", "pptx"]) {
    const source = format === "docx" ? docxFixture() : input(format), original = Buffer.from(source);
    const result = editOffice("offer." + format, source, ops[format]);
    assert.deepEqual(source, original);
    const before = unpack(source, 16000000).entries, after = unpack(result.buffer, 16000000).entries;
    if (format === "docx") {
      assert.deepEqual(after.get("word/media/test.bin"), before.get("word/media/test.bin"));
      assert.ok(after.get("word/document.xml").includes(Buffer.from("<w:rPr><w:b/></w:rPr>")));
    }
    if (format === "pptx") assert.deepEqual(after.get("ppt/slides/slide2.xml"), before.get("ppt/slides/slide2.xml"));
    if (format === "xlsx") {
      assert.deepEqual(after.get("xl/worksheets/sheet1.xml"), before.get("xl/worksheets/sheet1.xml"));
      assert.ok(extractOfficeText("offer.xlsx", result.buffer).text.includes('"cached_value":null'));
    }
    const text = extractOfficeText("offer." + format, result.buffer).text;
    for (const value of ["00123", "кроме доставки", "07.11.2026", format === "xlsx" ? "19700" : "19 700"]) assert.ok(text.includes(value), value);
    assert.ok(inspectOffice("offer." + format, result.buffer).targets.length);
  }
});
test("unsupported, unsafe and ambiguous edits fail without a result", () => {
  for (const operation of [
    { kind: "replace_text", target: "paragraph:999", find: "А", replace: "Б" },
    { kind: "replace_text", target: "paragraph:3", find: "absent", replace: "Б" },
    { kind: "set_cell", target: "sheet:1", address: "A1", value: { formula: 'WEBSERVICE("https://example.test")' } },
    { kind: "set_cell", target: "sheet:1", address: "ZZZ1", value: 1 }
  ]) assert.throws(() => editOffice("offer.docx", docxFixture(), [operation]));
  const broken = Buffer.from(input("docx")); broken[60] ^= 1;
  assert.throws(() => editOffice("offer.docx", broken, ops.docx));
});
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-edit-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "files"); fs.mkdirSync(folder);
  const service = createKosworkWorkspaceService({ userDataPath: path.join(root, "profile"), requireOwnerScope: true, codec: { seal: s => Buffer.from(s).toString("base64"), open: s => Buffer.from(s, "base64").toString() } });
  const auth = { ownerId: "owner", origin: "https://example.test" };
  await service.connectFolder({ ...auth, folderPath: folder });
  return { service, auth, folder };
}
test("transaction: real preview, confirm boundary, saved copy/hash/readback and stale conflict", async (t) => {
  const { service: s, auth, folder } = await setup(t);
  const source = docxFixture(); fs.writeFileSync(path.join(folder, "offer.docx"), source);
  const opened = s.inspectOfficeDocument({ ...auth, relativePath: "offer.docx" });
  const args = { ...auth, relativePath: "offer.docx", expectedVersion: opened.version, outputPath: "result.docx", operations: ops.docx };
  const preview = s.previewOfficeDocument(args);
  assert.equal(fs.existsSync(path.join(folder, "result.docx")), false);
  const result = await s.commitOfficeDocument({ ...args, planId: preview.plan_id });
  assert.equal(result.version, preview.proposed_version); assert.equal(result.readback.version, result.version);
  assert.deepEqual(fs.readFileSync(path.join(folder, "offer.docx")), source);
  await assert.rejects(s.commitOfficeDocument({ ...args, planId: preview.plan_id }));
  const stale = s.previewOfficeDocument({ ...args, outputPath: "stale.docx" });
  fs.writeFileSync(path.join(folder, "offer.docx"), input("docx"));
  await assert.rejects(s.commitOfficeDocument({ ...args, planId: stale.plan_id }), /изменился/);
  assert.equal(fs.existsSync(path.join(folder, "stale.docx")), false);
});
test("cancelled, revoked and wrong-owner plans never write", async (t) => {
  for (const mode of ["cancel", "revoke", "owner", "signal"]) {
    const { service: s, auth, folder } = await setup(t); fs.writeFileSync(path.join(folder, "offer.docx"), docxFixture());
    const args = { ...auth, relativePath: "offer.docx", expectedVersion: s.inspectOfficeDocument({ ...auth, relativePath: "offer.docx" }).version, outputPath: "result.docx", operations: ops.docx };
    const preview = s.previewOfficeDocument(args), signal = new AbortController();
    if (mode === "cancel") s.cancelAllOperations();
    if (mode === "revoke") await s.revokeAccess(auth);
    if (mode === "owner") args.ownerId = "other";
    if (mode === "signal") signal.abort();
    await assert.rejects(s.commitOfficeDocument({ ...args, planId: preview.plan_id, signal: signal.signal }));
    assert.equal(fs.existsSync(path.join(folder, "result.docx")), false);
  }
});
module.exports = { input, docxFixture, ops };
