"use strict";
// Explicitly selected, owner-accepted local example. Never an executable replay,
// authority, model weight update or independent proof of an external effect.
const { createHash } = require("node:crypto");
const { checkpoint } = require("./work-cycle-policy.cjs");
const unavailable = () => {
  throw Error("COMPUTER_REFERENCE_UNAVAILABLE");
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function buildWorkReference(record) {
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
module.exports = { buildWorkReference, canReference };
