"use strict";
// Adapts Gemini's visual DOM diff into bounded observations, not success claims.
// Page text, changing clocks and a successful dispatch are not proof of a goal.
const supported = new Set(["browser_click", "browser_click_at", "browser_fill", "browser_key"]);
function actionProbe(action, doc) {
  if (!supported.has(action.kind)) return null;
  const node = doc.nodes.find((n) => n.ref === action.ref);
  return {
    kind: action.kind,
    ref: action.ref,
    url: doc.url,
    target: node
      ? JSON.stringify([node.signature, node.checked, node.expanded, node.disabled])
      : null,
    notices: new Set((doc.notices || []).map((n) => JSON.stringify(n)))
  };
}
function actionEvidence(probe, doc, inputVerified = false) {
  const target = doc.nodes.find((n) => n.ref === probe.ref);
  const targetChanged =
    !!probe.target &&
    !!target &&
    probe.target !==
      JSON.stringify([target.signature, target.checked, target.expanded, target.disabled]);
  const noticeRoles = [
    ...new Set(
      (doc.notices || []).filter((n) => !probe.notices.has(JSON.stringify(n))).map((n) => n.role)
    )
  ].slice(0, 8);
  const urlChanged = probe.url !== doc.url;
  return {
    action_kind: probe.kind,
    assessment:
      urlChanged || targetChanged || noticeRoles.length || inputVerified
        ? "change_observed"
        : "not_observed",
    url_changed: urlChanged,
    target_changed: targetChanged,
    new_notice_roles: noticeRoles,
    ...(inputVerified ? { input_verified_at_action: true } : {}),
    goal_verified: false,
    instruction:
      "This describes a local state transition, not proof of task success. Inspect fresh content and receipts. No observed change does not prove the action had no effect; never automatically repeat a click, submission or other external effect."
  };
}
module.exports = { actionProbe, actionEvidence };
