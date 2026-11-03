"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { actionProbe, actionEvidence } = require("../browser/action-evidence.cjs");
const doc = () => ({
  url: "https://example.test/report",
  text: "Clock 12:00",
  nodes: [{ ref: "e1", signature: "Save report", disabled: false }],
  notices: []
});
test("changing page clocks, dispatch and disappearing targets do not prove success or authorize retries", () => {
  const before = doc(),
    probe = actionProbe({ kind: "browser_click", ref: "e1" }, before);
  for (const after of [
    { ...doc(), text: "Clock 12:01" },
    { ...doc(), nodes: [] }
  ]) {
    const result = actionEvidence(probe, after);
    assert.equal(result.assessment, "not_observed");
    assert.equal(result.goal_verified, false);
    assert.match(result.instruction, /never automatically repeat/);
  }
});
test("only relevant target, URL, immediate input verification or new notice changes are reported", () => {
  const before = doc(),
    probe = actionProbe({ kind: "browser_click", ref: "e1" }, before);
  const changed = actionEvidence(probe, {
    ...doc(),
    nodes: [{ ...before.nodes[0], expanded: "true" }]
  });
  assert.equal(changed.target_changed, true);
  assert.equal(changed.goal_verified, false);
  assert.equal(
    actionEvidence(probe, { ...doc(), url: "https://example.test/result" }).url_changed,
    true
  );
  const notice = actionEvidence(probe, {
    ...doc(),
    notices: [{ role: "alert", text: "Submission rejected" }]
  });
  assert.deepEqual(notice.new_notice_roles, ["alert"]);
  assert.equal(notice.goal_verified, false);
  assert.equal(actionEvidence(probe, doc(), true).input_verified_at_action, true);
});
test("an existing alert is not a new result and probe data never includes typed contents", () => {
  const before = { ...doc(), notices: [{ role: "alert", text: "Existing notice" }] };
  const probe = actionProbe(
    { kind: "browser_fill", ref: "e1", text: "private fixture value" },
    before
  );
  assert.equal(actionEvidence(probe, before).assessment, "not_observed");
  assert.equal(JSON.stringify(probe).includes("private fixture value"), false);
  assert.equal(
    actionProbe({ kind: "workspace_create", path: "x.txt", content: "data" }, before),
    null
  );
});
