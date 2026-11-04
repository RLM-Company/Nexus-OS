"use strict";

// One failed, pre-input target in the current engine only. No selector execution,
// text values, disk history, confidence score or automatic action replay.
function recordRecovery(action, snapshot, reason, at) {
  if (
    !snapshot ||
    !["browser_click", "browser_fill", "browser_key", "browser_upload"].includes(action.kind)
  )
    return null;
  const node = snapshot.document.nodes.find((n) => n.ref === action.ref);
  if (!node || node.secret || typeof node.signature !== "string" || node.signature.length > 16384)
    return null;
  return {
    tab: snapshot.tab,
    version: snapshot.version,
    url: snapshot.document.url,
    observation: snapshot.id,
    at,
    action: action.kind,
    reason: ["target_missing", "target_blocked", "target_changed"].includes(reason)
      ? reason
      : "target_not_interactable",
    ref: node.ref,
    role: node.role,
    name: String(node.name || "").slice(0, 180),
    scope: node.scope || "page",
    signature: node.signature
  };
}

function recoveryHint(record, snapshot, at) {
  if (
    !record ||
    at < record.at ||
    at - record.at > 30000 ||
    record.tab !== snapshot.tab ||
    record.version !== snapshot.version ||
    record.url !== snapshot.document.url
  )
    return null;
  const candidates = [];
  let more = false;
  if (record.reason === "target_missing") {
    for (const node of snapshot.document.nodes) {
      if (
        node.secret ||
        (node.scope || "page") !== record.scope ||
        node.signature !== record.signature
      )
        continue;
      if (candidates.length === 3) {
        more = true;
        break;
      }
      candidates.push(node.ref);
    }
  }
  return {
    previous_action_executed: false,
    action_kind: record.action,
    reason: record.reason,
    failed_observation_id: record.observation,
    current_observation_id: snapshot.id,
    target: { role: record.role, name: record.name },
    candidate_refs: candidates,
    more_candidates: more,
    partial_snapshot: snapshot.document.truncated === true,
    requires_new_action: true,
    instruction:
      "Use the current page to replan. Candidate refs only share the previously observed attributes; they do not prove the same purpose, availability or effect. Select a current ref explicitly. Existing confirmation and input checks still apply. Never repeat an action whose effect is uncertain."
  };
}
module.exports = { recordRecovery, recoveryHint };
