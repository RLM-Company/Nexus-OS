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
const issuedTickets = new WeakSet();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const boundedText = (value, limit) =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= limit &&
  value.isWellFormed() &&
  !/[\u0000-\u001f\u007f]/u.test(value) &&
  !containsCredentialText(value);
const safeId = (value) => boundedText(value, 160) && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
// PR462 v1 optional receipt. It reports bounded native plan IDs/counts/status,
// never criteria text, file bytes, code execution, model judgement or acceptance.
// Trusted host binding is enforced separately at the relay boundary.
function projectWorkReceipt(value) {
  if (!value || typeof value !== "object" || value.receipt_version !== 1) return undefined;
  if (
    !uuid.test(value.task_id) ||
    !uuid.test(value.request_id) ||
    !uuid.test(value.observation_id) ||
    !uuid.test(value.nonce) ||
    !boundedText(value.owner, 160) ||
    !boundedText(value.origin, 300) ||
    !safeId(value.project) ||
    !boundedText(value.document, 160) ||
    !Number.isSafeInteger(value.steps) ||
    value.steps < 1 ||
    value.steps > 8 ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    !["none", "browser", "computer"].includes(value.environment) ||
    !value.checked ||
    typeof value.checked !== "object" ||
    Object.keys(value.checked).length !== 2 ||
    !Object.hasOwn(value.checked, "count") ||
    !Object.hasOwn(value.checked, "status") ||
    !Number.isSafeInteger(value.checked.count) ||
    value.checked.count !== value.steps ||
    !["checked", "model_checked"].includes(value.checked.status)
  )
    return undefined;
  const receipt = {
    receipt_version: 1,
    kind: "native_work_plan_observed",
    task_id: value.task_id,
    request_id: value.request_id,
    observation_id: value.observation_id,
    nonce: value.nonce,
    owner: value.owner,
    origin: value.origin,
    project: value.project,
    document: value.document,
    environment: value.environment,
    generation: value.generation,
    steps: value.steps,
    checked: { count: value.checked.count, status: value.checked.status },
    source: "local_agent_report",
    owner_accepted: false
  };
  return JSON.stringify(receipt).length <= 2400 ? receipt : undefined;
}
/** Trusted ticket binding; a renderer/model-provided receipt is not evidence. */
function bindWorkReceipt(outcome, ticket, requestId) {
  if (outcome.status !== "completed" || !outcome.receipt) return outcome;
  const b = ticket?.receiptBinding;
  if (!ticket || !b) {
    const unbound = { ...outcome, receipt_omitted: true };
    delete unbound.receipt;
    return unbound;
  }
  const r = outcome.receipt;
  const context = ticket.context;
  const bound =
    same(context, b.context) &&
    ticket.project === b.project &&
    ticket.goal === b.goal &&
    requestId === b.requestId &&
    r.request_id === b.requestId &&
    r.task_id === b.taskId &&
    r.nonce === b.nonce &&
    r.owner === context.owner &&
    r.origin === context.origin &&
    r.project === ticket.project &&
    r.document === b.document;
  if (!bound) {
    const next = { ...outcome, receipt_omitted: true };
    delete next.receipt;
    return next;
  }
  return outcome;
}
function projectWorkOutcome(value, ticket = null, requestId = null) {
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
  if (typeof value?.task_id === "string" && uuid.test(value.task_id))
    result.task_id = value.task_id;
  if (Number.isSafeInteger(value?.steps) && value.steps >= 0 && value.steps <= 90)
    result.steps = value.steps;
  // Optional for old clients; malformed, partial or unbound receipts never imply verification.
  const receipt = result.status === "completed" ? projectWorkReceipt(value?.receipt) : undefined;
  if (receipt) result.receipt = receipt;
  else if (value?.receipt !== undefined) result.receipt_omitted = true;
  // A receipt without the actual one-shot relay ticket is never forwarded.
  if (result.receipt && !ticket?.receiptBinding) {
    delete result.receipt;
    result.receipt_omitted = true;
  }
  return bindWorkReceipt(result, ticket, requestId);
}
// One ephemeral return address. It grants no device/file/model authority.
// The trusted host supplies the actual originating-window requestId and document;
// a newly generated nonce here does not establish binding to the original request.
function createWorkResultRelay({
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = 30 * 60000,
  newId = require("node:crypto").randomUUID
} = {}) {
  let current = null;
  const api = {
    bind(context, input, callback, options = null) {
      api.cancel();
      if (typeof callback !== "function") return null;
      if (
        !context?.owner ||
        !context.origin ||
        typeof input?.goal !== "string" ||
        !input.goal.trim() ||
        input.goal.length > 8000 ||
        typeof input?.project !== "string" ||
        !/^[a-zA-Z0-9_-]{1,160}$/.test(input.project) ||
        (options !== null && (!uuid.test(options.requestId) || !boundedText(options.document, 160)))
      )
        throw Error("COMPUTER_PROPOSAL_INVALID");
      const ticket = {
        context: { ...context },
        project: input.project,
        goal: input.goal.trim(),
        callback,
        claimed: false,
        receiptBinding:
          options === null
            ? null
            : {
                context: { owner: context.owner, origin: context.origin },
                project: input.project,
                goal: input.goal.trim(),
                requestId: options.requestId,
                document: options.document,
                taskId: newId(),
                nonce: newId()
              }
      };
      issuedTickets.add(ticket);
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
    ticketFor(ticket) {
      return ticket && ticket === current && ticket.receiptBinding
        ? { ...ticket.receiptBinding, context: { ...ticket.receiptBinding.context } }
        : null;
    },
    finish(ticket, result) {
      if (!ticket || ticket !== current) return false;
      current = null;
      clearTimer(ticket.timer);
      try {
        Promise.resolve(
          ticket.callback(
            projectWorkOutcome(result, ticket, ticket.receiptBinding?.requestId ?? null),
            ticket
          )
        ).catch(() => {});
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
  result,
  ticket = null
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
    const trustedTicket =
      ticket &&
      issuedTickets.has(ticket) &&
      ticket.claimed &&
      ticket.context.owner === expectedOwner &&
      ticket.project === project &&
      ticket.receiptBinding?.requestId === requestId
        ? ticket
        : null;
    let outcome = projectWorkOutcome(result, trustedTicket, requestId);
    if (outcome.status === "completed") {
      let allowed = false;
      try {
        allowed = (await allowSummary()) === true;
      } catch {}
      if (!current()) return false;
      if (!allowed) outcome = projectWorkOutcome({ status: "unavailable" });
    }
    if (!current()) return false;
    if (outcome.receipt) {
      // Internal identity/nonce/document bindings stay in the host process.
      const {
        receipt_version,
        kind,
        task_id,
        observation_id,
        environment,
        generation,
        steps,
        checked
      } = outcome.receipt;
      outcome.receipt = {
        receipt_version,
        kind,
        task_id: outcome.task_id ?? task_id,
        observation_id,
        environment,
        generation,
        steps,
        checked,
        source: "local_agent_report",
        owner_accepted: false
      };
    }
    send({ request_id: requestId, project, result: outcome });
    return true;
  } catch {
    return false;
  }
}
module.exports = {
  projectWorkOutcome,
  projectWorkReceipt,
  createWorkResultRelay,
  deliverWorkResult
};
