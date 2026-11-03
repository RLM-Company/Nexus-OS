"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createComputerHistory } = require("../computer-history.cjs");
const { ComputerSession } = require("../computer-session.cjs");
const context = { owner: "owner-a", origin: "https://example.test" };
const input = { project: "project", goal: "Write a meeting note" };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-history-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const codec = {
    seal(text) {
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([
        iv,
        cipher.update(text, "utf8"),
        cipher.final(),
        cipher.getAuthTag()
      ]).toString("base64");
    },
    open(sealed) {
      const data = Buffer.from(sealed, "base64"),
        decipher = crypto.createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(
        "utf8"
      );
    }
  };
  let time = 10000;
  const create = () => createComputerHistory(directory, { codec, now: () => time });
  const files = () =>
    fs
      .readdirSync(path.join(directory, "computer-tasks-v1"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => path.join(directory, "computer-tasks-v1", n));
  return {
    create,
    store: create(),
    codec,
    files,
    directory,
    advance: (n) => {
      time += n;
    }
  };
}
test("encrypted checkpoint stores minimal stages, never input payloads, and needs a fresh owner grant after restart", (t) => {
  const f = fixture(t),
    task = f.store.start(context, input);
  task.proposal(
    1,
    { kind: "type_text", text: "private typed contents" },
    { run_id: crypto.randomUUID(), mode: "provider", token: "not-stored" }
  );
  task.mark(1, "dispatching");
  const encoded = fs.readFileSync(f.files()[0], "utf8");
  for (const value of [input.goal, "private typed contents", "not-stored", context.owner])
    assert.ok(!encoded.includes(value));
  const plain = f.codec.open(JSON.parse(encoded).sealed);
  assert.ok(plain.includes(input.goal));
  for (const value of ["private typed contents", "not-stored", "image_jpeg", "client_secret"])
    assert.ok(!plain.includes(value));
  const restarted = f.create();
  assert.equal(restarted.list(context)[0].status, "interrupted");
  const recovery = restarted.recovery(context, task.id);
  assert.equal(recovery.requiresReview, true);
  assert.equal(recovery.goal, input.goal);
  const checkpoint = JSON.parse(recovery.previousResult);
  assert.deepEqual(checkpoint.steps, [{ index: 1, kind: "type_text", phase: "dispatching" }]);
  assert.ok(!recovery.previousResult.includes("private typed contents"));
  assert.throws(
    () => restarted.start(context, { ...input, goal: "different", recoveredFrom: task.id }),
    /RECOVERY_UNAVAILABLE/
  );
  const next = restarted.start(context, { ...input, recoveredFrom: task.id });
  assert.notEqual(next.id, task.id);
  assert.equal(restarted.list(context).find((r) => r.id === next.id).steps.length, 0);
  next.proposal(1, { kind: "observe" });
  next.mark(1, "dispatching");
  next.mark(1, "requested");
  next.state("failed");
  assert.equal(
    restarted.recovery(context, next.id).requiresReview,
    true,
    "uncertainty survives repeated recovery even when the latest attempt only observed"
  );
});
test("phase order, model completion and owner acceptance remain distinct", (t) => {
  const { store } = fixture(t),
    task = store.start(context, input);
  task.proposal(1, { kind: "type_text", text: "test" });
  assert.throws(() => task.mark(1, "observed"), /HISTORY_UNAVAILABLE/);
  task.mark(1, "dispatching");
  task.mark(1, "requested");
  task.mark(1, "observed");
  assert.throws(() => store.accept(context, task.id), /NOT_COMPLETE/);
  task.state("completed");
  assert.equal(store.list(context)[0].acceptedAt, null);
  assert.equal(store.list(context)[0].requiresReview, true);
  assert.throws(() => store.recovery(context, task.id), /RECOVERY_UNAVAILABLE/);
  store.accept(context, task.id);
  assert.equal(typeof store.list(context)[0].acceptedAt, "number");
  assert.throws(() => task.proposal(2, { kind: "observe" }), /HISTORY_UNAVAILABLE/);
});
test("owner/server isolation also rejects encrypted files copied across scopes", (t) => {
  const f = fixture(t),
    task = f.store.start(context, input);
  task.state("failed");
  const original = fs.readFileSync(f.files()[0]);
  for (const foreign of [
    { ...context, owner: "other" },
    { ...context, origin: "https://other.test" }
  ]) {
    assert.deepEqual(f.store.list(foreign), []);
    assert.throws(() => f.store.recovery(foreign, task.id), /NOT_FOUND/);
    const other = f.store.start(foreign, input);
    other.state("failed");
    const target = f
      .files()
      .find(
        (file) =>
          JSON.parse(f.codec.open(JSON.parse(fs.readFileSync(file)).sealed)).owner ===
            foreign.owner &&
          JSON.parse(f.codec.open(JSON.parse(fs.readFileSync(file)).sealed)).origin ===
            foreign.origin
      );
    fs.writeFileSync(target, original);
    assert.throws(() => f.store.list(foreign), /HISTORY_UNAVAILABLE/);
    f.store.clear(foreign);
  }
  assert.equal(f.store.list(context)[0].id, task.id);
});
test("credential-like goals cannot be restored and clearing never resurrects a recorder", (t) => {
  const f = fixture(t);
  for (const goal of ["Use password: example-only", "Ввести код 7531", "Bearer example-only"]) {
    const task = f.store.start(context, { ...input, goal });
    task.state("failed");
    assert.equal(f.store.list(context).find((r) => r.id === task.id).goal, null);
    assert.throws(() => f.store.recovery(context, task.id), /RECOVERY_UNAVAILABLE/);
    assert.ok(!f.codec.open(JSON.parse(fs.readFileSync(f.files()[0])).sealed).includes(goal));
  }
  const active = f.store.start(context, input);
  f.store.clear(context);
  assert.throws(() => active.state("cancelled"), /NOT_FOUND/);
  assert.deepEqual(f.store.list(context), []);
});
test("corrupt, oversized and tampered journals fail closed until explicit removal", (t) => {
  const f = fixture(t),
    task = f.store.start(context, input);
  task.state("failed");
  const file = f.files()[0];
  for (const content of [
    "bad json",
    "x".repeat(1500001),
    JSON.stringify({ version: 1, sealed: "tampered" })
  ]) {
    fs.writeFileSync(file, content);
    assert.throws(() => f.store.list(context), /HISTORY_UNAVAILABLE/);
    assert.throws(() => f.store.start(context, input), /HISTORY_UNAVAILABLE/);
    assert.equal(fs.statSync(file).size, Buffer.byteLength(content));
  }
  f.store.clear(context);
  assert.equal(f.store.list(context).length, 0);
});
test("retention/cap prune old terminal records and never evict active records for new work", (t) => {
  const f = fixture(t);
  const active = f.store.start(context, input);
  for (let i = 0; i < 25; i++) {
    f.advance(1);
    f.store.start(context, input).state("failed");
  }
  assert.equal(f.store.list(context).length, 20);
  assert.ok(f.store.list(context).some((r) => r.id === active.id));
  f.advance(31 * 86400_000);
  assert.deepEqual(f.store.list(context), []);
  f.store.start(context, input).state("completed");
  assert.equal(
    JSON.parse(f.codec.open(JSON.parse(fs.readFileSync(f.files()[0])).sealed)).records.length,
    1
  );
  f.store.clearAll();
  for (let i = 0; i < 20; i++) f.store.start(context, input);
  assert.throws(() => f.store.start(context, input), /HISTORY_UNAVAILABLE/);
});

