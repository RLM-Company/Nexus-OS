"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { normalizeServerOrigin } = require("./connection-policy.cjs");
const { computerActionKinds, recoveryWriteActions } = require("./computer-policy.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT = /^[a-zA-Z0-9_-]{1,160}$/;
const PHASES = new Set(["planned", "not_executed", "dispatching", "requested", "observed"]);
const STATES = new Set([
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
  "step_limit",
  "needs_user"
]);
const RESTORABLE = new Set(["cancelled", "failed", "interrupted", "step_limit", "needs_user"]);
const MAX_RECORDS = 20,
  MAX_PLAIN = 1_000_000,
  MAX_FILE = 1_500_000,
  MAX_AGE = 30 * 86400_000;
const SENSITIVE =
  /(?:\bBearer\s+\S+|\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+|пароль\s*[:=]?\s*\S+|(?:\b(?:pin|code)\b|код)\s*[:=—-]?\s*\d{4,8}|\b(?:gh[opsur]_|github_pat_|sk-)[a-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu;
const fail = () => {
  throw Error("COMPUTER_HISTORY_UNAVAILABLE");
};
const validTime = (n) => Number.isSafeInteger(n) && n >= 0;

function scopeFor({ origin, owner }) {
  if (
    typeof owner !== "string" ||
    !owner ||
    owner.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(owner)
  )
    fail();
  try {
    if (normalizeServerOrigin(origin) !== origin) fail();
  } catch {
    fail();
  }
  return createHash("sha256")
    .update(origin + "\0" + owner)
    .digest("hex");
}
function safeGoal(goal) {
  if (typeof goal !== "string" || !goal.trim() || goal.length > 8000 || goal.includes("\0")) fail();
  return SENSITIVE.test(goal) ? null : goal;
}
function cleanRecord(r) {
  if (
    !r ||
    !UUID.test(r.id) ||
    !UUID.test(r.writer) ||
    !PROJECT.test(r.project) ||
    !STATES.has(r.status) ||
    (r.executionMode !== undefined && !["computer", "browser", "work"].includes(r.executionMode)) ||
    !validTime(r.createdAt) ||
    !validTime(r.updatedAt) ||
    r.updatedAt < r.createdAt ||
    (r.workspaceId !== null &&
      r.workspaceId !== undefined &&
      (typeof r.workspaceId !== "string" || !/^[a-f0-9]{24}$/.test(r.workspaceId))) ||
    !Array.isArray(r.steps) ||
    r.steps.length > (r.executionMode === "work" ? 90 : 30) ||
    !(r.goal === null || (typeof r.goal === "string" && safeGoal(r.goal) === r.goal))
  )
    fail();
  const steps = r.steps.map((s, i) => {
    if (s.index !== i + 1 || !computerActionKinds.includes(s.kind) || !PHASES.has(s.phase)) fail();
    const source =
      s.source && UUID.test(s.source.run_id) && ["provider", "test"].includes(s.source.mode)
        ? { run_id: s.source.run_id, mode: s.source.mode }
        : null;
    return { index: s.index, kind: s.kind, phase: s.phase, source };
  });
  return {
    id: r.id,
    writer: r.writer,
    project: r.project,
    goal: r.goal,
    status: r.status,
    executionMode: r.executionMode ?? "computer",
    ...(r.executionMode === "work"
      ? { workPlan: r.workPlan ? require("./work-cycle-policy.cjs").plan(r.workPlan, true) : null }
      : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    steps,
    recoveredFrom: UUID.test(r.recoveredFrom) ? r.recoveredFrom : null,
    workspaceId:
      typeof r.workspaceId === "string" && /^[a-f0-9]{24}$/.test(r.workspaceId)
        ? r.workspaceId
        : null,
    reviewRequired: r.reviewRequired === true,
    acceptedAt: validTime(r.acceptedAt) && r.status === "completed" ? r.acceptedAt : null
  };
}
function needsReview(record) {
  return (
    record.reviewRequired === true ||
    record.steps.some(
      (s) =>
        recoveryWriteActions.has(s.kind) &&
        ["dispatching", "requested", "observed"].includes(s.phase)
    )
  );
}

/** Single desktop-process store. Encrypted text/metadata only; never an OS grant or action payload. */
function createComputerHistory(userData, { codec, now = Date.now, namespace = "computer" } = {}) {
  if (!["computer", "work"].includes(namespace)) fail();
  if (!codec?.seal || !codec?.open) fail();
  const writer = randomUUID(),
    directory = path.join(userData, namespace === "work" ? "work-tasks-v1" : "computer-tasks-v1");
  const target = (context) => path.join(directory, scopeFor(context) + ".json");
  function checkDirectory() {
    try {
      const s = fs.lstatSync(directory);
      if (!s.isDirectory() || s.isSymbolicLink()) fail();
    } catch (error) {
      if (error.code !== "ENOENT") fail();
    }
  }
  function read(context) {
    const file = target(context);
    checkDirectory();
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE) fail();
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        envelope.version !== 1 ||
        typeof envelope.sealed !== "string" ||
        envelope.sealed.length > MAX_FILE
      )
        fail();
      const plain = codec.open(envelope.sealed);
      if (typeof plain !== "string" || Buffer.byteLength(plain) > MAX_PLAIN) fail();
      const data = JSON.parse(plain);
      if (
        data.version !== 1 ||
        data.owner !== context.owner ||
        data.origin !== context.origin ||
        !Array.isArray(data.records) ||
        data.records.length > MAX_RECORDS
      )
        fail();
      const records = data.records.map(cleanRecord);
      if (new Set(records.map((r) => r.id)).size !== records.length) fail();
      return records
        .filter((r) => now() - r.updatedAt <= MAX_AGE)
        .map((r) =>
          r.writer !== writer && ["running", "paused"].includes(r.status)
            ? { ...r, status: "interrupted" }
            : r
        );
    } catch (error) {
      if (error.code === "ENOENT") return [];
      fail();
    }
  }
  function write(context, records) {
    checkDirectory();
    const file = target(context);
    fs.mkdirSync(directory, { recursive: true });
    const plain = JSON.stringify({
      version: 1,
      owner: context.owner,
      origin: context.origin,
      records: records.map(cleanRecord)
    });
    if (Buffer.byteLength(plain) > MAX_PLAIN) fail();
    let sealed;
    try {
      sealed = codec.seal(plain);
    } catch {
      fail();
    }
    if (typeof sealed !== "string" || !sealed || sealed.length > MAX_FILE) fail();
    const encoded = JSON.stringify({ version: 1, sealed });
    if (Buffer.byteLength(encoded) > MAX_FILE) fail();
    const temporary = path.join(directory, scopeFor(context) + "." + randomUUID() + ".tmp");
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, encoded, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } catch {
      fail();
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== "ENOENT") fail();
      }
    }
  }
  function get(context, id) {
    if (!UUID.test(id)) fail();
    const record = read(context).find((r) => r.id === id);
    if (!record) throw Error("COMPUTER_HISTORY_NOT_FOUND");
    return record;
  }
  function mutate(context, id, fn, requireWriter = false) {
    const records = read(context),
      r = records.find((r) => r.id === id);
    if (!r || (requireWriter && r.writer !== writer)) throw Error("COMPUTER_HISTORY_NOT_FOUND");
    fn(r);
    r.updatedAt = Math.max(now(), r.updatedAt);
    write(context, records);
  }
  const api = {
    list(context) {
      return read(context)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((r) => ({
          ...r,
          recoverable: RESTORABLE.has(r.status) && r.goal !== null,
          requiresReview: needsReview(r)
        }));
    },
    recovery(context, id) {
      const r = get(context, id);
      if (!RESTORABLE.has(r.status) || r.goal === null)
        throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
      return {
        taskId: r.id,
        executionMode: r.executionMode,
        ...(r.executionMode === "work" ? { workPlan: r.workPlan } : {}),
        project: r.project,
        goal: r.goal,
        requiresReview: needsReview(r),
        workspaceId: r.workspaceId,
        previousResult: JSON.stringify({
          status: "recovery_checkpoint",
          task_id: r.id,
          previous_state: r.status,
          steps: r.steps.map(({ index, kind, phase }) => ({ index, kind, phase })),
          instruction:
            "A prior desktop attempt ended. This record contains no executable action or prior permission. Inspect the fresh state and verify existing results before doing more work. Never blindly repeat an uncertain send, payment, publication, deletion or file write; ask the owner if it cannot be established."
        })
      };
    },
    accept(context, id) {
      mutate(context, id, (r) => {
        if (r.status !== "completed") throw Error("COMPUTER_RESULT_NOT_COMPLETE");
        r.acceptedAt = now();
      });
      return { accepted: true };
    },
    clear(context) {
      checkDirectory();
      try {
        fs.unlinkSync(target(context));
      } catch (error) {
        if (error.code !== "ENOENT") fail();
      }
    },
    clearAll() {
      checkDirectory();
      let names;
      try {
        names = fs.readdirSync(directory);
      } catch (error) {
        if (error.code === "ENOENT") return;
        fail();
      }
      for (const name of names)
        if (/^[a-f0-9]{64}(?:\.json|\.[a-f0-9-]{36}\.tmp)$/.test(name))
          fs.unlinkSync(path.join(directory, name));
    },
    start(
      context,
      { project, goal, recoveredFrom = null, workspaceId = null, executionMode = "computer" }
    ) {
      if (
        !PROJECT.test(project) ||
        (workspaceId !== null &&
          (typeof workspaceId !== "string" || !/^[a-f0-9]{24}$/.test(workspaceId)))
      )
        fail();
      if (!["computer", "browser", "work"].includes(executionMode)) fail();
      const savedGoal = safeGoal(goal);
      const records = read(context);
      let reviewRequired = false;
      if (recoveredFrom !== null) {
        const prior = api.recovery(context, recoveredFrom);
        if (prior.goal !== goal || prior.project !== project)
          throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        if (prior.executionMode !== executionMode) throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        if (prior.workspaceId !== workspaceId) throw Error("COMPUTER_WORKSPACE_CHANGED");
        reviewRequired = prior.requiresReview;
      }
      while (records.length >= MAX_RECORDS) {
        const candidates = records
          .filter((r) => !["running", "paused"].includes(r.status))
          .sort((a, b) => a.updatedAt - b.updatedAt);
        if (!candidates.length) fail();
        records.splice(
          records.findIndex((r) => r.id === candidates[0].id),
          1
        );
      }
      const timestamp = now();
      const r = {
        id: randomUUID(),
        writer,
        project,
        goal: savedGoal,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "running",
        executionMode,
        steps: [],
        recoveredFrom,
        workspaceId,
        reviewRequired,
        acceptedAt: null
      };
      records.push(r);
      write(context, records);
      return {
        id: r.id,
        plan(value) {
          if (executionMode !== "work") fail();
          const metadata =
            value === null ? null : require("./work-cycle-policy.cjs").plan(value, true);
          mutate(
            context,
            r.id,
            (task) => {
              if (!["running", "paused"].includes(task.status)) fail();
              task.workPlan = metadata;
            },
            true
          );
        },
        proposal(index, action, source) {
          mutate(
            context,
            r.id,
            (task) => {
              if (!["running", "paused"].includes(task.status)) fail();
              if (
                index !== task.steps.length + 1 ||
                index > (executionMode === "work" ? 90 : 30) ||
                !computerActionKinds.includes(action.kind)
              )
                fail();
              task.steps.push({
                index,
                kind: action.kind,
                phase: "planned",
                source:
                  source && UUID.test(source.run_id) && ["provider", "test"].includes(source.mode)
                    ? { run_id: source.run_id, mode: source.mode }
                    : null
              });
            },
            true
          );
        },
        mark(index, phase) {
          mutate(
            context,
            r.id,
            (task) => {
              if (!["running", "paused"].includes(task.status)) fail();
              const step = task.steps[index - 1];
              const allowed = {
                planned: ["dispatching", "not_executed"],
                dispatching: ["requested", "not_executed"],
                requested: ["observed"]
              };
              if (!step || !allowed[step.phase]?.includes(phase)) fail();
              step.phase = phase;
            },
            true
          );
        },
        state(status) {
          mutate(
            context,
            r.id,
            (task) => {
              if (!["running", "paused"].includes(task.status) || !STATES.has(status)) fail();
              task.status = status;
            },
            true
          );
        }
      };
    }
  };
  return api;
}
module.exports = { createComputerHistory, needsReview };
