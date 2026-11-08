"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  projectWorkOutcome,
  projectWorkReceipt,
  createWorkResultRelay,
  deliverWorkResult
} = require("../work-result.cjs");
const context = { owner: "owner-A", origin: "https://example.test" },
  input = { project: "project-A", goal: "Exact task" },
  taskId = "11111111-1111-4111-8111-111111111111",
  observationId = "22222222-2222-4222-8222-222222222222",
  nonce = "33333333-3333-4333-8333-333333333333",
  requestId = "44444444-4444-4444-8444-444444444444",
  document = "brief-prices-csv-v7";
function receiptFixture(overrides = {}) {
  return {
    receipt_version: 1,
    task_id: taskId,
    request_id: requestId,
    observation_id: observationId,
    nonce,
    owner: context.owner,
    origin: context.origin,
    project: input.project,
    document,
    environment: "computer",
    generation: 7,
    steps: 2,
    checked: { count: 2, status: "checked" },
    ...overrides
  };
}
function relayFixture(options = {}) {
  const timers = [],
    delivered = [];
  const ids = [
    taskId,
    nonce,
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777"
  ];
  let next = 0;
  const relay = createWorkResultRelay({
    setTimer: (fn) => {
      const t = { fn, unref() {} };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
    newId: () => ids[next++] ?? "88888888-8888-4888-8888-888888888888",
    ...options
  });
  return {
    relay,
    timers,
    delivered,
    bind: (override = {}) =>
      relay.bind(context, input, (v) => delivered.push(v), {
        requestId,
        document,
        ...override
      })
  };
}
test("outcomes carry only bounded local-report fields, never files, credentials or acceptance authority", () => {
  const result = projectWorkOutcome({
    status: "completed",
    summary: "Exact result 00123 🌙",
    steps: 8,
    task_id: taskId,
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
    task_id: taskId,
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
test("PR462 receipt is bounded, versioned, criteria-free and never accepted by a model", () => {
  const raw = receiptFixture({
    files: ["C:\\private\\brief.csv"],
    screenshot: "base64",
    owner_accepted: true,
    verified: true
  });
  const receipt = projectWorkReceipt(raw);
  assert.equal(receipt.receipt_version, 1);
  assert.equal(receipt.kind, "native_work_plan_observed");
  assert.equal(receipt.task_id, taskId);
  assert.equal(receipt.observation_id, observationId);
  assert.equal(receipt.nonce, nonce);
  assert.equal(receipt.owner, context.owner);
  assert.equal(receipt.origin, context.origin);
  assert.equal(receipt.project, input.project);
  assert.equal(receipt.document, document);
  assert.equal(receipt.environment, "computer");
  assert.equal(receipt.generation, 7);
  assert.deepEqual(receipt.checked, { count: 2, status: "checked" });
  assert.equal(receipt.checked.criteria, undefined);
  assert.equal(receipt.owner_accepted, false);
  assert.equal(receipt.files, undefined);
  assert.equal(receipt.screenshot, undefined);
  assert.equal(receipt.verified, undefined);
  assert.equal(JSON.stringify(receipt).includes("private local path"), false);
  assert.ok(JSON.stringify(receipt).length <= 2400);
});
test("a completed receipt is delivered only through the actual trusted one-shot relay ticket", () => {
  const f = relayFixture(),
    ticket = f.bind(),
    binding = f.relay.ticketFor(ticket);
  f.relay.claim(context, input.project, input.goal);
  f.relay.finish(ticket, { status: "completed", summary: "Done", receipt: receiptFixture() });
  const outcome = f.delivered[0];
  assert.equal(outcome.owner_accepted, false);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.summary, "Done");
  assert.equal(outcome.receipt_omitted, undefined);
  assert.deepEqual(outcome.receipt, projectWorkReceipt(receiptFixture()));
  assert.equal(outcome.receipt.task_id, binding.taskId);
  assert.equal(outcome.receipt.nonce, binding.nonce);
  assert.equal(outcome.receipt.document, binding.document);
});
test("a syntactically valid receipt without a trusted ticket is never forwarded", () => {
  const outcome = projectWorkOutcome({
    status: "completed",
    summary: "Done",
    receipt: receiptFixture()
  });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.summary, "Done");
  assert.equal(outcome.receipt, undefined);
  assert.equal(outcome.receipt_omitted, true);
  assert.equal(outcome.owner_accepted, false);
});
test("unknown, incomplete, raw-criteria or oversized receipts never become verification evidence", () => {
  const bad = [
    undefined,
    null,
    {},
    receiptFixture({ receipt_version: 2 }),
    receiptFixture({ task_id: "not-a-uuid" }),
    receiptFixture({ observation_id: "not-a-uuid" }),
    receiptFixture({ nonce: "not-a-uuid" }),
    receiptFixture({ owner: "" }),
    receiptFixture({ origin: "x\u0000y" }),
    receiptFixture({ project: "../escape" }),
    receiptFixture({ document: "password=secret" }),
    receiptFixture({ environment: "shell" }),
    receiptFixture({ generation: -1 }),
    receiptFixture({ steps: 9 }),
    receiptFixture({ checked: { count: 1, status: "checked" } }),
    receiptFixture({ checked: { count: 2, status: "verified" } }),
    receiptFixture({ checked: { count: 2 } }),
    receiptFixture({ checked: { count: 2, status: "checked", criteria: ["private text"] } }),
    receiptFixture({ checked: { count: 2, criteria: ["CSV readback", "Exact total 42"] } }),
    receiptFixture({ document: "x".repeat(161) })
  ];
  for (const receipt of bad) {
    assert.equal(projectWorkReceipt(receipt), undefined);
    const outcome = projectWorkOutcome({ status: "completed", summary: "Done", receipt });
    assert.equal(outcome.receipt, undefined);
    assert.equal(outcome.owner_accepted, false);
    if (receipt !== undefined) assert.equal(outcome.receipt_omitted, true);
  }
  const failed = projectWorkOutcome({ status: "failed", receipt: receiptFixture() });
  assert.equal(failed.receipt, undefined);
  assert.equal(failed.receipt_omitted, true);
  assert.equal(
    projectWorkOutcome({ status: "completed", receipt: receiptFixture(), owner_accepted: true })
      .owner_accepted,
    false
  );
});
test("trusted one-shot ticket binds receipt to owner/origin/project/document/request nonce/task", () => {
  const f = relayFixture(),
    ticket = f.bind(),
    binding = f.relay.ticketFor(ticket);
  assert.deepEqual(binding.context, context);
  assert.equal(binding.project, input.project);
  assert.equal(binding.goal, input.goal);
  assert.equal(binding.requestId, requestId);
  assert.equal(binding.document, document);
  assert.equal(binding.taskId, taskId);
  assert.equal(binding.nonce, nonce);
  const valid = receiptFixture();
  assert.equal(f.relay.claim(context, input.project, input.goal), ticket);
  assert.equal(f.relay.claim(context, input.project, input.goal), null);
  assert.equal(
    f.relay.finish(ticket, { status: "completed", summary: "Done", receipt: valid }),
    true
  );
  assert.equal(f.delivered[0].receipt.receipt_version, 1);
  assert.equal(f.delivered[0].receipt.task_id, taskId);
  assert.equal(f.delivered[0].receipt.nonce, nonce);
  assert.equal(f.delivered[0].receipt.document, document);
  assert.equal(f.delivered[0].receipt.checked.criteria, undefined);
  assert.equal(f.delivered[0].owner_accepted, false);
  for (const wrong of [
    receiptFixture({ task_id: "55555555-5555-4555-8555-555555555555" }),
    receiptFixture({ nonce: "55555555-5555-4555-8555-555555555555" }),
    receiptFixture({ owner: "owner-B" }),
    receiptFixture({ origin: "https://other.test" }),
    receiptFixture({ project: "other-project" }),
    receiptFixture({ document: "other-document" })
  ]) {
    const g = relayFixture(),
      t = g.bind();
    g.relay.claim(context, input.project, input.goal);
    assert.equal(g.relay.finish(t, { status: "completed", summary: "Done", receipt: wrong }), true);
    assert.equal(g.delivered[0].status, "completed");
    assert.equal(g.delivered[0].receipt, undefined);
    assert.equal(g.delivered[0].receipt_omitted, true);
    assert.equal(g.delivered[0].owner_accepted, false);
  }
  const wrongRequest = relayFixture(),
    t3 = wrongRequest.bind({ requestId: "55555555-5555-4555-8555-555555555555" });
  wrongRequest.relay.claim(context, input.project, input.goal);
  assert.equal(
    wrongRequest.relay.finish(t3, {
      status: "completed",
      receipt: receiptFixture()
    }),
    true
  );
  assert.equal(wrongRequest.delivered[0].receipt, undefined);
  assert.equal(wrongRequest.delivered[0].receipt_omitted, true);
  assert.equal(
    projectWorkOutcome({ status: "completed", receipt: receiptFixture() }, t3, requestId).receipt,
    undefined
  );
  const wrongDocument = relayFixture(),
    t4 = wrongDocument.bind({ document: "different-source-document" });
  wrongDocument.relay.claim(context, input.project, input.goal);
  assert.equal(
    wrongDocument.relay.finish(t4, { status: "completed", receipt: receiptFixture() }),
    true
  );
  assert.equal(wrongDocument.delivered[0].receipt, undefined);
  assert.equal(wrongDocument.delivered[0].receipt_omitted, true);
  const noBinding = relayFixture(),
    t2 = noBinding.bind();
  delete t2.receiptBinding;
  noBinding.relay.claim(context, input.project, input.goal);
  assert.equal(noBinding.relay.finish(t2, { status: "completed", receipt: valid }), true);
  assert.equal(noBinding.delivered[0].receipt, undefined);
  assert.equal(noBinding.delivered[0].receipt_omitted, true);
  assert.equal(
    projectWorkOutcome({ status: "completed", receipt: valid }, null, requestId).receipt,
    undefined
  );
});
test("one exact owner/project/goal ticket returns once and late results cannot replace a newer request", () => {
  const f = relayFixture(),
    ticket = f.bind();
  assert.equal(f.relay.claim(context, input.project, input.goal), ticket);
  assert.equal(f.relay.claim(context, input.project, input.goal), null);
  assert.equal(
    f.relay.finish(ticket, { status: "completed", summary: "Done", receipt: receiptFixture() }),
    true
  );
  assert.equal(f.delivered[0].receipt.receipt_version, 1);
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
    t = f.relay.bind(
      context,
      input,
      () => {
        throw Error("fixture");
      },
      { requestId, document }
    );
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
      requestId: requestId,
      project: "expected-project",
      result: {
        status: "completed",
        summary: "Exact output",
        project: "spoofed",
        files: ["private"],
        receipt: receiptFixture()
      }
    }),
    true
  );
  assert.equal(sent[0].project, "expected-project");
  assert.equal(sent[0].result.summary, "Exact output");
  assert.equal(sent[0].result.files, undefined);
  assert.equal(sent[0].result.receipt, undefined);
  assert.equal(sent[0].result.receipt_omitted, true);
  assert.equal(sent[0].result.owner_accepted, false);
});