const screen = {
  active_window: "42",
  width: 800,
  height: 600,
  observation_id: "test",
  image_jpeg_base64: "not-persisted"
};
const proposal = (action) => ({ action, message: "test", requires_confirmation: false });
function sessionFixture(store, proposals) {
  const confirmations = [],
    calls = [],
    observations = [];
  const planner = {
    begin: async () => {
      const id = crypto.randomUUID();
      calls.push({ begin: id });
      return { id };
    },
    next: async (value) => {
      calls.push({ previous: value.previousResult });
      return proposal(proposals.shift());
    },
    authorize: async () => ({ authorized: true, valid_for_ms: 10000 }),
    end: async () => {}
  };
  const driver = {
    observe: async () => {
      observations.push(true);
      return screen;
    },
    execute: async () => ({ requested: true }),
    stop() {}
  };
  const session = new ComputerSession({
    history: store,
    driver,
    planner,
    identity: async () => context,
    confirm: async (value) => {
      confirmations.push(value);
      return true;
    },
    notify() {}
  });
  return { session, driver, planner, calls, confirmations, observations };
}
test("journal is durable BEFORE native dispatch; fresh observation is not semantic success", async (t) => {
  const f = fixture(t),
    s = sessionFixture(f.store, [
      { kind: "type_text", text: "test" },
      { kind: "done", summary: "finished" }
    ]);
  s.driver.execute = async () => {
    assert.equal(f.store.list(context)[0].steps[0].phase, "dispatching");
    assert.equal(f.create().list(context)[0].steps[0].phase, "dispatching");
    return { requested: true };
  };
  const observe = s.driver.observe;
  let captures = 0;
  s.driver.observe = async () => {
    if (++captures === 2) assert.equal(f.store.list(context)[0].steps[0].phase, "requested");
    return observe();
  };
  const result = await s.session.run(input);
  const record = f.store.list(context)[0];
  assert.equal(record.steps[0].phase, "observed");
  assert.equal(record.status, "completed");
  assert.equal(record.acceptedAt, null);
  assert.equal(result.task_id, record.id);
});
test("uncertain native failure survives restart, requires fresh consent/session and confirmation before write", async (t) => {
  const f = fixture(t),
    first = sessionFixture(f.store, [{ kind: "type_text", text: "first" }]);
  first.driver.execute = async () => {
    throw Error("COMPUTER_INPUT_REJECTED");
  };
  await assert.rejects(first.session.run(input), /INPUT_REJECTED/);
  const old = f.store.list(context)[0];
  assert.equal(old.steps[0].phase, "dispatching");
  assert.equal(old.status, "failed");
  const restarted = f.create(),
    recovery = restarted.recovery(context, old.id);
  const second = sessionFixture(restarted, [
    { kind: "type_text", text: "second" },
    { kind: "type_text", text: "second" },
    { kind: "done", summary: "finished" }
  ]);
  let executed = 0;
  second.driver.execute = async () => {
    executed++;
    assert.equal(second.confirmations.length, 2);
    assert.equal(second.observations.length, 2);
    return { requested: true };
  };
  await second.session.run({ ...input, recovery, expectedContext: context });
  assert.equal(executed, 1);
  assert.equal(second.confirmations[0].kind, "session");
  assert.equal(second.confirmations[1].recoveryReview, true);
  assert.notEqual(first.calls[0].begin, second.calls[0].begin);
  assert.equal(JSON.parse(second.calls[1].previous).status, "recovery_checkpoint");
  assert.equal(restarted.list(context).find((r) => r.id !== old.id).recoveredFrom, old.id);
});
test("known pre-input rejection records no execution, but uncertain effects are not auto-repeated", async (t) => {
  const f = fixture(t),
    s = sessionFixture(f.store, [
      { kind: "click", x: 0.5, y: 0.5, count: 1, button: "left" },
      { kind: "done", summary: "finished" }
    ]);
  s.driver.execute = async () => {
    throw Error("COMPUTER_WINDOW_CHANGED");
  };
  await s.session.run(input);
  assert.equal(f.store.list(context)[0].steps[0].phase, "not_executed");
  assert.equal(f.store.list(context)[0].requiresReview, false);
});
test("journal failure stops BEFORE native input and blocks reuse of a poisoned runner", async (t) => {
  const f = fixture(t),
    codec = f.codec,
    original = codec.seal;
  let count = 0;
  codec.seal = (text) => {
    if (++count >= 3) throw Error("disk unavailable");
    return original(text);
  };
  const s = sessionFixture(f.store, [{ kind: "type_text", text: "test" }]);
  let executions = 0;
  s.driver.execute = async () => {
    executions++;
  };
  await assert.rejects(s.session.run(input), /HISTORY_UNAVAILABLE/);
  assert.equal(executions, 0);
  assert.equal(s.session.active, null);
  await assert.rejects(s.session.run(input), /RESTART_REQUIRED/);
});
test("owner changes before recovered consent are rejected without revealing the old goal", async (t) => {
  const f = fixture(t),
    s = sessionFixture(f.store, []);
  await assert.rejects(
    s.session.run({ ...input, expectedContext: { ...context, owner: "previous-owner" } }),
    /IDENTITY_CHANGED/
  );
  assert.equal(s.confirmations.length, 0);
  assert.equal(s.calls.length, 0);
});
test("explicit logout can stop and erase an active recorder without recreating history", async (t) => {
  const f = fixture(t),
    s = sessionFixture(f.store, [{ kind: "observe" }]);
  s.planner.next = async () => {
    s.session.stop();
    f.store.clearAll();
    return proposal({ kind: "done", summary: "must not finish" });
  };
  await assert.rejects(s.session.run(input), /SESSION_STOPPED/);
  assert.deepEqual(f.store.list(context), []);
  assert.ok(!s.session.poisoned);
});
test("cleanup failure cannot leave a runnable controller or claim successful completion", async (t) => {
  const f = fixture(t),
    s = sessionFixture(f.store, [{ kind: "done", summary: "finished" }]);
  s.driver.stop = () => {
    throw Error("cannot stop helper");
  };
  s.planner.end = () => {
    throw Error("sync end failure");
  };
  await assert.rejects(s.session.run(input), /RESTART_REQUIRED/);
  assert.equal(s.session.active, null);
  assert.equal(s.session.poisoned, true);
  assert.equal(f.store.list(context)[0].status, "failed");
});

