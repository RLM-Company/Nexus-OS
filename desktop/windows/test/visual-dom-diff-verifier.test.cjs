"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDomSnapshot,
  verifyBrowserActionMutation
} = require("../browser/visual-dom-diff-verifier.cjs");

test("verifyBrowserActionMutation detects newly opened modal dialogs and input value changes", () => {
  const pre = {
    url: "https://internal.koswork/apollo/form",
    title: "Apollo Form",
    activeElementId: "btn-open-modal",
    nodes: [
      { id: "input-budget", tag: "input", role: "textbox", value: "200000", visible: true },
      { id: "btn-open-modal", tag: "button", role: "button", text: "Configure", visible: true }
    ]
  };

  const post = {
    url: "https://internal.koswork/apollo/form",
    title: "Apollo Form",
    activeElementId: "modal-confirm-input",
    nodes: [
      { id: "input-budget", tag: "input", role: "textbox", value: "250000", visible: true },
      { id: "btn-open-modal", tag: "button", role: "button", text: "Configure", visible: true },
      { id: "modal-dialog-1", tag: "dialog", role: "dialog", text: "Confirm Apollo Budget", visible: true }
    ]
  };

  const report = verifyBrowserActionMutation(pre, post, {
    type: "click",
    targetId: "btn-open-modal"
  });

  assert.equal(report.actionVerified, true);
  assert.equal(report.isDeadAction, false);
  assert.equal(report.addedCount, 1);
  assert.equal(report.mutatedCount, 1);
  assert.equal(report.modalOrAlertNodes.length, 1);
  assert.equal(report.modalOrAlertNodes[0].id, "modal-dialog-1");
  assert.equal(report.remedialSuggestion, null);
});

test("verifyBrowserActionMutation flags dead/no-op clicks and generates center-bbox remedial instructions", () => {
  const snapshot = {
    url: "https://internal.koswork/apollo/form",
    title: "Apollo Form",
    activeElementId: "body",
    nodes: [
      {
        id: "btn-submit",
        tag: "button",
        role: "button",
        text: "Submit Report",
        visible: true,
        disabled: false,
        bbox: { x: 100, y: 200, width: 120, height: 40 }
      }
    ]
  };

  const report = verifyBrowserActionMutation(snapshot, snapshot, {
    type: "click",
    targetId: "btn-submit"
  });

  assert.equal(report.actionVerified, false);
  assert.equal(report.isDeadAction, true);
  assert.equal(report.totalDomDeltas, 0);
  assert.ok(report.remedialSuggestion.includes("(160, 220)"));
});
