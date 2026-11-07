"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  projectWorkOutcome,
  createWorkResultRelay,
  deliverWorkResult
} = require("../work-result.cjs");
const context = { owner: "owner-A", origin: "https://example.test" },
  input = { project: "project-A", goal: "Exact task" };
function relayFixture() {
  const timers = [],
    delivered = [];
  const relay = createWorkResultRelay({
    setTimer: (fn) => {
      const t = { fn, unref() {} };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    }
  });
  return {
    relay,
    timers,
    delivered,
    bind: () => relay.bind(context, input, (v) => delivered.push(v))
  };
}
test("outcomes carry only bounded local-report fields, never files, credentials or acceptance authority", () => {
  const result = projectWorkOutcome({
    status: "completed",
    summary: "Exact result 00123 🌙",
    steps: 8,
    task_id: "11111111-1111-4111-8111-111111111111",
    files: ["private"],
    owner_accepted: true,
    source: "server_attestation",
    cookie: "private"
  });
  assert.deepEqual(result, {
    source: "local_agent_report",
    status: "completed",
    owner_accepted: false,
    summary: "Exact result 00123 🌙",
    task_id: "11111111-1111-4111-8111-111111111111",
    steps: 8
  });
  for (const summary of ["password=secret-fixture", "x".repeat(3001), "\ud800"]) {
    const v = projectWorkOutcome({ status: "completed", summary });
    assert.equal(v.summary, undefined);
    assert.equal(v.summary_omitted, true);
  }
  assert.equal(
    projectWorkOutcome({ status: "toString", summary: "wrong", task_id: "bad", steps: 91 }).status,
    "failed"
  );
  assert.equal(
    projectWorkOutcome({ status: "failed", summary: "never copy error text" }).summary,
    undefined
  );
});
test("one exact owner/project/goal ticket returns once and late results cannot replace a newer request", () => {
  const f = relayFixture(),
    ticket = f.bind();
  assert.equal(f.relay.claim(context, input.project, input.goal), ticket);
  assert.equal(f.relay.claim(context, input.project, input.goal), null);
  assert.equal(f.relay.finish(ticket, { status: "completed", summary: "Done" }), true);
  assert.equal(f.relay.finish(ticket, { status: "completed", summary: "Duplicate" }), false);
  assert.equal(f.delivered.length, 1);
  assert.equal(f.timers[0].cleared, true);
  const old = f.bind(),
    next = f.bind();
  assert.equal(f.delivered.at(-1).status, "cancelled");
  assert.equal(f.relay.finish(old, { status: "completed", summary: "Late" }), false);
  f.timers.at(-1).fn();
  assert.equal(f.delivered.at(-1).status, "expired");
  assert.equal(f.relay.finish(next, { status: "completed", summary: "Too late" }), false);
});
test("a changed owner, origin, project or goal never claims the original result target", () => {
  for (const [owner, project, goal] of [
    [{ ...context, owner: "B" }, input.project, input.goal],
    [{ ...context, origin: "https://other.test" }, input.project, input.goal],
    [context, "other", input.goal],
    [context, input.project, "Different"]
  ]) {
    const f = relayFixture(),
      ticket = f.bind();
    assert.equal(f.relay.claim(owner, project, goal), null);
    assert.equal(f.delivered[0].status, "cancelled");
    assert.equal(f.relay.finish(ticket, { status: "completed", summary: "Private" }), false);
  }
});
test("callback errors cannot break task cleanup or retain the return address", () => {
  const f = relayFixture(),
    t = f.relay.bind(context, input, () => {
      throw Error("fixture");
    });
  assert.equal(f.relay.finish(t, { status: "completed" }), true);
  assert.equal(f.relay.finish(t, { status: "completed" }), false);
});
test("recipient fences block offline/wrong-owner, document changes and A-B-A races", async () => {
  for (const phase of [
    "before",
    "owner",
    "during owner",
    "during scope",
    "scope fails",
    "send throws"
  ]) {
    let current = true,
      verifyCalls = 0,
      release,
      entered;
    const ready = new Promise((r) => {
      entered = r;
    });
    const held = () => {
      entered();
      return new Promise((r) => {
        release = r;
      });
    };
    const sent = [];
    if (phase === "before") current = false;
    const pending = deliverWorkResult({
      isCurrent: () => current,
      expectedOwner: "A",
      verifyOwner: async () => {
        verifyCalls++;
        if (phase === "during owner") await held();
        return phase === "owner" ? "B" : "A";
      },
      allowSummary: async () => {
        if (phase === "during scope") await held();
        return phase !== "scope fails";
      },
      send: (value) => {
        if (phase === "send throws") throw Error("closed");
        sent.push(value);
      },
      requestId: "request",
      project: "project-A",
      result: { status: "completed", summary: "Private", project: "spoofed" }
    });
    if (phase.startsWith("during")) {
      await ready;
      current = false;
      release();
    }
    const delivered = await pending;
    if (phase === "scope fails") {
      assert.equal(delivered, true);
      assert.equal(sent[0].result.status, "unavailable");
      assert.equal(sent[0].result.summary, undefined);
    } else {
      assert.equal(delivered, false);
      assert.equal(sent.length, 0);
    }
    if (phase === "before") assert.equal(verifyCalls, 0);
  }
  const sent = [];
  assert.equal(
    await deliverWorkResult({
      isCurrent: () => true,
      verifyOwner: async () => "A",
      expectedOwner: "A",
      allowSummary: async () => true,
      send: (value) => sent.push(value),
      requestId: "request",
      project: "expected-project",
      result: {
        status: "completed",
        summary: "Exact output",
        project: "spoofed",
        files: ["private"]
      }
    }),
    true
  );
  assert.equal(sent[0].project, "expected-project");
  assert.equal(sent[0].result.summary, "Exact output");
  assert.equal(sent[0].result.files, undefined);
});
