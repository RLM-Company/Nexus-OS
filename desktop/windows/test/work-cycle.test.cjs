"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { createWorkCycleDriver } = require("../work-cycle-driver.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const { createComputerWorkspace } = require("../computer-workspace.cjs");
const { createComputerHistory } = require("../computer-history.cjs");
const { createTaskGate } = require("../browser/policy.cjs");
const context = { owner: "owner", origin: "https://example.test" };
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-cycle-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-cycle-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const folder = path.join(root, "files");
  fs.mkdirSync(folder);
  // The native action protocol is Windows-only, even when this fixture runs on Linux.
  const reportActionPath =
    process.platform === "win32"
      ? path.join(folder, "report.md")
      : "C:\\koswork-fixture\\report.md";
  const key = crypto.randomBytes(32);
  const codec = {
    seal(text) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, c.update(text, "utf8"), c.final(), c.getAuthTag()]).toString(
        "base64"
      );
    },
    open(value) {
      const b = Buffer.from(value, "base64"),
        d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(-16));
      return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
    }
  };
  const workspace = createComputerWorkspace({
    userDataPath: path.join(root, "profile"),
    scopeNamespace: "work-cycle",
    codec,
    pickDirectory: async () => folder
  });
  await workspace.connect(context, new AbortController().signal);
  const history = createComputerHistory(path.join(root, "profile"), { codec });
  const calls = [],
    grants = [];
  let current = context,
    opened = false;
  const driverFor = (environment) => ({
    async observe() {
      calls.push(environment + ":observe");
      return {
        observation_id: crypto.randomUUID(),
        active_window: environment === "browser" ? "tab:0" : "1",
        width: 960,
        height: 740,
        description: JSON.stringify({
          text: opened ? "Saved report is open" : "Generated source evidence",
          nodes: []
        }),
        ...(environment === "browser"
          ? { browser: { tab_id: "a".repeat(12), generation: 0 } }
          : { image_jpeg_base64: Buffer.from([255, 216, 255, 217]).toString("base64") })
      };
    },
    async execute(action) {
      calls.push(environment + ":" + action.kind);
      if (action.kind === "open_file") {
        assert.equal(action.path, reportActionPath);
        assert.equal(
          fs.readFileSync(path.join(folder, "report.md"), "utf8"),
          "Verified source report"
        );
        opened = true;
      }
      return { requested: true };
    },
    isCurrent: () => true,
    stop() {
      calls.push(environment + ":stop");
    }
  });
  const driver = createWorkCycleDriver({
    browser: driverFor("browser"),
    computer: driverFor("computer"),
    identity: async () => current,
    confirmEnvironment: async (value) => {
      grants.push(value.environment);
      return options.confirm ? options.confirm(value) : true;
    }
  });
  return {
    root,
    folder,
    reportActionPath,
    workspace,
    history,
    driver,
    calls,
    grants,
    codec,
    setIdentity: (value) => {
      current = value;
    }
  };
}

test("real Work driver locates versioned lines in a large file without desktop or browser access", async (t) => {
  const f = await fixture(t),
    messages = [];
  const source = Array.from({ length: 900 }, (_, i) =>
    i === 699
      ? "Цена 19 700 ₽, кроме срочной доставки."
      : `Исходная строка ${i + 1}: не изменять числа и исключения.`
  ).join("\r\n");
  fs.writeFileSync(path.join(f.folder, "условия.txt"), source, "utf8");
  let stage = 0,
    match;
  const runner = new ComputerSession({
    driver: f.driver,
    executionMode: "work",
    workspace: f.workspace,
    history: f.history,
    identity: async () => context,
    confirm: async () => true,
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture", supports_workspace_read_lines: true }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        assert.equal(observation.workspace.read_lines, true);
        messages.push(previousResult);
        let action;
        switch (stage++) {
          case 0:
            action = {
              kind: "work_plan",
              steps: [{ title: "Проверить цену", criteria: "Цена и исключение прочитаны" }]
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
            action = { kind: "workspace_find", path: "", mode: "text", query: "Цена 19 700" };
            break;
          case 3:
            match = JSON.parse(previousResult).matches[0];
            assert.equal(match.line, 700);
            action = {
              kind: "workspace_read_lines",
              path: match.path,
              start_line: 699,
              end_line: 701,
              expected_version: match.version
            };
            break;
          case 4:
            const read = JSON.parse(previousResult);
            assert.equal(read.version, match.version);
            assert.equal(read.excerpt_only, true);
            assert.ok(source.includes(read.content));
            assert.ok(read.content.includes("19 700 ₽, кроме срочной доставки"));
            action = {
              kind: "work_step",
              step: 1,
              state: "checked",
              evidence: "Цена 19 700 ₽, кроме срочной доставки.",
              observation_id: observation.observation_id
            };
            break;
          default:
            action = { kind: "done", summary: "Цена и исключение проверены по строкам 699–701" };
        }
        return { action, message: "fixture", requires_confirmation: false };
      }
    }
  });
  assert.equal(
    (
      await runner.run({
        project: "project",
        goal: "Уточнить цену из выбранной папки",
        maxSteps: 8
      })
    ).status,
    "completed"
  );
  assert.equal(stage, 6);
  assert.equal(f.calls.filter((c) => c.endsWith(":observe")).length, 0);
  assert.equal(f.grants.length, 0);
  assert.equal(fs.readFileSync(path.join(f.folder, "условия.txt"), "utf8"), source);
});

