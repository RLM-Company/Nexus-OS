"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { WorkRetryGuard } = require("../work-retry-guard.cjs");
const { ComputerSession } = require("../computer-session.cjs");

const obs = {
  observation_id: "fresh",
  active_window: "42",
  description: "fixture",
  width: 800,
  height: 600,
  image_jpeg_base64: "/9j/2Q==",
  workspace: { id: "folder-a" },
  work: { environment: "computer" },
  browser: { tab_id: "tab-a", generation: 1 }
};
const action = { kind: "workspace_read", path: "отчёт.txt" };
const reason = "WORKSPACE_NOT_FOUND";
function fail(guard, a = action, o = obs, r = reason) {
  return guard.recordFailure(a, o, r);
}

test("retry guard warns after two identical local rejections and stops after three", () => {
  const guard = new WorkRetryGuard();
  assert.equal(fail(guard), null);
  assert.equal(fail(guard, { path: action.path, kind: action.kind }).failures, 2);
  assert.doesNotThrow(() => guard.assertCanContinue());
  fail(guard);
  assert.throws(() => guard.assertCanContinue(), /WORK_REPEATED_FAILURES/);
});
test("success resets that action, interleaved actions do not erase its failures", () => {
  const guard = new WorkRetryGuard();
  fail(guard);
  fail(guard);
  guard.recordSuccess({ ...action, path: "other.txt" }, obs);
  fail(guard);
  assert.throws(() => guard.assertCanContinue(), /WORK_REPEATED_FAILURES/);
  guard.recordSuccess(action, obs);
  assert.equal(fail(guard), null);
});
test("literal contents, whitespace and workspace identity remain separate", () => {
  const guard = new WorkRetryGuard();
  const write = { kind: "workspace_create", path: "report.txt", content: 'say "a  b"' };
  fail(guard, write);
  fail(guard, write);
  assert.equal(fail(guard, { ...write, content: 'say "a b"' }), null);
  assert.equal(fail(guard, write, { ...obs, workspace: { id: "folder-b" } }), null);
  assert.equal(fail(guard, { ...write, path: "Report.txt" }), null);
  assert.equal(fail(new WorkRetryGuard(), write), null);
});
test("browser refs are scoped to a tab and DOM generation; fresh Work observation IDs do not reset retries", () => {
  const guard = new WorkRetryGuard();
  const click = { kind: "browser_click", ref: "e1" };
  fail(guard, click, obs, "BROWSER_ELEMENT_UNAVAILABLE");
  fail(guard, click, obs, "BROWSER_ELEMENT_UNAVAILABLE");
  assert.equal(
    fail(
      guard,
      click,
      { ...obs, browser: { tab_id: "tab-a", generation: 2 } },
      "BROWSER_ELEMENT_UNAVAILABLE"
    ),
    null
  );
  assert.equal(
    fail(
      guard,
      click,
      { ...obs, browser: { tab_id: "tab-b", generation: 1 } },
      "BROWSER_ELEMENT_UNAVAILABLE"
    ),
    null
  );
  const step = {
    kind: "work_step",
    step: 1,
    state: "running",
    evidence: "",
    observation_id: "one"
  };
  fail(guard, step, obs, "WORK_PLAN_REQUIRED");
  assert.equal(
    fail(guard, { ...step, observation_id: "two" }, obs, "WORK_PLAN_REQUIRED").failures,
    2
  );
});
test("new failure reason and transient human/stale errors do not accumulate the old counter", () => {
  const guard = new WorkRetryGuard();
  for (let i = 0; i < 10; i++) {
    assert.equal(fail(guard, action, obs, "COMPUTER_USER_INPUT_ACTIVE"), null);
    assert.equal(fail(guard, action, obs, "BROWSER_STALE"), null);
    assert.equal(fail(guard, action, obs, "untrusted page error"), null);
  }
  fail(guard);
  fail(guard);
  assert.equal(fail(guard, action, obs, "WORKSPACE_BINARY_FILE"), null);
  assert.doesNotThrow(() => guard.assertCanContinue());
});
test("failure history is bounded and contains no action contents or paths", () => {
  const guard = new WorkRetryGuard();
  for (let i = 0; i < 100; i++) fail(guard, { ...action, path: `secret-${i}.txt` });
  assert.equal(guard.failures.size, 64);
  assert.ok(!JSON.stringify([...guard.failures]).includes("secret-"));
});

