"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { recordRecovery, recoveryHint } = require("../browser/recovery.cjs");
const target = {
  ref: "e1",
  role: "input",
  name: "Поиск",
  scope: "page/shadow:1",
  signature: "exact observed attributes"
};
const snapshot = (nodes = [target]) => ({
  id: "old",
  tab: "tab-a",
  version: 3,
  document: { url: "https://example.test/project", nodes }
});
const action = { kind: "browser_fill", ref: "e1", text: "private input not kept" };

test("replacement hints describe fresh refs without retaining input values or dispatching actions", () => {
  const record = recordRecovery(action, snapshot(), "target_missing", 100);
  const fresh = { ...snapshot([{ ...target, ref: "e2" }]), id: "fresh" };
  const hint = recoveryHint(record, fresh, 101);
  assert.deepEqual(hint.candidate_refs, ["e2"]);
  assert.equal(hint.current_observation_id, "fresh");
  assert.equal(hint.requires_new_action, true);
  assert.equal(hint.previous_action_executed, false);
  assert.ok(!JSON.stringify({ record, hint }).includes(action.text));
});
test("duplicates stay ambiguous, matches are bounded and a partial view is explicit", () => {
  const record = recordRecovery(action, snapshot(), "target_missing", 100);
  const fresh = snapshot(Array.from({ length: 8 }, (_, i) => ({ ...target, ref: "new" + i })));
  fresh.document.truncated = true;
  const hint = recoveryHint(record, fresh, 110);
  assert.equal(hint.candidate_refs.length, 3);
  assert.equal(hint.more_candidates, true);
  assert.equal(hint.partial_snapshot, true);
});
test("name alone cannot match a different form, frame or origin", () => {
  const record = recordRecovery(action, snapshot(), "target_missing", 100);
  assert.deepEqual(
    recoveryHint(
      record,
      snapshot([
        { ...target, ref: "new", signature: "another form action" },
        { ...target, ref: "frame", scope: "frame:2" }
      ]),
      110
    ).candidate_refs,
    []
  );
  for (const fresh of [
    { ...snapshot(), tab: "tab-b" },
    { ...snapshot(), version: 4 },
    { ...snapshot(), document: { ...snapshot().document, url: "https://other.test/project" } }
  ])
    assert.equal(recoveryHint(record, fresh, 110), null);
  assert.equal(recoveryHint(record, snapshot(), 30101), null);
  assert.equal(recoveryHint(record, snapshot(), 99), null);
});
test("blocked/changed targets are explained but never proposed as replacements", () => {
  for (const reason of ["target_blocked", "target_changed", undefined]) {
    const hint = recoveryHint(
      recordRecovery(action, snapshot(), reason, 100),
      snapshot([{ ...target, ref: "new" }]),
      101
    );
    assert.deepEqual(hint.candidate_refs, []);
  }
  assert.equal(
    recordRecovery(action, snapshot([{ ...target, secret: true }]), "target_missing", 100),
    null
  );
  assert.equal(
    recordRecovery(
      action,
      snapshot([{ ...target, signature: "x".repeat(16385) }]),
      "target_missing",
      100
    ),
    null
  );
});