test("one work task plans, searches, writes a real scoped file, switches to an app and checks all criteria", async (t) => {
  const f = await fixture(t),
    gate = createTaskGate();
  let stage = 0;
  const actions = [
    () => ({
      kind: "work_plan",
      steps: [
        { title: "Read source", criteria: "Source inspected" },
        { title: "Write report", criteria: "File contents checked" },
        { title: "Open report", criteria: "Result visible in application" }
      ]
    }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "work_switch", environment: "browser" }),
    () => ({ kind: "browser_read" }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "checked",
      evidence: "Generated source inspected",
      observation_id: obs.observation_id
    }),
    (obs) => ({
      kind: "work_step",
      step: 2,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "workspace_create", path: "report.md", content: "Verified source report" }),
    () => ({ kind: "workspace_read", path: "report.md" }),
    (obs) => ({
      kind: "work_step",
      step: 2,
      state: "checked",
      evidence: "Private evidence must not be persisted",
      observation_id: obs.observation_id
    }),
    (obs) => ({
      kind: "work_step",
      step: 3,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "work_switch", environment: "computer" }),
    () => ({ kind: "open_file", path: f.reportActionPath }),
    (obs) => ({
      kind: "work_step",
      step: 3,
      state: "checked",
      evidence: "Fresh desktop view shows report",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "done", summary: "Source report saved and opened" })
  ];
  const runner = new ComputerSession({
    driver: f.driver,
    executionMode: "work",
    identity: async () => context,
    workspace: f.workspace,
    history: f.history,
    taskGate: gate,
    notify() {},
    confirm: async () => true,
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        if (stage === 8)
          assert.ok(
            JSON.parse(previousResult).content?.includes("Verified source report") ||
              previousResult.includes("Verified source report"),
            previousResult
          );
        return {
          action: actions[stage++](observation),
          message: "Fixture only",
          requires_confirmation: false
        };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Read a source, save a report and open it",
    maxSteps: 30
  });
  assert.equal(result.status, "completed");
  assert.equal(stage, 14);
  assert.equal(gate.busy, false);
  assert.deepEqual(f.grants, ["browser", "computer"]);
  assert.equal(f.calls.filter((v) => v === "computer:open_file").length, 1);
  assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), "Verified source report");
  assert.deepEqual(f.driver.state().permissions, []);
  const record = f.history.list(context)[0];
  assert.equal(record.executionMode, "work");
  assert.equal(record.acceptedAt, null);
  assert.ok(record.workPlan.every((s) => s.state === "checked"));
  const disk = fs.readFileSync(
    path.join(
      f.root,
      "profile",
      "computer-tasks-v1",
      fs.readdirSync(path.join(f.root, "profile", "computer-tasks-v1"))[0]
    ),
    "utf8"
  );
  const plain = f.codec.open(JSON.parse(disk).sealed);
  for (const value of ["Private evidence", "image_jpeg", "Verified source report", "permissions"])
    assert.equal(plain.includes(value), false);
  f.history.accept(context, result.task_id);
  assert.ok(f.history.list(context)[0].acceptedAt);
});

