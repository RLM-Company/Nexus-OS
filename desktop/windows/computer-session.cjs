"use strict";

const { ComputerSessionGate, recoveryWriteActions } = require("./computer-policy.cjs");
const { setTimeout: delay } = require("node:timers/promises");

class ComputerSession {
  constructor({
    driver,
    planner,
    identity,
    confirm,
    notify,
    allowHumanResume = false,
    history = null,
    now = Date.now
  }) {
    Object.assign(this, {
      driver,
      planner,
      identity,
      confirm,
      notify,
      allowHumanResume,
      history,
      now
    });
    this.gate = new ComputerSessionGate({ now });
    this.active = null;
  }
  async assertLive(state) {
    if (this.active !== state || state.controller.signal.aborted)
      throw Error("COMPUTER_SESSION_STOPPED");
    this.gate.assert(state.grant);
    const context = await this.identity();
    if (!context || context.origin !== state.grant.origin || context.owner !== state.grant.owner)
      throw Error("COMPUTER_IDENTITY_CHANGED");
    if (this.active !== state || state.controller.signal.aborted)
      throw Error("COMPUTER_SESSION_STOPPED");
    this.gate.assert(state.grant);
  }
  async run({ project, goal, maxSteps = 20, recovery = null, expectedContext = null }) {
    if (this.poisoned) throw Error("COMPUTER_RECOVERY_RESTART_REQUIRED");
    if (this.active) throw Error("COMPUTER_BUSY");
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 30)
      throw Error("COMPUTER_STEPS_INVALID");
    const state = {
      controller: new AbortController(),
      grant: null,
      session: null,
      phase: "confirming"
    };
    this.active = state;
    let outcome = "interrupted";
    const result = (value) => ({
      ...value,
      ...(state.journal ? { task_id: state.journal.id } : {})
    });
    try {
      const context = await this.identity();
      if (!context) throw Error("COMPUTER_OWNER_UNVERIFIED");
      if (
        expectedContext &&
        (context.owner !== expectedContext.owner || context.origin !== expectedContext.origin)
      )
        throw Error("COMPUTER_IDENTITY_CHANGED");
      if (recovery) {
        if (!this.history) throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        recovery = this.history.recovery(context, recovery.taskId);
        if (recovery.project !== project || recovery.goal !== goal)
          throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
      }
      if (this.active !== state || state.controller.signal.aborted)
        throw Error("COMPUTER_SESSION_STOPPED");
      if (
        !(await this.confirm({
          kind: "session",
          origin: context.origin,
          project,
          goal,
          recovery,
          signal: state.controller.signal
        }))
      )
        throw Error("COMPUTER_CANCELLED");
      if (this.active !== state || state.controller.signal.aborted)
        throw Error("COMPUTER_SESSION_STOPPED");
      state.grant = this.gate.enable({ ...context, project, goal });
      await this.assertLive(state);
      if (
        recovery &&
        (recovery.project !== project ||
          recovery.goal !== goal ||
          typeof recovery.previousResult !== "string" ||
          recovery.previousResult.length > 16000 ||
          typeof recovery.requiresReview !== "boolean")
      )
        throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
      state.journal = this.history?.start(context, {
        project,
        goal,
        recoveredFrom: recovery?.taskId ?? null
      });
      if (state.journal)
        this.notify({
          phase: "checkpoint",
          task_id: state.journal.id,
          message: "Локальная контрольная точка сохранена"
        });
      state.session = await this.planner.begin({
        project,
        goal,
        maxSteps,
        context: state.grant,
        signal: state.controller.signal
      });
      let previousResult = recovery?.previousResult ?? "";
      let approval = null;
      let pendingObservation = null;
      for (let step = 0; step < maxSteps; step++) {
        await this.assertLive(state);
        let observation;
        for (let capture = 0; ; capture++) {
          try {
            observation = await this.driver.observe(state.controller.signal);
            break;
          } catch (error) {
            if (
              capture >= 3 ||
              !["COMPUTER_WINDOW_CHANGED", "COMPUTER_USER_INPUT_ACTIVE"].includes(error?.message)
            )
              throw error;
            // App launch/activation may still be settling. Never dispatch a model
            // request until an unmodified foreground/input snapshot is available.
            await delay(250 * (capture + 1), undefined, { signal: state.controller.signal });
            await this.assertLive(state);
          }
        }
        await this.assertLive(state);
        if (pendingObservation !== null) {
          state.journal?.mark(pendingObservation, "observed");
          pendingObservation = null;
        }
        const proposal = await this.planner.next({
          session: state.session,
          project,
          step,
          observation,
          previousResult,
          signal: state.controller.signal
        });
        await this.assertLive(state);
        if (
          typeof proposal.requires_confirmation !== "boolean" ||
          typeof proposal.message !== "string" ||
          proposal.message.length > 1000
        )
          throw Error("COMPUTER_PROPOSAL_INVALID");
        const action = this.gate.consume(
          state.grant,
          `${state.session.id}:${step}`,
          proposal.action
        );
        state.journal?.proposal(step + 1, action, proposal.decision_source);
        this.notify({
          step: step + 1,
          message: proposal.message,
          action: action.kind,
          decision_source: proposal.decision_source
        });
        if (action.kind === "done") {
          state.journal?.mark(step + 1, "not_executed");
          outcome = "completed";
          return result({ status: "completed", summary: action.summary, steps: step + 1 });
        }
        if (action.kind === "ask_user") {
          approval = null;
          state.journal?.mark(step + 1, "not_executed");
          if (!this.allowHumanResume || step + 1 >= maxSteps) {
            outcome = "needs_user";
            return result({ status: "needs_user", summary: action.question, steps: step + 1 });
          }
          state.phase = "awaiting_user";
          state.journal?.state("paused");
          // No observations, paid calls or native input while the owner handles
          // login/unlock. Resume carries no text or credentials back to the model.
          await new Promise((resolve, reject) => {
            const cleanup = () => {
              state.controller.signal.removeEventListener("abort", abort);
              delete state.resume;
            };
            const abort = () => {
              cleanup();
              reject(Error("COMPUTER_SESSION_STOPPED"));
            };
            state.resume = () => {
              cleanup();
              resolve();
            };
            state.controller.signal.addEventListener("abort", abort, { once: true });
            if (state.controller.signal.aborted) return abort();
            this.notify({ phase: "awaiting_user", message: action.question, step: step + 1 });
          });
          await this.assertLive(state);
          state.phase = "running";
          state.journal?.state("running");
          previousResult = JSON.stringify({
            status: "owner_resumed",
            instruction:
              "The owner explicitly resumed locally. Inspect a fresh observation to determine what changed. No credential or extra authorization was supplied."
          });
          this.notify({
            phase: "running",
            message: "Продолжаем после действия владельца",
            step: step + 1
          });
          continue;
        }
        const approved =
          approval &&
          approval.action === JSON.stringify(action) &&
          approval.window === observation.active_window &&
          this.now() < approval.expires;
        const recoveryReview = recovery?.requiresReview && recoveryWriteActions.has(action.kind);
        if ((proposal.requires_confirmation || recoveryReview) && !approved) {
          if (
            !(await this.confirm({
              kind: "action",
              action,
              message: proposal.message,
              recoveryReview: !!recoveryReview,
              signal: state.controller.signal
            }))
          )
            throw Error("COMPUTER_CANCELLED");
          await this.assertLive(state);
          approval = {
            action: JSON.stringify(action),
            window: observation.active_window,
            expires: this.now() + 60000
          };
          state.journal?.mark(step + 1, "not_executed");
          previousResult = JSON.stringify({
            status: "approved_for_replanning",
            action,
            window_id: observation.active_window,
            instruction:
              "Confirmation changed focus. Restore the target window and inspect a fresh observation before proposing the approved action again."
          });
          continue;
        }
        if (approved) approval = null;
        // Recheck server-side revocation immediately before the native action.
        const authorizationStarted = this.now();
        const authorization = await this.planner.authorize({
          session: state.session,
          project,
          step,
          action,
          signal: state.controller.signal
        });
        if (
          authorization?.authorized !== true ||
          authorization.valid_for_ms !== 10000 ||
          this.now() - authorizationStarted >= 10000
        )
          throw Error("COMPUTER_ACTION_AUTHORIZATION_EXPIRED");
        // One action per observation. Driver independently refuses stale foreground targets.
        await this.assertLive(state);
        state.journal?.mark(step + 1, "dispatching");
        if (this.now() - authorizationStarted >= 10000)
          throw Error("COMPUTER_ACTION_AUTHORIZATION_EXPIRED");
        try {
          const response = await this.driver.execute(action, observation, state.controller.signal);
          state.journal?.mark(step + 1, "requested");
          pendingObservation = step + 1;
          previousResult = JSON.stringify(response).slice(0, 16000);
        } catch (error) {
          if (
            ![
              "COMPUTER_WINDOW_CHANGED",
              "COMPUTER_OBSERVATION_STALE",
              "COMPUTER_USER_INPUT_ACTIVE",
              "COMPUTER_TARGET_OCCLUDED"
            ].includes(error?.message)
          )
            throw error;
          state.journal?.mark(step + 1, "not_executed");
          previousResult = JSON.stringify({
            not_executed: true,
            reason: error.message,
            instruction:
              "Inspect a fresh observation and replan; never blindly repeat the prior action."
          });
        }
      }
      outcome = "step_limit";
      return result({
        status: "step_limit",
        summary: "Достигнут лимит шагов. Проверьте результат перед продолжением.",
        steps: maxSteps
      });
    } catch (error) {
      if (
        error?.message?.startsWith("COMPUTER_HISTORY_") &&
        !(state.controller.signal.aborted && error.message === "COMPUTER_HISTORY_NOT_FOUND")
      )
        this.poisoned = true;
      outcome =
        state.controller.signal.aborted || error?.message === "COMPUTER_CANCELLED"
          ? "cancelled"
          : "failed";
      throw error;
    } finally {
      const wasAborted = state.controller.signal.aborted;
      this.gate.stop();
      state.controller.abort();
      let cleanupFailed = false;
      try {
        this.driver.stop?.();
      } catch {
        cleanupFailed = true;
        this.poisoned = true;
      }
      let checkpointFailed = false;
      try {
        state.journal?.state(cleanupFailed ? "failed" : outcome);
      } catch (error) {
        checkpointFailed = !(wasAborted && error.message === "COMPUTER_HISTORY_NOT_FOUND");
      }
      try {
        await Promise.resolve()
          .then(() => this.planner.end({ session: state.session, project }))
          .catch(() => {});
      } finally {
        if (this.active === state) this.active = null;
      }
      if (checkpointFailed) {
        this.poisoned = true;
        throw Error("COMPUTER_HISTORY_UNAVAILABLE");
      }
      if (cleanupFailed) throw Error("COMPUTER_RECOVERY_RESTART_REQUIRED");
    }
  }
  stop() {
    this.gate.stop();
    this.active?.controller.abort();
    try {
      this.driver.stop?.();
    } catch {
      this.poisoned = true;
    }
  }
  resume() {
    const state = this.active;
    if (
      !state ||
      state.phase !== "awaiting_user" ||
      state.controller.signal.aborted ||
      !state.resume
    )
      return false;
    state.phase = "resuming";
    state.resume();
    return true;
  }
}
module.exports = { ComputerSession };
