"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib");
const { buildOfficeDocument } = require("../workspace/office-document.cjs");
const { createComputerWorkspace } = require("../computer-workspace.cjs");
const { validateComputerAction, recoveryWriteActions } = require("../computer-policy.cjs");
const { createWorkCycleDriver } = require("../work-cycle-driver.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const owner = { owner: "owner", origin: "https://example.test" };
const examples = [
  {
    kind: "workspace_create_docx",
    path: "отчёт.docx",
    title: "Kosmora — 19 700 ₽",
    sections: [
      { heading: "Результат", text: "Сумма: 19 700 ₽, кроме доставки.\n<данные> & «цитата»" }
    ]
  },
  {
    kind: "workspace_create_xlsx",
    path: "расчёт.xlsx",
    sheets: [
      {
        name: "Бюджет",
        rows: [
          ["Статья", "Сумма"],
          ["Работа", 19700],
          ["Итого", { formula: "SUM(B2:B2)" }],
          ["Литерал", '=WEBSERVICE("https://example.test")']
        ]
      }
    ]
  },
  {
    kind: "workspace_create_pptx",
    path: "презентация.pptx",
    title: "Kosmora",
    slides: [
      { title: "Обзор", text: "Сумма: 19 700 ₽, кроме доставки." },
      { title: "Далее", text: "Проверка результата\nСохранение источника" }
    ]
  }
];
function parts(buffer) {
  const entries = new Map();
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const packed = buffer.readUInt32LE(at + 18),
      size = buffer.readUInt32LE(at + 22),
      n = buffer.readUInt16LE(at + 26),
      extra = buffer.readUInt16LE(at + 28);
    const name = buffer.subarray(at + 30, at + 30 + n).toString(),
      start = at + 30 + n + extra;
    const data = zlib.inflateRawSync(buffer.subarray(start, start + packed));
    assert.equal(data.length, size);
    entries.set(name, data.toString());
    at = start + packed;
  }
  return entries;
}
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-office-")),
    folder = path.join(base, "files");
  fs.mkdirSync(folder);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(base).startsWith("koswork-office-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  const workspace = createComputerWorkspace({
    userDataPath: path.join(base, "profile"),
    pickDirectory: async () => folder,
    codec: {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    }
  });
  const selected = await workspace.connect(owner, new AbortController().signal);
  const execute = (action, context = owner, signal = new AbortController().signal) =>
    workspace.execute(validateComputerAction(action), {
      context,
      signal,
      workspaceId: selected.id
    });
  return { workspace, folder, selected, execute };
}
test("all three Office actions create real versioned files without overwriting an existing file", async (t) => {
  const f = await fixture(t);
  for (const action of examples) {
    const result = await f.execute(action),
      bytes = fs.readFileSync(path.join(f.folder, action.path));
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(result.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.version, "sha256:" + result.sha256);
    assert.equal(result.path, action.path);
    assert.ok(recoveryWriteActions.has(action.kind));
    await assert.rejects(f.execute(action), (e) => e.code === "WORKSPACE_ALREADY_EXISTS");
    assert.deepEqual(fs.readFileSync(path.join(f.folder, action.path)), bytes);
  }
});
test("literal Unicode/XML text and explicit aggregate formulas retain their intended types", () => {
  const word = parts(buildOfficeDocument(examples[0]).buffer).get("word/document.xml");
  assert.ok(word.includes("19 700 ₽"));
  assert.ok(word.includes("&lt;данные&gt; &amp; «цитата»"));
  assert.ok(word.includes("<w:br/>"));
  const sheet = parts(buildOfficeDocument(examples[1]).buffer).get("xl/worksheets/sheet1.xml");
  assert.ok(sheet.includes("<f>SUM(B2:B2)</f>"));
  assert.ok(sheet.includes('t="inlineStr"><is><t xml:space="preserve">=WEBSERVICE'));
  const deck = parts(buildOfficeDocument(examples[2]).buffer);
  assert.ok(deck.get("ppt/slides/slide1.xml").includes('<a:ext cx="10820400" cy="4754880"/>'));
  assert.ok(deck.has("ppt/theme/theme1.xml"));
  assert.equal(
    [...deck.values()].some((s) => s.includes('TargetMode="External"')),
    false
  );
});
test("unsafe formulas, invalid XML, malformed names and payload expansion fail before writing", () => {
  const sheet = (value) => ({ ...examples[1], sheets: [{ name: "Data", rows: [[value]] }] });
  const invalid = [
    sheet({ formula: 'WEBSERVICE("https://example.test")' }),
    sheet({ formula: "SUM([external]A1)" }),
    sheet(Number.NaN),
    sheet(1e16),
    { ...examples[0], path: "wrong.exe" },
    { ...examples[0], title: "bad\u0000text" },
    { ...examples[0], title: "\ud800" },
    { ...examples[0], root: "C:/arbitrary" },
    { ...examples[1], sheets: [{ name: "bad/name", rows: [[1]] }] },
    {
      ...examples[1],
      sheets: [
        { name: "Data", rows: [[1]] },
        { name: "data", rows: [[2]] }
      ]
    },
    {
      ...examples[0],
      sections: Array.from({ length: 8 }, () => ({ heading: "", text: "Ж".repeat(1600) }))
    }
  ];
  for (const action of invalid)
    assert.throws(() => validateComputerAction(action), /COMPUTER_ACTION_INVALID/);
});
test("document tools preserve owner, folder, cancellation and protected-path fences", async (t) => {
  const f = await fixture(t),
    action = examples[0];
  await assert.rejects(f.execute(action, { ...owner, owner: "other" }), /IDENTITY_CHANGED/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.execute(action, owner, controller.signal));
  assert.throws(() => f.execute({ ...action, path: "../outside.docx" }), /COMPUTER_ACTION_INVALID/);
  assert.equal(fs.existsSync(path.join(f.folder, action.path)), false);
  await f.workspace.invalidate();
  await assert.rejects(f.execute(action), /WORKSPACE_CHANGED/);
});
test("actual Work creates and verifies a document only after native write consent, without screen or browser", async (t) => {
  for (const consent of [false, true]) {
    const f = await fixture(t);
    let stage = 0,
      writes = 0;
    const noDesktop = {
      observe() {
        throw Error("UNEXPECTED_SCREEN");
      },
      stop() {}
    };
    const driver = createWorkCycleDriver({
      browser: noDesktop,
      computer: noDesktop,
      identity: async () => owner,
      confirmEnvironment: async () => {
        throw Error("UNEXPECTED_ENVIRONMENT_GRANT");
      }
    });
    const runner = new ComputerSession({
      executionMode: "work",
      driver,
      workspace: f.workspace,
      identity: async () => owner,
      notify() {},
      confirm: async (value) => {
        if (value.kind === "action") {
          writes++;
          return consent;
        }
        return true;
      },
      planner: {
        begin: async () => ({ id: "fixture", supports_workspace_documents: true }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          assert.equal(observation.workspace.create_documents, true);
          let action;
          switch (stage++) {
            case 0:
              action = {
                kind: "work_plan",
                steps: [{ title: "Создать отчёт", criteria: "Файл сохранён и проверен" }]
              };
              break;
            case 1:
              action = {
                kind: "work_step",
                step: 1,
                state: "running",
                evidence: "",
                observation_id: observation.observation_id
              };
              break;
            case 2:
              action = examples[0];
              break;
            case 3:
              assert.equal(JSON.parse(previousResult).format, "docx");
              action = { kind: "workspace_list", path: "", cursor: 0 };
              break;
            case 4:
              assert.ok(
                JSON.parse(previousResult).items.some((item) => item.path === examples[0].path)
              );
              action = {
                kind: "work_step",
                step: 1,
                state: "checked",
                evidence: "DOCX receipt and listing verified",
                observation_id: observation.observation_id
              };
              break;
            default:
              action = { kind: "done", summary: "Отчёт создан" };
          }
          return { action, message: "fixture", requires_confirmation: false };
        }
      }
    });
    const run = runner.run({
      project: "project",
      goal: "Создать Word отчёт в выбранной папке",
      maxSteps: 8
    });
    if (consent) assert.equal((await run).status, "completed");
    else await assert.rejects(run, /CANCELLED/);
    assert.equal(writes, 1);
    assert.equal(fs.existsSync(path.join(f.folder, examples[0].path)), consent);
  }
});