test("desktop capture requires its own grant; cancellation fences late environment approval", async (t) => {
  let approve;
  const f = await fixture(t, {
    confirm: () =>
      new Promise((resolve) => {
        approve = resolve;
      })
  });
  f.driver.begin({ context, goal: "Scoped task" });
  const signal = new AbortController();
  let obs = await f.driver.observe(signal.signal);
  assert.equal(obs.image_jpeg_base64, undefined);
  assert.equal(
    f.calls.some((c) => c.endsWith(":observe")),
    false
  );
  await f.driver.execute(
    { kind: "work_plan", steps: [{ title: "Inspect", criteria: "Check result" }] },
    obs,
    signal.signal
  );
  obs = await f.driver.observe(signal.signal);
  assert.throws(
    () => f.driver.validateAction({ kind: "type_text", text: "blocked" }, obs),
    /ENVIRONMENT_REQUIRED/
  );
  const pending = f.driver.execute(
    { kind: "work_switch", environment: "computer" },
    obs,
    signal.signal
  );
  while (!approve) await new Promise((resolve) => setImmediate(resolve));
  f.driver.stop();
  signal.abort();
  approve(true);
  await assert.rejects(pending, /SESSION_STOPPED/);
  assert.equal(f.calls.includes("computer:observe"), false);
  assert.deepEqual(f.driver.state().permissions, []);
});

test("recovery retains safe plan labels but restores no grants or checked-result claims", async (t) => {
  const f = await fixture(t);
  const journal = f.history.start(context, {
    project: "project",
    goal: "Check a report",
    executionMode: "work"
  });
  journal.plan([{ title: "Check report", criteria: "Fresh file inspected", state: "checked" }]);
  journal.state("failed");
  const recovery = f.history.recovery(context, journal.id);
  f.driver.begin({ context, goal: recovery.goal, recovery });
  assert.equal(f.driver.state().steps[0].state, "pending");
  assert.equal(f.driver.state().steps[0].previousState, "checked");
  assert.deepEqual(f.driver.state().permissions, []);
  const obs = await f.driver.observe(new AbortController().signal);
  assert.equal(f.driver.validateCompletion(obs), false);
  assert.equal(obs.work.environment, "none");
  f.setIdentity({ owner: "different", origin: context.origin });
  await assert.rejects(f.driver.observe(new AbortController().signal), /IDENTITY_CHANGED/);
});

test("unchecked plan cannot be completed, and another task keeps the shared local slot", async (t) => {
  const f = await fixture(t);
  f.driver.begin({ context, goal: "Scoped task" });
  let obs = await f.driver.observe(new AbortController().signal);
  await f.driver.execute(
    { kind: "work_plan", steps: [{ title: "Create result", criteria: "Result inspected" }] },
    obs,
    new AbortController().signal
  );
  obs = await f.driver.observe(new AbortController().signal);
  assert.equal(f.driver.validateCompletion(obs), false);
  await assert.rejects(
    f.driver.execute(
      {
        kind: "work_step",
        step: 1,
        state: "checked",
        evidence: "unsupported",
        observation_id: obs.observation_id
      },
      obs,
      new AbortController().signal
    ),
    /STEP_INVALID/
  );
  const gate = createTaskGate(),
    release = gate.claim();
  const runner = new ComputerSession({ executionMode: "work", taskGate: gate });
  await assert.rejects(runner.run({ project: "project", goal: "Scoped task" }), /BUSY/);
  release();
});

test("browser grant cannot silently expand to desktop capture and stale step checks are rejected", async (t) => {
  const f = await fixture(t);
  const signal = new AbortController().signal;
  f.driver.begin({ context, goal: "Scoped task" });
  let obs = await f.driver.observe(signal);
  await f.driver.execute(
    { kind: "work_plan", steps: [{ title: "Inspect", criteria: "Check result" }] },
    obs,
    signal
  );
  obs = await f.driver.observe(signal);
  await f.driver.execute({ kind: "work_switch", environment: "browser" }, obs, signal);
  obs = await f.driver.observe(signal);
  assert.throws(
    () => f.driver.validateAction({ kind: "type_text", text: "blocked" }, obs),
    /ENVIRONMENT_REQUIRED/
  );
  assert.equal(f.calls.includes("computer:observe"), false);
  await assert.rejects(
    f.driver.execute(
      { kind: "work_step", step: 1, state: "running", evidence: "", observation_id: "old" },
      obs,
      signal
    ),
    /STEP_INVALID/
  );
  f.driver.stop();
});

