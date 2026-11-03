"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { createComputerWorkspace } = require("../computer-workspace.cjs"),
  { createLocalVault } = require("../local-vault.cjs"),
  { createVaultWorkspace, VAULT_WORKSPACE_PREFIX: P } = require("../vault-workspace.cjs"),
  { ComputerSession } = require("../computer-session.cjs"),
  { createWorkCycleDriver } = require("../work-cycle-driver.cjs"),
  { validateComputerAction } = require("../computer-policy.cjs"),
  { buildOfficeDocument } = require("../workspace/office-document.cjs");
const sources = require("./fixtures/office-import.json").files;
const c = { owner: "owner", origin: "https://example.test" };
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-doc-cycle-")),
    folder = path.join(root, "files"),
    profile = path.join(root, "profile"),
    storage = path.join(root, "storage");
  for (const dir of [folder, profile, storage]) fs.mkdirSync(dir);
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-doc-cycle-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const codec = {
      seal: (s) => Buffer.from(s).toString("base64"),
      open: (s) => Buffer.from(s, "base64").toString()
    },
    vault = createLocalVault({ userDataPath: profile, codec }),
    base = createComputerWorkspace({
      userDataPath: profile,
      codec,
      pickDirectory: async () => folder
    });
  vault.choose(c, storage);
  const workspace = createVaultWorkspace({ base, vault }),
    signal = new AbortController().signal;
  await workspace.connect(c, signal);
  const execute = (action, ctx = c, sig = signal) =>
    workspace.execute(validateComputerAction(action), {
      context: ctx,
      signal: sig,
      workspaceId: workspace.snapshot(ctx)?.id
    });
  return { root, folder, profile, vault, workspace, signal, execute };
}
const read = (p, version = null, at = 0) => ({
  kind: "workspace_read_document",
  path: p,
  expected_version: version,
  offset_utf16: at
});
test("Office readback preserves source hashes, all extracted text and version-bound Unicode continuation", async (t) => {
  const f = await fixture(t);
  for (const source of sources) {
    fs.writeFileSync(path.join(f.folder, source.name), Buffer.from(source.base64, "base64"));
    const value = await f.execute(read(source.name));
    assert.equal(value.sha256, source.sha256);
    assert.equal(value.version, "sha256:" + source.sha256);
    assert.equal(value.representation.complete_document, false);
    assert.ok(value.content.includes("19 700 ₽") || value.content.includes("19700"));
    assert.equal(
      value.representation.sha256,
      crypto.createHash("sha256").update(value.content).digest("hex")
    );
    await assert.rejects(
      f.execute(read(source.name, "sha256:" + "0".repeat(64))),
      (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
    );
  }
  const big = {
    kind: "workspace_create_docx",
    path: "large.docx",
    title: "Источник 🌙",
    sections: Array.from({ length: 4 }, () => ({
      heading: "",
      text: "🌙 Число 00123; кроме доставки. ".repeat(45)
    }))
  };
  const receipt = await f.execute(big);
  let at = 0,
    content = "",
    calls = 0,
    result;
  do {
    result = await f.execute(read(big.path, receipt.version, at));
    assert.equal(result.offset_utf16, at);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 10000);
    content += result.content;
    at = result.next_offset;
    calls++;
  } while (at !== null);
  assert.ok(calls > 1);
  assert.equal(
    crypto.createHash("sha256").update(content).digest("hex"),
    result.representation.sha256
  );
  assert.throws(() => f.execute({ ...read(big.path), offset_utf16: 1 }), /COMPUTER_ACTION_INVALID/);
  await assert.rejects(
    f.execute(read(big.path, receipt.version, 99999)),
    (e) => e.code === "WORKSPACE_RANGE_INVALID"
  );
  fs.writeFileSync(
    path.join(f.folder, big.path),
    buildOfficeDocument({ ...big, title: "Changed" }).buffer
  );
  await assert.rejects(
    f.execute(read(big.path, receipt.version, 20)),
    (e) => e.code === "WORKSPACE_VERSION_CONFLICT"
  );
});
test("Office reads retain cancellation, folder ownership, invalid-container and namespace boundaries", async (t) => {
  const f = await fixture(t),
    file = sources[0];
  fs.writeFileSync(path.join(f.folder, file.name), Buffer.from(file.base64, "base64"));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.execute(read(file.name), c, aborted.signal));
  assert.throws(() => f.execute(read(file.name), { ...c, owner: "other" }), /IDENTITY_CHANGED/);
  assert.throws(() => f.execute(read("../outside.docx")), /COMPUTER_ACTION_INVALID/);
  fs.writeFileSync(path.join(f.folder, "broken.docx"), "not a zip");
  await assert.rejects(f.execute(read("broken.docx")), (e) => e.code === "WORKSPACE_BINARY_FILE");
  await f.workspace.connectVault(c, f.signal, async () => true);
  await assert.rejects(
    f.execute(read(P + "/original.docx")),
    (e) => e.code === "WORKSPACE_PROTECTED_PATH"
  );
});
test("one real Work cycle reads an independent Office brief, creates three documents and reads each result back", async (t) => {
  const f = await fixture(t),
    input = sources[0],
    source = f.vault.put(c, input.name, Buffer.from(input.base64, "base64"));
  await f.workspace.connectVault(c, f.signal, async () => true);
  let at = 0,
    brief = "",
    budget,
    condition,
    writeConsents = 0,
    sourceReads = 0,
    readbacks = 0;
  const receipts = new Map(),
    checked = [];
  const step = (n, state, id) => ({
    kind: "work_step",
    step: n,
    state,
    evidence:
      state === "checked" ? "Fresh source/version and actual document readback checked" : "",
    observation_id: id
  });
  const outputs = ["report.docx", "budget.xlsx", "slides.pptx"];
  const driver = createWorkCycleDriver({
    browser: { stop() {} },
    computer: { stop() {} },
    identity: async () => c,
    confirmEnvironment: async () => {
      throw Error("UNEXPECTED_ENVIRONMENT_GRANT");
    }
  });
  const runner = new ComputerSession({
    executionMode: "work",
    driver,
    workspace: f.workspace,
    identity: async () => c,
    notify() {},
    confirm: async (value) => {
      if (value.kind === "action") writeConsents++;
      return true;
    },
    planner: {
      begin: async () => ({
        id: "fixture",
        supports_workspace_documents: true,
        supports_workspace_document_reads: true
      }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        assert.equal(observation.workspace.read_documents, true);
        assert.equal(observation.image_jpeg_base64, undefined);
        const prev = previousResult ? JSON.parse(previousResult) : null;
        if (at === 4) {
          assert.equal(prev.sha256, source.id);
          brief = prev.content;
          const match = brief.match(/Сумма: ([\d ]+) ₽, ([^\n]+)/);
          assert.ok(match);
          budget = Number(match[1].replace(/ /g, ""));
          condition = match[2];
          sourceReads++;
        }
        if ([7, 8, 9].includes(at)) {
          assert.ok(prev.path);
          receipts.set(prev.path, prev);
        }
        if ([12, 13, 14].includes(at)) {
          const expected = outputs[at - 12],
            receipt = receipts.get(expected);
          assert.equal(prev.path, expected);
          assert.equal(prev.version, receipt.version);
          assert.equal(prev.sha256, receipt.sha256);
          assert.equal(prev.next_offset, null);
          assert.ok(prev.content.includes("19 700") || prev.content.includes("19700"));
          assert.ok(prev.content.includes("кроме доставки"));
          assert.ok(prev.content.includes("00123"));
          checked.push(prev.path);
          readbacks++;
        }
        if (at === 15)
          for (const name of outputs) assert.ok(prev.items.some((i) => i.path === name));
        let action;
        switch (at++) {
          case 0:
            action = {
              kind: "work_plan",
              steps: [
                {
                  title: "Read the selected brief",
                  criteria: "Budget and exception extracted from the actual source"
                },
                { title: "Create deliverables", criteria: "DOCX XLSX PPTX receipts returned" },
                {
                  title: "Read and verify results",
                  criteria: "Original versions, figures and exception retained"
                }
              ]
            };
            break;
          case 1:
            action = step(1, "running", observation.observation_id);
            break;
          case 2:
            action = { kind: "workspace_find", path: P, mode: "text", query: "доставки" };
            break;
          case 3:
            assert.ok(prev.matches.some((i) => i.sha256 === source.id));
            action = { kind: "workspace_read", path: P + "/" + source.id + "/0" };
            break;
          case 4:
            action = step(1, "checked", observation.observation_id);
            break;
          case 5:
            action = step(2, "running", observation.observation_id);
            break;
          case 6:
            action = {
              kind: "workspace_create_docx",
              path: outputs[0],
              title: "Отчёт",
              sections: [{ heading: "Исходный материал", text: brief }]
            };
            break;
          case 7:
            action = {
              kind: "workspace_create_xlsx",
              path: outputs[1],
              sheets: [
                {
                  name: "Бюджет",
                  rows: [
                    ["Бюджет", budget],
                    ["Условие", condition],
                    ["Номер", "00123"]
                  ]
                }
              ]
            };
            break;
          case 8:
            action = {
              kind: "workspace_create_pptx",
              path: outputs[2],
              title: "План",
              slides: [{ title: "Бюджет и условия", text: brief }]
            };
            break;
          case 9:
            action = step(2, "checked", observation.observation_id);
            break;
          case 10:
            action = step(3, "running", observation.observation_id);
            break;
          case 11:
          case 12:
          case 13: {
            const p = outputs[at - 12];
            action = read(p, receipts.get(p).version);
            break;
          }
          case 14:
            action = { kind: "workspace_list", path: "", cursor: 0 };
            break;
          case 15:
            action = step(3, "checked", observation.observation_id);
            break;
          default:
            action = { kind: "done", summary: "Three actual documents read back and verified" };
        }
        return { action, message: "Generated fixture only", requires_confirmation: false };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Read the approved brief and prepare verified report, budget and presentation",
    maxSteps: 24
  });
  assert.equal(result.status, "completed");
  assert.equal(at, 17);
  assert.equal(sourceReads, 1);
  assert.equal(readbacks, 3);
  assert.deepEqual(checked, outputs);
  assert.equal(writeConsents, 3);
  assert.equal(f.workspace.vaultState(c), false);
  for (const name of outputs) assert.ok(fs.statSync(path.join(f.folder, name)).size > 0);
});
