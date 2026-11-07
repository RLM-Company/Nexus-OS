"use strict";
const { containsCredentialText } = require("./checkpoint-text.cjs");
const statuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "step_limit",
  "paused",
  "expired",
  "unavailable"
]);
const same = (a, b) => !!a && !!b && a.owner === b.owner && a.origin === b.origin;
function projectWorkOutcome(value) {
  const result = {
    source: "local_agent_report",
    status:
      value?.status === "needs_user"
        ? "paused"
        : statuses.has(value?.status)
          ? value.status
          : "failed",
    owner_accepted: false
  };
  if (result.status === "completed" && typeof value?.summary === "string" && value.summary.trim()) {
    if (
      value.summary.length <= 3000 &&
      value.summary.isWellFormed() &&
      !containsCredentialText(value.summary)
    )
      result.summary = value.summary;
    else result.summary_omitted = true;
  }
  if (
    typeof value?.task_id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.task_id)
  )
    result.task_id = value.task_id;
  if (Number.isSafeInteger(value?.steps) && value.steps >= 0 && value.steps <= 90)
    result.steps = value.steps;
  return result;
}
// One ephemeral return address. It grants no device/file/model authority.
function createWorkResultRelay({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = 30 * 60000
} = {}) {
  let current = null;
  const api = {
    bind(context, input, callback) {
      api.cancel();
      if (typeof callback !== "function") return null;
      if (
        !context?.owner ||
        !context.origin ||
        typeof input?.goal !== "string" ||
        !input.goal.trim() ||
        input.goal.length > 8000 ||
        typeof input?.project !== "string" ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project)
      )
        throw Error("COMPUTER_PROPOSAL_INVALID");
      const ticket = {
        context: { ...context },
        project: input.project,
        goal: input.goal.trim(),
        callback,
        claimed: false
      };
      current = ticket;
      ticket.timer = setTimer(() => api.finish(ticket, { status: "expired" }), timeoutMs);
      ticket.timer?.unref?.();
      return ticket;
    },
    claim(context, project, goal) {
      if (!current || current.claimed) return null;
      if (
        !same(current.context, context) ||
        current.project !== project ||
        typeof goal !== "string" ||
        current.goal !== goal.trim()
      ) {
        api.cancel();
        return null;
      }
      current.claimed = true;
      return current;
    },
    finish(ticket, result) {
      if (!ticket || ticket !== current) return false;
      current = null;
      clearTimer(ticket.timer);
      try {
        Promise.resolve(ticket.callback(projectWorkOutcome(result))).catch(() => {});
      } catch {}
      return true;
    },
    cancel() {
      if (current) api.finish(current, { status: "cancelled" });
    }
  };
  return api;
}
async function deliverWorkResult({
  isCurrent,
  verifyOwner,
  expectedOwner,
  allowSummary,
  send,
  requestId,
  project,
  result
}) {
  const current = () => {
    try {
      return isCurrent() === true;
    } catch {
      return false;
    }
  };
  if (!current()) return false;
  try {
    if ((await verifyOwner()) !== expectedOwner || !current()) return false;
    let outcome = projectWorkOutcome(result);
    if (outcome.status === "completed") {
      let allowed = false;
      try {
        allowed = (await allowSummary()) === true;
      } catch {}
      if (!current()) return false;
      if (!allowed) outcome = projectWorkOutcome({ status: "unavailable" });
    }
    if (!current()) return false;
    send({ request_id: requestId, project, result: outcome });
    return true;
  } catch {
    return false;
  }
}
module.exports = { projectWorkOutcome, createWorkResultRelay, deliverWorkResult };