test("work human checkpoint is idle and resumes through a fresh observation", async (t) => {
  const f = await fixture(t);
  let calls = 0,
    paused = false;
  const observations = [];
  const runner = new ComputerSession({
    executionMode: "work",
    driver: f.driver,
    identity: async () => context,
    allowHumanResume: true,
    confirm: async () => true,
    notify: (value) => {
      if (value.phase === "awaiting_user") paused = true;
    },
    planner: {
      begin: async () => ({ id: "fixture" }),
      end: async () => {},
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      next: async ({ observation }) => {
        observations.push(observation.observation_id);
        calls++;
        return {
          action: { kind: "ask_user", question: "Fixture owner checkpoint" },
          message: "Fixture",
          requires_confirmation: false
        };
      }
    }
  });
  const pending = runner.run({ project: "project", goal: "Scoped task" }).catch((error) => error);
  while (!paused) await new Promise((resolve) => setImmediate(resolve));
  const captures = f.calls.filter((c) => c.endsWith(":observe")).length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(f.calls.filter((c) => c.endsWith(":observe")).length, captures);
  paused = false;
  assert.equal(runner.resume(), true);
  while (calls < 2 || !paused) await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(observations[0], observations[1]);
  runner.stop();
  await pending;
  assert.deepEqual(f.driver.state().permissions, []);
});

test("unified work history does not change the legacy computer/browser history file", async (t) => {
  const f = await fixture(t);
  const work = createComputerHistory(path.join(f.root, "profile"), {
    codec: f.codec,
    namespace: "work"
  });
  f.history.start(context, { project: "project", goal: "Legacy computer task" }).state("failed");
  work
    .start(context, { project: "project", goal: "Unified work task", executionMode: "work" })
    .state("failed");
  assert.equal(f.history.list(context).length, 1);
  assert.equal(f.history.list(context)[0].executionMode, "computer");
  assert.equal(work.list(context).length, 1);
  assert.equal(work.list(context)[0].executionMode, "work");
  work.clearAll();
  assert.equal(work.list(context).length, 0);
  assert.equal(f.history.list(context).length, 1);
});

test("plain text tools cannot masquerade as a Word, spreadsheet or PDF result", async (t) => {
  const f = await fixture(t),
    signal = new AbortController().signal;
  f.driver.begin({ context, goal: "Create a report" });
  let obs = await f.driver.observe(signal);
  await f.driver.execute(
    { kind: "work_plan", steps: [{ title: "Create report", criteria: "Valid document" }] },
    obs,
    signal
  );
  obs = await f.driver.observe(signal);
  await f.driver.execute(
    {
      kind: "work_step",
      step: 1,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    },
    obs,
    signal
  );
  obs = await f.driver.observe(signal);
  for (const suffix of ["docx", "xlsx", "pdf"])
    assert.throws(
      () =>
        f.driver.validateAction(
          { kind: "workspace_create", path: "report." + suffix, content: "plain text" },
          obs
        ),
      /FORMAT_UNSUPPORTED/
    );
  assert.deepEqual(fs.readdirSync(f.folder), []);
  f.driver.stop();
});

test("file-only task needs no screen grant and rechecks file consent locally without an extra planner call", async (t) => {
  const f = await fixture(t);
  let index = 0,
    confirmations = 0;
  const actions = [
    () => ({ kind: "work_plan", steps: [{ title: "Save note", criteria: "Actual text matches" }] }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "running",
      evidence: "",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "workspace_create", path: "note.md", content: "File-only fixture" }),
    () => ({ kind: "workspace_read", path: "note.md" }),
    (obs) => ({
      kind: "work_step",
      step: 1,
      state: "checked",
      evidence: "Fresh read matches text",
      observation_id: obs.observation_id
    }),
    () => ({ kind: "done", summary: "File checked" })
  ];
  const runner = new ComputerSession({
    executionMode: "work",
    driver: f.driver,
    workspace: f.workspace,
    identity: async () => context,
    notify() {},
    confirm: async () => {
      confirmations++;
      return true;
    },
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        if (index === 4) assert.ok(previousResult.includes("File-only fixture"));
        return {
          action: actions[index++](observation),
          message: "Fixture",
          requires_confirmation: false
        };
      }
    }
  });
  assert.equal(
    (await runner.run({ project: "project", goal: "Save and check a note" })).status,
    "completed"
  );
  assert.equal(index, 6);
  assert.equal(confirmations, 2);
  assert.deepEqual(f.grants, []);
  assert.equal(
    f.calls.some((c) => c.endsWith(":observe")),
    false
  );
  assert.equal(fs.readFileSync(path.join(f.folder, "note.md"), "utf8"), "File-only fixture");
});

