"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { inspectOffice, editOffice } = require("../workspace/office-edit.cjs");
const { extractOfficeText } = require("../workspace/office-text.cjs");
const { pagedWord, pagedSheet } = require("./fixtures/office-paged-brief.cjs");
const { createComputerWorkspace } = require("../computer-workspace.cjs");
const { validateComputerAction } = require("../computer-policy.cjs");
function pages(name, bytes) {
  const all = [],
    first = inspectOffice(name, bytes);
  let page = first;
  for (let limit = 0; limit < 1000; limit++) {
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 10000);
    assert.ok(page.targets.length > 0);
    all.push(page);
    if (!page.next_cursor) return all;
    assert.notDeepEqual(page.next_cursor, page.cursor);
    page = inspectOffice(name, bytes, { cursor: page.next_cursor, expectedVersion: first.version });
  }
  throw Error("CURSOR_DID_NOT_TERMINATE");
}
test("bounded DOCX pages reach every target and preserve a long Unicode paragraph exactly", () => {
  const source = pagedWord(),
    views = pages("brief.docx", source.buffer),
    texts = new Map();
  assert.ok(views.length > 2);
  for (const page of views)
    for (const t of page.targets) {
      assert.ok(t.text.isWellFormed());
      const before = texts.get(t.id) || "";
      assert.equal(t.text_offset, before.length);
      texts.set(t.id, before + t.text);
    }
  assert.equal(texts.size, source.texts.length);
  assert.equal(views[0].total_targets, source.texts.length);
  source.texts.forEach((text, i) => assert.equal(texts.get(`paragraph:${i + 1}`), text));
  assert.ok(views[0].targets[0].text_excerpt_only);
  const result = editOffice("brief.docx", source.buffer, [
    {
      kind: "replace_text",
      target: `paragraph:${source.texts.length}`,
      find: "Раздел 420",
      replace: "Последний раздел"
    }
  ]);
  assert.ok(extractOfficeText("brief.docx", result.buffer).text.includes("Последний раздел"));
});
test("bounded XLSX pages expose every complete typed cell without duplicate addresses", () => {
  const source = pagedSheet(),
    views = pages("brief.xlsx", source.buffer),
    cells = views.flatMap((p) => p.targets.flatMap((t) => t.cells));
  assert.equal(cells.length, source.cellCount);
  assert.equal(new Set(cells.map((c) => c.address)).size, source.cellCount);
  assert.ok(cells.find((c) => c.address === "A500").text.includes("00123"));
  assert.equal(cells.find((c) => c.address === "B500").text, "19700");
  assert.equal(cells.find((c) => c.address === "C500").type, "b");
  assert.ok(views[0].targets[0].cells_excerpt_only);
});
test("cursor continuations require the exact version and refuse invalid UTF-16 positions", () => {
  const source = pagedWord(),
    opened = inspectOffice("brief.docx", source.buffer);
  assert.throws(
    () => inspectOffice("brief.docx", source.buffer, { cursor: opened.next_cursor }),
    /VERSION_CONFLICT/
  );
  assert.throws(
    () =>
      inspectOffice("brief.docx", source.buffer, {
        cursor: opened.next_cursor,
        expectedVersion: "sha256:" + "0".repeat(64)
      }),
    /VERSION_CONFLICT/
  );
  for (const cursor of [
    { target_offset: 0, content_offset: 1 },
    { target_offset: 99999, content_offset: 0 },
    { target_offset: -1, content_offset: 0 },
    { target_offset: 0, content_offset: 99999 }
  ])
    assert.throws(
      () => inspectOffice("brief.docx", source.buffer, { cursor, expectedVersion: opened.version }),
      /CURSOR_INVALID/
    );
});
test("real workspace continuation rejects changed sources and revoked folders", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-pages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "files");
  fs.mkdirSync(folder);
  const source = pagedWord();
  fs.writeFileSync(path.join(folder, "brief.docx"), source.buffer);
  const context = { owner: "fixture", origin: "https://fixture.example.test" };
  const workspace = createComputerWorkspace({
    userDataPath: path.join(root, "profile"),
    pickDirectory: async () => folder,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const selected = await workspace.connect(context, new AbortController().signal);
  const execute = (action) =>
    workspace.execute(validateComputerAction(action), {
      context,
      workspaceId: selected.id,
      signal: new AbortController().signal
    });
  const first = await execute({
    kind: "workspace_office_inspect_page",
    path: "brief.docx",
    target_offset: 0,
    content_offset: 0,
    expected_version: null
  });
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 10000);
  const action = {
    kind: "workspace_office_inspect_page",
    path: "brief.docx",
    ...first.next_cursor,
    expected_version: first.version
  };
  const second = await execute(action);
  assert.equal(second.version, first.version);
  fs.writeFileSync(path.join(folder, "brief.docx"), pagedWord({ paragraphs: 421 }).buffer);
  await assert.rejects(execute(action), (e) => e.code === "WORKSPACE_VERSION_CONFLICT");
  await workspace.invalidate();
  await assert.rejects(execute(action), /WORKSPACE_CHANGED/);
});
test("large native edit receipts retain verified hashes instead of overflowing after a successful save", async (t) => {
  const { unpack } = require("../workspace/office-text.cjs"),
    { zip } = require("../workspace/office-document.cjs");
  const source = pagedWord({ paragraphs: 160, long: false });
  const entries = unpack(source.buffer, 16000000).entries;
  entries.set(
    "word/document.xml",
    Buffer.from(
      entries
        .get("word/document.xml")
        .toString()
        .replace("Раздел 1", "X".repeat(3600) + "Раздел 1")
    )
  );
  const bytes = zip([...entries]),
    root = fs.mkdtempSync(path.join(os.tmpdir(), "office-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "files");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "brief.docx"), bytes);
  const context = { owner: "fixture", origin: "https://fixture.example.test" };
  const workspace = createComputerWorkspace({
    userDataPath: path.join(root, "profile"),
    pickDirectory: async () => folder,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const selected = await workspace.connect(context, new AbortController().signal);
  const execute = (action) =>
    workspace.execute(validateComputerAction(action), {
      context,
      workspaceId: selected.id,
      signal: new AbortController().signal
    });
  const opened = await execute({ kind: "workspace_office_inspect", path: "brief.docx" });
  const preview = await execute({
    kind: "workspace_office_preview",
    path: "brief.docx",
    output_path: "result.docx",
    expected_version: opened.version,
    operations: [
      { kind: "replace_text", target: "paragraph:1", find: "Раздел 1", replace: "Готово 1" }
    ]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(preview.diff)) > 7000);
  const saved = await execute({
    kind: "workspace_office_commit",
    path: "brief.docx",
    expected_version: opened.version,
    plan_id: preview.plan_id
  });
  assert.equal(saved.error, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= 14000);
  assert.equal(saved.version, preview.proposed_version);
  assert.equal(saved.readback.version, saved.version);
  assert.equal(saved.readback.content_not_included, true);
  assert.equal(saved.readback.verified, true);
  const reread = await execute({ kind: "workspace_office_inspect", path: "result.docx" });
  assert.equal(reread.version, saved.version);
  assert.ok(
    extractOfficeText(
      "result.docx",
      fs.readFileSync(path.join(folder, "result.docx"))
    ).text.includes("Готово 1")
  );
  assert.deepEqual(fs.readFileSync(path.join(folder, "brief.docx")), bytes);
});
