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
        assert.equal(action.path, path.join(folder, "report.md"));
        assert.equal(fs.readFileSync(action.path, "utf8"), "Verified source report");
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
    () => ({ kind: "open_file", path: path.join(f.folder, "report.md") }),
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