test("read-only browser exploration does not require plan-replacement consent, while file effects still do", async (t) => {
  const f = await fixture(t),
    approvals = [];
  let stage = 0;
  const plan = (title) => ({
    kind: "work_plan",
    steps: [{ title, criteria: "Сверить фактический результат" }]
  });
  const progress = (obs, state) => ({
    kind: "work_step",
    step: 1,
    state,
    evidence: state === "checked" ? "Файл прочитан обратно" : "",
    observation_id: obs.observation_id
  });
  const actions = [
    () => plan("Прочитать источник"),
    (obs) => progress(obs, "running"),
    () => ({ kind: "work_switch", environment: "browser" }),
    () => ({ kind: "browser_read" }),
    () => ({ kind: "browser_tabs" }),
    () => plan("Сохранить отчёт"),
    (obs) => progress(obs, "running"),
    () => ({ kind: "workspace_create", path: "report.md", content: "Verified source report" }),
    () => plan("Проверить существующий отчёт"),
    (obs) => progress(obs, "running"),
    () => ({ kind: "workspace_read", path: "report.md" }),
    (obs) => progress(obs, "checked"),
    () => ({ kind: "done", summary: "Отчёт проверен" })
  ];
  const runner = new ComputerSession({
    executionMode: "work",
    driver: f.driver,
    workspace: f.workspace,
    history: f.history,
    identity: async () => context,
    notify() {},
    confirm: async (value) => {
      approvals.push(value);
      return true;
    },
    planner: {
      begin: async () => ({ id: "fixture" }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        if (stage === 11)
          assert.equal(JSON.parse(previousResult).content, "Verified source report");
        return {
          action: actions[stage++](observation),
          message: "Scripted fixture",
          requires_confirmation: false
        };
      }
    }
  });
  assert.equal(
    (
      await runner.run({
        project: "project",
        goal: "Прочитать источник и проверить отчёт",
        maxSteps: 25
      })
    ).status,
    "completed"
  );
  assert.equal(stage, 13);
  assert.deepEqual(
    approvals.map((v) => (v.kind === "session" ? "session" : v.action.kind)),
    ["session", "workspace_create", "work_plan"]
  );
  assert.deepEqual(f.grants, ["browser"]);
  assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), "Verified source report");
});

test("Work stop attempts both native cleanup paths even if one environment throws", async () => {
  for (const failed of ["browser", "computer"]) {
    const calls = [];
    let failCleanup = false;
    const child = (name) => ({
      stop() {
        calls.push(name);
        if (failCleanup && failed === name) throw Error("fixture cleanup failure");
      }
    });
    const driver = createWorkCycleDriver({
      browser: child("browser"),
      computer: child("computer"),
      identity: async () => context,
      confirmEnvironment: async () => true
    });
    driver.begin({ context, goal: "Fixture" });
    const signal = new AbortController().signal;
    let observation = await driver.observe(signal);
    await driver.execute(
      { kind: "work_plan", steps: [{ title: "Inspect", criteria: "Fresh state" }] },
      observation,
      signal
    );
    observation = await driver.observe(signal);
    await driver.execute({ kind: "work_switch", environment: "browser" }, observation, signal);
    assert.deepEqual(driver.state().permissions, ["browser"]);
    calls.length = 0;
    failCleanup = true;
    assert.throws(() => driver.stop(), /COMPUTER_RECOVERY_RESTART_REQUIRED/);
    assert.deepEqual(calls, ["browser", "computer"]);
    assert.deepEqual(driver.state().permissions, []);
    assert.equal(driver.state().environment, "none");
    await assert.rejects(driver.observe(new AbortController().signal), /COMPUTER_SESSION_STOPPED/);
    calls.length = 0;
    assert.throws(
      () => driver.begin({ context, goal: "Restart" }),
      /COMPUTER_RECOVERY_RESTART_REQUIRED/
    );
    assert.deepEqual(calls, ["browser", "computer"]);
    await assert.rejects(driver.observe(signal), /COMPUTER_SESSION_STOPPED/);
  }
});

