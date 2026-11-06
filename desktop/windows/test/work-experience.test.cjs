"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { createComputerHistory } = require("../computer-history.cjs");
const context = { owner: "owner", origin: "https://example.test" },
  project = "project";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koswork-reference-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("koswork-reference-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const key = crypto.randomBytes(32),
    codec = {
      seal(text) {
        const iv = crypto.randomBytes(12),
          c = crypto.createCipheriv("aes-256-gcm", key, iv);
        return Buffer.concat([iv, c.update(text, "utf8"), c.final(), c.getAuthTag()]).toString(
          "base64"
        );
      },
      open(text) {
        const b = Buffer.from(text, "base64"),
          d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
        d.setAuthTag(b.subarray(-16));
        return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString("utf8");
      }
    };
  let now = 1000;
  const history = createComputerHistory(root, { codec, now: () => now++, namespace: "work" });
  function source({
    goal = "Исходная задача",
    state = "checked",
    criteria = "Файл проверен",
    accept = true,
    status = "completed",
    observed = true
  } = {}) {
    const journal = history.start(context, { project, goal, executionMode: "work" });
    journal.plan([{ title: "Проверить источники", criteria, state }]);
    journal.proposal(
      1,
      { kind: "type_text", text: "raw typed private value not retained" },
      { run_id: crypto.randomUUID(), mode: "provider" }
    );
    for (const phase of ["dispatching", "requested", ...(observed ? ["observed"] : [])])
      journal.mark(1, phase);
    journal.state(status);
    if (accept && status === "completed") history.accept(context, journal.id);
    return journal.id;
  }
  return {
    history,
    source,
    root,
    advance: (n) => {
      now += n;
    }
  };
}
test("only owner-accepted completed Work plans become bounded data examples", (t) => {
  const f = fixture(t);
  for (const opts of [
    { accept: false },
    { observed: false },
    { state: "pending" },
    { status: "failed" },
    { goal: "password=do-not-transfer" },
    { criteria: "Ввести пароль" },
    { criteria: "PIN: 1234" },
    { goal: "код: 123456" }
  ]) {
    const id = f.source(opts);
    assert.equal(f.history.list(context).find((r) => r.id === id).reusable, false);
    assert.throws(() => f.history.reference(context, project, id));
  }
  const id = f.source(),
    r = f.history.reference(context, project, id);
  assert.equal(r.outcome, "owner_accepted");
  assert.deepEqual(r.plan, [{ title: "Проверить источники", criteria: "Файл проверен" }]);
  assert.deepEqual(r.tool_observations, [{ kind: "type_text", count: 1 }]);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 14000);
  assert.ok(!JSON.stringify(r).includes("raw typed private value"));
  assert.ok(!JSON.stringify(r).includes('"state"'));
  assert.equal(f.history.list(context).find((r) => r.id === id).reusable, true);
  const disk = fs.readFileSync(
    path.join(f.root, "work-tasks-v1", fs.readdirSync(path.join(f.root, "work-tasks-v1"))[0]),
    "utf8"
  );
  assert.ok(!disk.includes("Исходная задача"));
});
test("reference scope, revision, expiry and deletion are checked against the current encrypted history", (t) => {
  const f = fixture(t),
    id = f.source(),
    r = f.history.reference(context, project, id);
  assert.throws(() => f.history.reference(context, "other-project", id));
  for (const c of [
    { ...context, owner: "foreign" },
    { ...context, origin: "https://other.test" }
  ])
    assert.throws(() => f.history.reference(c, project, id));
  assert.throws(
    () => f.history.reference(context, project, id, "0".repeat(64)),
    /COMPUTER_REFERENCE_CHANGED/
  );
  f.history.accept(context, id);
  assert.throws(
    () => f.history.reference(context, project, id, r.revision),
    /COMPUTER_REFERENCE_CHANGED/
  );
  f.advance(31 * 86400000);
  assert.throws(() => f.history.reference(context, project, id));
  const second = f.source();
  f.history.clear(context);
  assert.throws(() => f.history.reference(context, project, second));
});
test("starting a referenced task retains source lineage and cannot evict its chosen example", (t) => {
  const f = fixture(t),
    id = f.source(),
    r = f.history.reference(context, project, id);
  for (let n = 0; n < 19; n++) f.source({ goal: "Other " + n });
  const next = f.history.start(context, {
    project,
    goal: "New task",
    executionMode: "work",
    reference: { taskId: id, revision: r.revision }
  });
  assert.equal(f.history.list(context).length, 20);
  assert.equal(f.history.reference(context, project, id).revision, r.revision);
  const saved = f.history.list(context).find((x) => x.id === next.id);
  assert.deepEqual(saved.referenceSource, { taskId: id, revision: r.revision });
  next.state("interrupted");
  assert.deepEqual(f.history.recovery(context, next.id).reference, saved.referenceSource);
});
test("a shortened source goal remains well-formed and is explicitly labelled", (t) => {
  const f = fixture(t),
    id = f.source({ goal: "a".repeat(499) + "🌙" + "z".repeat(900) }),
    r = f.history.reference(context, project, id);
  assert.equal(r.source_goal.length, 499);
  assert.equal(r.source_goal.isWellFormed(), true);
  assert.equal(r.goal_excerpt_only, true);
});