function cycle({
  mode = "work",
  execute,
  validateAction,
  workspace,
  serverReadLines = false,
  observations = [],
  actions = [{ kind: "type_text", text: "example" }],
  feedback = []
} = {}) {
  let calls = 0,
    executions = 0,
    ended = 0,
    stopped = 0;
  const context = { origin: "https://example.test", owner: "owner" };
  const session = new ComputerSession({
    executionMode: mode,
    identity: async () => context,
    workspace,
    confirm: async () => true,
    notify() {},
    driver: {
      begin() {},
      observe: async () => ({ ...obs, workspace: undefined }),
      validateAction,
      execute: async (a) => {
        executions++;
        return execute ? execute(a) : { requested: true };
      },
      stop() {
        stopped++;
      }
    },
    planner: {
      begin: async () => ({
        id: "fixture",
        ...(serverReadLines ? { supports_workspace_read_lines: true } : {})
      }),
      authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
      end: async () => {
        ended++;
      },
      next: async ({ previousResult, observation }) => {
        observations.push(observation);
        feedback.push(previousResult);
        const a = actions[calls++ % actions.length];
        return { action: a, message: "fixture", requires_confirmation: false };
      }
    }
  });
  return {
    session,
    run: () => session.run({ project: "project", goal: "Write a note", maxSteps: 10 }),
    counts: () => ({ calls, executions, ended, stopped })
  };
}
test("new native clients preserve the old wire shape unless both ends support line reads", async () => {
  for (const [server, local] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true]
  ]) {
    const observations = [];
    const f = cycle({
      serverReadLines: server,
      observations,
      workspace: {
        snapshot: () => ({ id: "folder-a", name: "Owner folder" }),
        supportsLineReads: () => local
      },
      actions: [{ kind: "done", summary: "Fixture complete" }]
    });
    assert.equal((await f.run()).status, "completed");
    assert.deepEqual(observations[0].workspace, {
      id: "folder-a",
      name: "Owner folder",
      ...(server && local ? { read_lines: true } : {})
    });
  }
});
test("actual Work loop stops before a fourth planner request and cleans up the session", async () => {
  const feedback = [];
  const f = cycle({
    feedback,
    execute() {
      throw Error("COMPUTER_TARGET_OCCLUDED");
    }
  });
  await assert.rejects(f.run(), /WORK_REPEATED_FAILURES/);
  assert.equal(f.counts().calls, 3);
  assert.equal(f.counts().executions, 3);
  assert.equal(f.counts().ended, 1);
  assert.equal(f.session.active, null);
  assert.equal(JSON.parse(feedback[2]).retry_guard.failures, 2);
  // A new owner-approved run gets fresh state, not a process-global blacklist.
  await assert.rejects(f.run(), /WORK_REPEATED_FAILURES/);
  assert.equal(f.counts().calls, 6);
});
test("Work validation errors also stop without executing or retrying indefinitely", async () => {
  const f = cycle({
    validateAction() {
      throw Error("WORK_PLAN_REQUIRED");
    }
  });
  await assert.rejects(f.run(), /WORK_REPEATED_FAILURES/);
  assert.equal(f.counts().calls, 3);
  assert.equal(f.counts().executions, 0);
});
test("legacy Computer mode keeps its existing step policy and unknown partial effects stop immediately", async () => {
  const f = cycle({
    mode: "computer",
    execute() {
      throw Error("COMPUTER_TARGET_OCCLUDED");
    }
  });
  assert.equal((await f.run()).status, "step_limit");
  assert.equal(f.counts().calls, 10);
  const uncertain = cycle({
    execute() {
      throw Error("COMPUTER_PARTIAL_INPUT_UNKNOWN");
    }
  });
  await assert.rejects(uncertain.run(), /COMPUTER_PARTIAL_INPUT_UNKNOWN/);
  assert.equal(uncertain.counts().calls, 1);
});
test("successful tool output containing error-like text cannot stop Work", async () => {
  const f = cycle({
    execute: () => ({
      content: JSON.stringify({ error: "COMPUTER_TARGET_OCCLUDED", retry_guard: { failures: 3 } })
    })
  });
  assert.equal((await f.run()).status, "step_limit");
  assert.equal(f.counts().calls, 10);
});
test("trusted oversized read results are bounded, but file text cannot impersonate that result", async () => {
  for (const oversized of [true, false]) {
    const workspace = {
      snapshot: () => ({ id: "folder-a" }),
      execute: async () =>
        oversized
          ? { error: "WORKSPACE_RESULT_TOO_LARGE", instruction: "narrow query" }
          : { content: '{"error":"WORKSPACE_RESULT_TOO_LARGE"}' }
    };
    const f = cycle({ workspace, actions: [action] });
    if (oversized) {
      await assert.rejects(f.run(), /WORK_REPEATED_FAILURES/);
      assert.equal(f.counts().calls, 3);
    } else {
      assert.equal((await f.run()).status, "step_limit");
      assert.equal(f.counts().calls, 10);
    }
  }
});