test("an owner-selected accepted example informs a fresh Work plan and creates a new real file", async (t) => {
  const f = await fixture(t);
  const source = f.history.start(context, {
    project: "project",
    goal: "Prepare previous summary",
    executionMode: "work"
  });
  source.plan([{ title: "Подготовить отчёт", criteria: "Файл проверен", state: "checked" }]);
  source.state("completed");
  f.history.accept(context, source.id);
  const example = f.history.reference(context, "project", source.id),
    refs = [],
    confirmations = [];
  let stage = 0;
  const runner = new ComputerSession({
    driver: f.driver,
    workspace: f.workspace,
    history: f.history,
    executionMode: "work",
    identity: async () => context,
    notify() {},
    confirm: async (value) => {
      confirmations.push(value);
      return true;
    },
    planner: {
      begin: async () => ({ id: "fixture-reference", supports_work_reference: true }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult, workReference }) => {
        refs.push(workReference);
        assert.equal(workReference.revision, example.revision);
        assert.equal(workReference.source_goal, "Prepare previous summary");
        let action;
        switch (stage++) {
          case 0:
            assert.equal(JSON.parse(observation.description).task.steps.length, 0);
            action = {
              kind: "work_plan",
              steps: [{ title: "Новый отчёт", criteria: "Новый файл прочитан" }]
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
            action = {
              kind: "workspace_create",
              path: "new-report.md",
              content: "New goal, current source 00123"
            };
            break;
          case 3:
            action = { kind: "workspace_read", path: "new-report.md" };
            break;
          case 4:
            assert.ok(JSON.parse(previousResult).content.includes("00123"));
            action = {
              kind: "work_step",
              step: 1,
              state: "checked",
              evidence: "Read the new exact result",
              observation_id: observation.observation_id
            };
            break;
          default:
            action = { kind: "done", summary: "New report checked" };
        }
        return { action, message: "Fixture only", requires_confirmation: false };
      }
    }
  });
  const result = await runner.run({
    project: "project",
    goal: "Create a new report",
    reference: { taskId: source.id, revision: example.revision },
    maxSteps: 8
  });
  assert.equal(result.status, "completed");
  assert.equal(
    fs.readFileSync(path.join(f.folder, "new-report.md"), "utf8"),
    "New goal, current source 00123"
  );
  assert.equal(refs.length, 6);
  assert.equal(confirmations[0].reference.revision, example.revision);
  assert.ok(confirmations.some((x) => x.kind !== "session"));
  assert.deepEqual(f.grants, []);
  assert.equal(
    f.history.list(context).find((r) => r.id === result.task_id).referenceSource.taskId,
    source.id
  );
});

test("clearing a selected example while the model runs stops before the proposed file write", async (t) => {
  const f = await fixture(t),
    source = f.history.start(context, {
      project: "project",
      goal: "Source",
      executionMode: "work"
    });
  source.plan([{ title: "Source", criteria: "Checked", state: "checked" }]);
  source.state("completed");
  f.history.accept(context, source.id);
  const example = f.history.reference(context, "project", source.id);
  let calls = 0,
    authorized = 0;
  const runner = new ComputerSession({
    driver: f.driver,
    workspace: f.workspace,
    history: f.history,
    executionMode: "work",
    identity: async () => context,
    confirm: async () => true,
    notify() {},
    planner: {
      begin: async () => ({ id: "fixture", supports_work_reference: true }),
      end: async () => {},
      authorize: async () => {
        authorized++;
        return { authorized: true, valid_for_ms: 10000 };
      },
      next: async () => {
        calls++;
        f.history.clear(context);
        return {
          action: { kind: "workspace_create", path: "must-not-exist.md", content: "late" },
          message: "late fixture",
          requires_confirmation: false
        };
      }
    }
  });
  await assert.rejects(
    runner.run({
      project: "project",
      goal: "New task",
      reference: { taskId: source.id, revision: example.revision },
      maxSteps: 4
    })
  );
  assert.equal(calls, 1);
  assert.equal(authorized, 0);
  assert.equal(fs.existsSync(path.join(f.folder, "must-not-exist.md")), false);
});

test("a legacy API never receives a selected local example or a paid planner step", async (t) => {
  const f = await fixture(t),
    source = f.history.start(context, {
      project: "project",
      goal: "Source",
      executionMode: "work"
    });
  source.plan([{ title: "Source", criteria: "Checked", state: "checked" }]);
  source.state("completed");
  f.history.accept(context, source.id);
  const example = f.history.reference(context, "project", source.id);
  let planned = 0;
  const runner = new ComputerSession({
    driver: f.driver,
    workspace: f.workspace,
    history: f.history,
    executionMode: "work",
    identity: async () => context,
    confirm: async () => true,
    notify() {},
    planner: {
      begin: async () => ({ id: "legacy" }),
      end: async () => {},
      next: async () => {
        planned++;
        throw Error("must not dispatch");
      }
    }
  });
  await assert.rejects(
    runner.run({
      project: "project",
      goal: "New task",
      reference: { taskId: source.id, revision: example.revision },
      maxSteps: 4
    }),
    /COMPUTER_REFERENCE_UNSUPPORTED/
  );
  assert.equal(planned, 0);
  assert.deepEqual(f.grants, []);
});

