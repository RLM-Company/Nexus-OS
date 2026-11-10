"use strict";
// Explicitly selected, owner-accepted local example. Never an executable replay,
// authority, model weight update or independent proof of an external effect.
const { createHash } = require("node:crypto");
const { checkpoint } = require("./work-cycle-policy.cjs");
const { containsCredentialText } = require("./checkpoint-text.cjs");
const { recoveryWriteActions } = require("./computer-policy.cjs");
const unavailable = () => {
  throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function buildWorkReference(record) {
  if (record?.correction) return buildWorkCorrection(record);
  if (
    !record ||
    !UUID.test(record.id) ||
    record.executionMode !== "work" ||
    record.status !== "completed" ||
    !Number.isSafeInteger(record.acceptedAt) ||
    record.acceptedAt < record.createdAt ||
    typeof record.goal !== "string" ||
    !record.goal.trim() ||
    !record.goal.isWellFormed() ||
    record.goal.length > 8000
  )
    unavailable();
  const plan = record.workPlan && checkpoint(record.workPlan);
  if (!plan || plan.some((s) => s.state !== "checked")) unavailable();
  if (record.steps.some((s) => ["dispatching", "requested"].includes(s.phase))) unavailable();
  const counts = new Map();
  for (const s of record.steps)
    if (
      s.phase === "observed" &&
      !s.kind.startsWith("work_") &&
      !["done", "ask_user", "wait", "observe"].includes(s.kind)
    )
      counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
  const tools = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let goal = record.goal.slice(0, 500);
  if (!goal.isWellFormed()) goal = goal.slice(0, -1);
  const value = {
    format: "koswork.accepted-example.v1",
    source_task_id: record.id,
    source_project_id: record.project,
    accepted_at: record.acceptedAt,
    outcome: "owner_accepted",
    source_goal: goal,
    goal_excerpt_only: goal.length < record.goal.length,
    plan: plan.map(({ title, criteria }) => ({ title, criteria })),
    tool_observations: tools.slice(0, 16).map(([kind, count]) => ({ kind, count })),
    tool_summary_truncated: tools.length > 16
  };
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        id: record.id,
        project: record.project,
        goal: record.goal,
        plan,
        steps: record.steps,
        acceptedAt: record.acceptedAt
      })
    )
    .digest("hex");
  const reference = { ...value, revision };
  if (Buffer.byteLength(JSON.stringify(reference), "utf8") > 14000) unavailable();
  return reference;
}
function canReference(record) {
  try {
    buildWorkReference(record);
    return true;
  } catch {
    return false;
  }
}
const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "step_limit",
  "needs_user"
]);
function canCorrect(record) {
  return Boolean(
    record &&
    UUID.test(record.id) &&
    record.executionMode === "work" &&
    terminal.has(record.status) &&
    typeof record.goal === "string" &&
    record.goal.trim() &&
    record.goal.isWellFormed() &&
    !containsCredentialText(record.goal)
  );
}
function invalidCorrection() {
  throw Error("COMPUTER_CORRECTION_INVALID");
}
function correctionText(input) {
  const limits = { issue: 400, guidance: 800, applies_when: 400 };
  if (!input || typeof input !== "object" || Object.keys(input).length !== 3) invalidCorrection();
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = input[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > limit ||
      !value.isWellFormed() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) ||
      containsCredentialText(value)
    )
      invalidCorrection();
    result[key] = value.trim();
  }
  return result;
}
function cleanCorrection(value) {
  if (
    !value ||
    Object.keys(value).length !== 4 ||
    !Number.isSafeInteger(value.confirmed_at) ||
    value.confirmed_at < 0
  )
    invalidCorrection();
  return {
    ...correctionText({
      issue: value.issue,
      guidance: value.guidance,
      applies_when: value.applies_when
    }),
    confirmed_at: value.confirmed_at
  };
}
function sourceRevision(record) {
  if (!canCorrect(record)) unavailable();
  return createHash("sha256")
    .update(
      JSON.stringify({
        format: "koswork.correction-source.v1",
        id: record.id,
        project: record.project,
        goal: record.goal,
        status: record.status,
        workPlan: record.workPlan ?? null,
        steps: record.steps,
        reviewRequired: record.reviewRequired === true,
        createdAt: record.createdAt,
        acceptedAt: record.acceptedAt,
        referenceSource: record.referenceSource ?? null
      })
    )
    .digest("hex");
}
function buildWorkCorrection(record) {
  const source_revision = sourceRevision(record),
    correction = cleanCorrection(record.correction);
  let goal = record.goal.slice(0, 500);
  if (!goal.isWellFormed()) goal = goal.slice(0, -1);
  const value = {
    format: "koswork.confirmed-correction.v1",
    source_task_id: record.id,
    source_project_id: record.project,
    source_goal: goal,
    goal_excerpt_only: goal.length < record.goal.length,
    source_revision,
    source_outcome: record.status,
    source_requires_review:
      record.reviewRequired === true ||
      record.steps.some(
        (s) =>
          recoveryWriteActions.has(s.kind) &&
          ["dispatching", "requested", "observed"].includes(s.phase)
      ),
    ...correction
  };
  const revision = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const reference = { ...value, revision };
  if (Buffer.byteLength(JSON.stringify(reference), "utf8") > 14000) unavailable();
  return reference;
}
function correctionDraft(record) {
  const source = sourceRevision(record);
  let goal = record.goal.slice(0, 500);
  if (!goal.isWellFormed()) goal = goal.slice(0, -1);
  return {
    taskId: record.id,
    project: record.project,
    source_goal: goal,
    revision: record.correction ? buildWorkCorrection(record).revision : source,
    correction: record.correction ? cleanCorrection(record.correction) : null
  };
}
function suggestCorrections(records, project, goal) {
  if (typeof goal !== "string" || goal.length > 8000 || containsCredentialText(goal)) return [];
  const tokens = (text) =>
    new Set(
      (
        text
          .normalize("NFKC")
          .toLocaleLowerCase("ru")
          .match(/[\p{L}\p{N}]{3,40}/gu) || []
      ).slice(0, 64)
    );
  const query = tokens(goal),
    stop = new Set(["для", "как", "или", "это", "the", "and", "with", "from"]);
  const suggestions = [];
  for (const record of records) {
    if (record.project !== project || !record.correction) continue;
    let reference;
    try {
      reference = buildWorkCorrection(record);
    } catch {
      continue;
    }
    const source = tokens(record.goal + " " + reference.applies_when);
    const matched = [...query].filter((token) => !stop.has(token) && source.has(token));
    if (!matched.length) continue;
    suggestions.push({
      taskId: record.id,
      revision: reference.revision,
      source_goal: reference.source_goal,
      issue: reference.issue,
      guidance: reference.guidance,
      applies_when: reference.applies_when,
      matched_terms: matched.slice(0, 6),
      confirmed_at: reference.confirmed_at,
      score: matched.length
    });
  }
  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score || b.confirmed_at - a.confirmed_at || a.taskId.localeCompare(b.taskId)
    )
    .slice(0, 3);
}
module.exports = {
  buildWorkReference,
  canReference,
  canCorrect,
  correctionText,
  cleanCorrection,
  correctionDraft,
  suggestCorrections
};
