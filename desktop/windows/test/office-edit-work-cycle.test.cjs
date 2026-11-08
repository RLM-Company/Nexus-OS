"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createVaultWorkspace } = require("../vault-workspace.cjs");
const { createComputerWorkspace } = require("../computer-workspace.cjs");
const { createWorkCycleDriver } = require("../work-cycle-driver.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { docxFixture, ops } = require("./fixtures/office-edit-brief.cjs");
for (const mode of ["approved", "declined", "legacy", "paged", "legacy_pages"])
  test(`real Work Office edit ${mode}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-work-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const folder = path.join(root, "files");
    fs.mkdirSync(folder);
    const source = docxFixture();
    fs.writeFileSync(path.join(folder, "offer.docx"), source);
    const owner = { owner: "owner", origin: "https://example.test" };
    const base = createComputerWorkspace({
      userDataPath: path.join(root, "profile"),
      pickDirectory: async () => folder,
      codec: {
        seal: (s) => Buffer.from(s).toString("base64"),
        open: (s) => Buffer.from(s, "base64").toString()
      }
    });
    const workspace = createVaultWorkspace({ base, vault: {} });
    await workspace.connect(owner, new AbortController().signal);
    const unavailable = {
      observe() {
        throw Error("UNEXPECTED_DESKTOP");
      },
      stop() {}
    };
    const driver = createWorkCycleDriver({
      browser: unavailable,
      computer: unavailable,
      identity: async () => owner,
      confirmEnvironment: async () => {
        throw Error("UNEXPECTED_GRANT");
      }
    });
    let stage = 0,
      version,
      plan,
      confirmations = 0;
    const runner = new ComputerSession({
      executionMode: "work",
      driver,
      workspace,
      identity: async () => owner,
      notify() {},
      confirm: async (value) => {
        if (value.kind === "action") {
          confirmations++;
          assert.equal(value.action.kind, "workspace_office_commit");
          assert.ok(value.message.includes("Компания Б"));
          assert.ok(value.message.includes("19 700"));
          return mode !== "declined";
        }
        return true;
      },
      planner: {
        begin: async () => ({
          id: "fixture",
          ...(mode !== "legacy" ? { supports_workspace_office_edits: true } : {}),
          ...(mode === "paged" ? { supports_workspace_office_pages: true } : {})
        }),
        authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
        end: async () => {},
        next: async ({ observation, previousResult }) => {
          const prior = previousResult ? JSON.parse(previousResult) : null;
          let action;
          switch (stage++) {
            case 0:
              action = {
                kind: "work_plan",
                steps: [
                  { title: "Изменить предложение", criteria: "Новая копия прочитана, исходник цел" }
                ]
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
              assert.equal(observation.workspace.edit_office, mode !== "legacy" ? true : undefined);
              assert.equal(observation.workspace.office_pages, mode === "paged" ? true : undefined);
              action = ["paged", "legacy_pages"].includes(mode)
                ? {
                    kind: "workspace_office_inspect_page",
                    path: "offer.docx",
                    target_offset: 0,
                    content_offset: 0,
                    expected_version: null
                  }
                : { kind: "workspace_office_inspect", path: "offer.docx" };
              break;
            case 3:
              version = prior.version;
              action = {
                kind: "workspace_office_preview",
                path: "offer.docx",
                output_path: "result.docx",
                expected_version: version,
                operations: ops.docx
              };
              break;
            case 4:
              plan = prior.plan_id;
              assert.equal(fs.existsSync(path.join(folder, "result.docx")), false);
              action = {
                kind: "workspace_office_commit",
                path: "offer.docx",
                expected_version: version,
                plan_id: plan
              };
              break;
            case 5:
              assert.equal(prior.source_version, version);
              assert.equal(prior.readback.version, prior.version);
              const bytes = fs.readFileSync(path.join(folder, "result.docx"));
              assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), prior.sha256);
              action = { kind: "workspace_list", path: "", cursor: 0 };
              break;
            case 6:
              assert.ok(prior.items.some((i) => i.path === "result.docx"));
              action = {
                kind: "work_step",
                step: 1,
                state: "checked",
                evidence: "Проверены readback и список файлов",
                observation_id: observation.observation_id
              };
              break;
            default:
              action = { kind: "done", summary: "Копия проверена; визуальный рендер не проверен" };
          }
          return { action, message: "Fixture planner (no model)", requires_confirmation: false };
        }
      }
    });
    const ticket = {
      task_id: crypto.randomUUID(),
      request_id: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      project: "project",
      document: "window:1"
    };
    const run = runner.run({
      project: "project",
      goal: "Обновить реквизиты и таблицу",
      maxSteps: 9,
      resultTicket: ticket
    });
    if (["approved", "paged"].includes(mode)) {
      const result = await run;
      assert.equal(result.status, "completed");
      assert.equal(result.receipt.receipt_version, 1);
      assert.deepEqual(result.receipt.checked, { count: 1, status: "checked" });
      // Files use the existing none environment without a desktop/browser grant.
      assert.equal(result.receipt.environment, "none");
      for (const [field, value] of Object.entries(ticket))
        assert.equal(result.receipt[field], value);
      const receipt = JSON.stringify(result.receipt);
      for (const privateText of ["offer.docx", "result.docx", "Компания Б", "19 700"])
        assert.equal(receipt.includes(privateText), false);
    } else
      await assert.rejects(
        run,
        ["legacy", "legacy_pages"].includes(mode) ? /ACTION_INVALID/ : /CANCELLED/
      );
    assert.equal(confirmations, ["legacy", "legacy_pages"].includes(mode) ? 0 : 1);
    assert.equal(
      fs.existsSync(path.join(folder, "result.docx")),
      ["approved", "paged"].includes(mode)
    );
    assert.deepEqual(fs.readFileSync(path.join(folder, "offer.docx")), source);
  });