test("Work composition discloses dropped view data and never splits Unicode or the task plan", async () => {
  for (const source of [
    JSON.stringify({ text: "x".repeat(1999) + "🌙" + "z".repeat(16000), nodes: [] }),
    JSON.stringify({
      text: "Current exact 00123",
      nodes: Array.from({ length: 100 }, (_, i) => ({ ref: "e" + i, name: "z".repeat(1000) }))
    }),
    "x".repeat(5999) + "🌙" + "z".repeat(16000)
  ]) {
    const child = {
      stop() {},
      observe: async () => ({
        observation_id: crypto.randomUUID(),
        active_window: "tab:0",
        width: 960,
        height: 740,
        description: source,
        browser: { tab_id: "a".repeat(12), generation: 0 }
      })
    };
    const driver = createWorkCycleDriver({
      browser: child,
      computer: child,
      identity: async () => context,
      confirmEnvironment: async () => true
    });
    const signal = new AbortController().signal;
    driver.begin({ context, goal: "Preserve the current task" });
    let obs = await driver.observe(signal);
    await driver.execute(
      {
        kind: "work_plan",
        steps: [{ title: "Exact current step 00123", criteria: "19 700 ₽, кроме доставки" }]
      },
      obs,
      signal
    );
    obs = await driver.observe(signal);
    await driver.execute({ kind: "work_switch", environment: "browser" }, obs, signal);
    obs = await driver.observe(signal);
    const doc = JSON.parse(obs.description);
    assert.equal(doc.task.steps[0].title, "Exact current step 00123");
    assert.equal(doc.task.steps[0].criteria, "19 700 ₽, кроме доставки");
    assert.ok(obs.description.length <= 16000);
    if (typeof doc.view === "string") {
      assert.equal(doc.view_excerpt_only, true);
      assert.equal(doc.view, "x".repeat(5999));
      assert.ok(doc.view.isWellFormed());
    } else {
      assert.equal(doc.view.truncated, true);
      assert.ok(doc.view.text.isWellFormed());
      if (!doc.view.nodes.length) assert.equal(doc.view.text, "x".repeat(1999));
      else {
        assert.ok(doc.view.nodes.length < 100);
        assert.equal(doc.view.text, "Current exact 00123");
      }
    }
    driver.stop();
  }
});

