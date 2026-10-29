"use strict";
const { randomUUID } = require("node:crypto");
const policy = require("./work-cycle-policy.cjs");
function createWorkCycleDriver({
  browser,
  computer,
  identity,
  confirmEnvironment,
  onEnvironment = () => {},
  notify = () => {}
}) {
  let context = null,
    goal = "",
    environment = "none",
    generation = 0,
    steps = [],
    last = null,
    effects = false;
  const grants = new Set();
  const state = () => ({
    environment,
    generation,
    steps: steps.map((s) => ({ ...s })),
    permissions: [...grants],
    complete: steps.length > 0 && steps.every((s) => s.state === "checked")
  });
  const changed = () => {
    generation++;
    last = null;
    notify(state());
  };
  async function live(signal) {
    if (!context || signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    const expected = context;
    const current = await identity();
    if (context !== expected || signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
    if (!current || current.owner !== context.owner || current.origin !== context.origin)
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (signal?.aborted) throw Error("COMPUTER_SESSION_STOPPED");
  }
  function current(obs) {
    if (
      !context ||
      !last ||
      last.id !== obs.observation_id ||
      obs.work?.generation !== generation ||
      obs.work.environment !== environment
    )
      throw Error("BROWSER_STALE");
    if (
      last.inner &&
      environment === "browser" &&
      browser.isCurrent &&
      !browser.isCurrent(last.inner)
    )
      throw Error("BROWSER_STALE");
  }
  function allowed(action) {
    if (!steps.length && !["work_plan", "observe", "wait", "ask_user"].includes(action.kind))
      throw Error("WORK_PLAN_REQUIRED");
    if (action.kind.startsWith("browser_") && (environment !== "browser" || !grants.has("browser")))
      throw Error("WORK_ENVIRONMENT_REQUIRED");
    if (
      !["observe", "wait", "done", "ask_user"].includes(action.kind) &&
      !action.kind.startsWith("browser_") &&
      !action.kind.startsWith("workspace_") &&
      !action.kind.startsWith("work_") &&
      (environment !== "computer" || !grants.has("computer"))
    )
      throw Error("WORK_ENVIRONMENT_REQUIRED");
    if (
      !action.kind.startsWith("work_") &&
      !["observe", "wait", "ask_user", "done"].includes(action.kind) &&
      !steps.some((s) => s.state === "running")
    )
      throw Error("WORK_STEP_REQUIRED");
    if (
      ["workspace_create", "workspace_update"].includes(action.kind) &&
      /\.(?:doc|docx|docm|xls|xlsx|xlsm|ppt|pptx|pptm|pdf)$/i.test(action.path)
    )
      throw Error("WORK_FORMAT_UNSUPPORTED");
  }
  return {
    state,
    begin({ context: next, goal: nextGoal, recovery }) {
      browser.stop?.();
      computer.stop?.();
      grants.clear();
      environment = "none";
      context = { owner: next.owner, origin: next.origin };
      goal = nextGoal;
      effects = false;
      steps = recovery?.workPlan
        ? policy
            .plan(recovery.workPlan, true)
            .map((s) => ({ ...s, state: "pending", previousState: s.state, evidence: "" }))
        : [];
      changed();
    },
    checkpoint: () => (steps.length ? policy.checkpoint(steps) : null),
    async observe(signal) {
      await live(signal);
      const revision = generation,
        selected = environment;
      const inner =
        selected === "none"
          ? null
          : await (selected === "browser" ? browser : computer).observe(signal);
      await live(signal);
      if (generation !== revision || selected !== environment) throw Error("BROWSER_STALE");
      const task = state();
      delete task.permissions;
      let view;
      try {
        view = inner ? JSON.parse(inner.description) : null;
      } catch {
        view = inner?.description ?? null;
      }
      const body = { task, view };
      const stringify = () => JSON.stringify(body);
      while (stringify().length > 15000 && view?.nodes?.length) view.nodes.pop();
      if (stringify().length > 15000) {
        if (view && typeof view === "object") view.text = String(view.text ?? "").slice(0, 2000);
        else body.view = String(view ?? "").slice(0, 6000);
      }
      const obs = {
        ...(inner || {
          observation_id: randomUUID(),
          active_window: "work:" + revision,
          width: 1280,
          height: 840
        }),
        description: stringify(),
        work: { environment, generation, plan_steps: steps.length, plan_complete: task.complete }
      };
      if (obs.description.length > 16000) throw Error("WORK_CONTEXT_TOO_LARGE");
      last = { id: obs.observation_id, inner };
      return obs;
    },
    isCurrent(obs) {
      try {
        current(obs);
        return true;
      } catch {
        return false;
      }
    },
    validateAction(action, obs) {
      current(obs);
      allowed(action);
    },
    validateCompletion(obs) {
      current(obs);
      return steps.length > 0 && steps.every((s) => s.state === "checked");
    },
    handlesConfirmation: (action) => action.kind === "work_switch",
    get reobserveAfterApproval() {
      return environment !== "computer";
    },
    recordResult(action) {
      if (
        ["workspace_create", "workspace_update", "workspace_mkdir", "workspace_restore"].includes(
          action.kind
        )
      )
        effects = true;
    },
    requiresConfirmation(action, obs) {
      current(obs);
      if (action.kind === "work_plan") return effects;
      return action.kind.startsWith("browser_")
        ? browser.requiresConfirmation?.(action, last.inner) === true
        : false;
    },
    approvalKey(action, obs) {
      current(obs);
      return JSON.stringify([
        generation,
        environment,
        action.kind.startsWith("browser_") ? browser.approvalKey?.(action, last.inner) : null
      ]);
    },
    describe(action, obs) {
      current(obs);
      return action.kind.startsWith("browser_")
        ? browser.describe?.(action, last.inner)
        : { environment };
    },
    async execute(action, obs, signal) {
      await live(signal);
      current(obs);
      allowed(action);
      if (action.kind === "work_plan") {
        steps = policy.plan(action.steps).map((s) => ({ ...s, evidence: "" }));
        changed();
        return { plan_saved: true, steps: steps.length };
      }
      if (action.kind === "work_step") {
        const target = steps[action.step - 1];
        if (
          !target ||
          action.observation_id !== obs.observation_id ||
          (action.state === "checked" && (target.state !== "running" || !action.evidence.trim()))
        )
          throw Error("WORK_STEP_INVALID");
        if (
          action.state === "running" &&
          steps.some((s, i) => i < action.step - 1 && s.state !== "checked")
        )
          throw Error("WORK_STEP_INVALID");
        if (action.state === "running" && target.state === "checked") {
          for (const next of steps.slice(action.step)) {
            next.state = "pending";
            next.evidence = "";
          }
        }
        target.state = action.state;
        target.evidence = action.evidence;
        changed();
        return {
          step: action.step,
          state: action.state,
          checked_by: action.state === "checked" ? "model" : undefined
        };
      }
      if (action.kind === "work_switch") {
        if (!["browser", "computer"].includes(action.environment))
          throw Error("WORK_ENVIRONMENT_REQUIRED");
        const revision = generation;
        if (!grants.has(action.environment)) {
          const permitted = await confirmEnvironment({
            environment: action.environment,
            goal,
            context,
            signal
          });
          await live(signal);
          if (generation !== revision) throw Error("COMPUTER_SESSION_STOPPED");
          if (!permitted) throw Error("WORK_ENVIRONMENT_DENIED");
          grants.add(action.environment);
        }
        await live(signal);
        current(obs);
        environment = action.environment;
        changed();
        await onEnvironment(environment);
        return { environment, authorized_locally: true };
      }
      if (["observe", "wait"].includes(action.kind) && environment === "none") {
        if (action.kind === "wait")
          await require("node:timers/promises").setTimeout(action.milliseconds, undefined, {
            signal
          });
        return { observed: true };
      }
      effects = true;
      return (environment === "browser" ? browser : computer).execute(action, last.inner, signal);
    },
    stop() {
      context = null;
      grants.clear();
      environment = "none";
      browser.stop?.();
      computer.stop?.();
      changed();
    }
  };
}
module.exports = { createWorkCycleDriver };