test("write failure AFTER native input cannot report success or hide uncertain dispatch", async (t) => {
  const f = fixture(t),
    original = f.codec.seal;
  const s = sessionFixture(f.store, [{ kind: "type_text", text: "test" }]);
  let executions = 0;
  s.driver.execute = async () => {
    executions++;
    f.codec.seal = () => {
      throw Error("disk gone");
    };
    return { requested: true };
  };
  await assert.rejects(s.session.run(input), /HISTORY_UNAVAILABLE/);
  assert.equal(executions, 1);
  f.codec.seal = original;
  const record = f.create().list(context)[0];
  assert.equal(record.status, "interrupted");
  assert.equal(record.steps[0].phase, "dispatching");
  assert.equal(record.requiresReview, true);
});

test("recovery rederives review policy from encrypted history, never a caller flag", async (t) => {
  const f = fixture(t),
    task = f.store.start(context, input);
  task.proposal(1, { kind: "type_text", text: "test" });
  task.mark(1, "dispatching");
  task.state("failed");
  const s = sessionFixture(f.store, [
    { kind: "type_text", text: "again" },
    { kind: "type_text", text: "again" },
    { kind: "done", summary: "done" }
  ]);
  await s.session.run({
    ...input,
    recovery: { taskId: task.id, requiresReview: false, previousResult: "untrusted" }
  });
  assert.equal(s.confirmations[1].recoveryReview, true);
  assert.equal(JSON.parse(s.calls[1].previous).status, "recovery_checkpoint");
});