test("Work finds a late file clause, reads it by exact version/offset and writes a verified result", async (t) => {
  const f = await fixture(t),
    clause = "TARGET 00123: 19 700 ₽, кроме доставки.";
  const source = "header\r\n" + "x".repeat(24000) + clause;
  fs.writeFileSync(path.join(f.folder, "source.txt"), source, "utf8");
  let index = 0,
    hit,
    excerpt;
  const confirmations = [];
  const runner = new ComputerSession({
    executionMode: "work",
    driver: f.driver,
    workspace: f.workspace,
    history: f.history,
    identity: async () => context,
    confirm: async (value) => {
      confirmations.push(value);
      return true;
    },
    notify() {},
    planner: {
      begin: async () => ({ id: "text-pages-fixture", supports_workspace_text_reads: true }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {},
      next: async ({ observation, previousResult }) => {
        assert.equal(observation.workspace.read_text_pages, true);
        let action;
        switch (index++) {
          case 0:
            action = {
              kind: "work_plan",
              steps: [
                { title: "Extract source clause", criteria: "Exact result saved and read back" }
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
            action = { kind: "workspace_find", path: "", mode: "text", query: "TARGET 00123" };
            break;
          case 3:
            hit = JSON.parse(previousResult).matches[0];
            assert.equal(hit.offset_utf16, source.indexOf("TARGET 00123"));
            assert.ok(hit.offset_utf16 > 24000);
            action = {
              kind: "workspace_read_text",
              path: hit.path,
              offset_utf16: hit.offset_utf16,
              expected_version: hit.version
            };
            break;
          case 4:
            excerpt = JSON.parse(previousResult);
            assert.equal(excerpt.content, clause);
            assert.equal(excerpt.version, hit.version);
            assert.equal(excerpt.excerpt_only, true);
            assert.equal(excerpt.next_offset, null);
            action = { kind: "workspace_create", path: "report.md", content: excerpt.content };
            break;
          case 5:
            action = { kind: "workspace_read", path: "report.md" };
            break;
          case 6:
            assert.equal(JSON.parse(previousResult).content, clause);
            action = {
              kind: "work_step",
              step: 1,
              state: "checked",
              evidence: "Exact file read back",
              observation_id: observation.observation_id
            };
            break;
          default:
            action = { kind: "done", summary: "Source clause extracted and checked" };
        }
        return { action, message: "Fixture only", requires_confirmation: false };
      }
    }
  });
  assert.equal(
    (
      await runner.run({
        project: "project",
        goal: "Extract the exact target clause from the selected folder",
        maxSteps: 12
      })
    ).status,
    "completed"
  );
  assert.equal(index, 8);
  assert.deepEqual(f.grants, []);
  assert.equal(fs.readFileSync(path.join(f.folder, "source.txt"), "utf8"), source);
  assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), clause);
  assert.equal(confirmations.filter((x) => x.action?.kind === "workspace_create").length, 1);
});

for (const pause of [false, true]) {
  test(
    `brief/CSV produces a real read-back result${pause ? " after explicit resume" : ""}`,
    { timeout: 5000 },
    async (t) => {
      const f = await fixture(t),
        brief = "Сложить суммы из amounts.csv. Сохранить итог в report.md.",
        csv = "name,amount\r\nBase,19700\r\nDelivery,4300\r\n";
      fs.writeFileSync(path.join(f.folder, "brief.txt"), brief);
      fs.writeFileSync(path.join(f.folder, "amounts.csv"), csv);
      let report = "",
        index = 0,
        pauses = 0,
        writes = 0;
      const mark = (step, state, obs) => ({
        kind: "work_step",
        step,
        state,
        evidence: state === "checked" ? "Прочитанные данные совпадают" : "",
        observation_id: obs.observation_id
      });
      const actions = [
        () => ({
          kind: "work_plan",
          steps: [
            { title: "Прочитать исходники", criteria: "Бриф и суммы прочитаны" },
            { title: "Сохранить результат", criteria: "Содержимое файла прочитано обратно" }
          ]
        }),
        ({ observation }) => mark(1, "running", observation),
        () => ({ kind: "workspace_read", path: "brief.txt" }),
        ({ previousResult }) => {
          assert.equal(JSON.parse(previousResult).content, brief);
          return { kind: "workspace_read", path: "amounts.csv" };
        },
        ({ observation, previousResult }) => {
          const rows = JSON.parse(previousResult).content.trim().split(/\r?\n/).slice(1);
          const total = rows.reduce((sum, row) => sum + Number(row.split(",")[1]), 0);
          assert.equal(total, 24000);
          report = `Итог: ${total} RUB; источник amounts.csv`;
          return mark(1, "checked", observation);
        },
        ({ observation }) => mark(2, "running", observation),
        ...(pause ? [() => ({ kind: "ask_user", question: "Продолжить сохранение?" })] : []),
        () => ({ kind: "workspace_create", path: "report.md", content: report }),
        () => ({ kind: "workspace_read", path: "report.md" }),
        ({ observation, previousResult }) => {
          assert.equal(JSON.parse(previousResult).content, report);
          return mark(2, "checked", observation);
        },
        () => ({ kind: "done", summary: report })
      ];
      const runner = new ComputerSession({
        driver: f.driver,
        executionMode: "work",
        identity: async () => context,
        workspace: f.workspace,
        history: f.history,
        allowHumanResume: pause,
        confirm: async (value) => {
          if (value.action?.kind === "workspace_create") writes++;
          return true;
        },
        notify(value) {
          if (value.phase === "awaiting_user") {
            pauses++;
            assert.equal(fs.existsSync(path.join(f.folder, "report.md")), false);
            queueMicrotask(() => runner.resume());
          }
        },
        planner: {
          begin: async () => ({ id: "brief-csv-fixture" }),
          authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
          end: async () => {},
          next: async (value) => {
            assert.ok(index < actions.length);
            return {
              action: actions[index++](value),
              message: "Synthetic fixture",
              requires_confirmation: false
            };
          }
        }
      });
      t.after(() => runner.stop());
      const result = await runner.run({
        project: "project",
        goal: "Свести бриф и CSV",
        maxSteps: 20,
        resultTicket: {
          task_id: crypto.randomUUID(),
          nonce: crypto.randomUUID(),
          project: "project",
          document: "window:1"
        }
      });
      assert.equal(result.status, "completed");
      assert.equal(index, actions.length);
      assert.equal(pauses, pause ? 1 : 0);
      assert.equal(writes, 1);
      assert.equal(fs.readFileSync(path.join(f.folder, "report.md"), "utf8"), report);
      assert.equal(result.summary, report);
      assert.equal(fs.readFileSync(path.join(f.folder, "amounts.csv"), "utf8"), csv);
      assert.deepEqual(result.receipt.checked, { count: 2, status: "checked" });
      assert.equal(JSON.stringify(result.receipt).includes(brief), false);
      assert.equal(f.history.list(context)[0].status, "completed");
      assert.ok(f.history.list(context)[0].workPlan.every((step) => step.state === "checked"));
      assert.deepEqual(f.grants, []);
    }
  );
}
