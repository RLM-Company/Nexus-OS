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
    workspace = null,
    executionMode = "computer",
    taskGate = null,
    now = Date.now
  }) {
    if (!["computer", "browser", "work"].includes(executionMode))
      throw Error("COMPUTER_ACTION_INVALID");
    Object.assign(this, {
      driver,
      planner,
      identity,
      confirm,
      notify,
      allowHumanResume,
      history,
      workspace,
      executionMode,
      taskGate,
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
    if (
      this.workspace &&
      (this.workspace.snapshot(context)?.id ?? null) !== (state.workspace?.id ?? null)
    )
      throw Error("COMPUTER_WORKSPACE_CHANGED");
    if (this.active !== state || state.controller.signal.aborted)
      throw Error("COMPUTER_SESSION_STOPPED");
    this.gate.assert(state.grant);
  }
  async run({ project, goal, maxSteps = 20, recovery = null, expectedContext = null }) {
    if (this.poisoned) throw Error("COMPUTER_RECOVERY_RESTART_REQUIRED");
    if (this.active) throw Error("COMPUTER_BUSY");
    if (
      !Number.isInteger(maxSteps) ||
      maxSteps < 1 ||
      maxSteps > (this.executionMode === "work" ? 90 : 30)
    )
      throw Error("COMPUTER_STEPS_INVALID");
    const release = this.taskGate?.claim();
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
      state.workspace = this.workspace?.snapshot(context) ?? null;
      if (
        expectedContext &&
        (context.owner !== expectedContext.owner || context.origin !== expectedContext.origin)
      )
        throw Error("COMPUTER_IDENTITY_CHANGED");
      if (recovery) {
        if (!this.history) throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        recovery = this.history.recovery(context, recovery.taskId);
        if ((recovery.executionMode ?? "computer") !== this.executionMode)
          throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        if (recovery.project !== project || recovery.goal !== goal)
          throw Error("COMPUTER_RECOVERY_UNAVAILABLE");
        if ((recovery.workspaceId ?? null) !== (state.workspace?.id ?? null))
          throw Error("COMPUTER_WORKSPACE_CHANGED");
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
          workspace: state.workspace,
          signal: state.controller.signal
        }))
      )
        throw Error("COMPUTER_CANCELLED");
      if (this.active !== state || state.controller.signal.aborted)
        throw Error("COMPUTER_SESSION_STOPPED");
      state.grant = this.gate.enable({ ...context, project, goal });
      await this.assertLive(state);
      if (this.executionMode === "work") this.driver.begin({ context, goal, recovery });
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
        recoveredFrom: recovery?.taskId ?? null,
        workspaceId: state.workspace?.id ?? null,
        executionMode: this.executionMode
      });
      if (state.journal)
        this.notify({
          phase: "checkpoint",
          task_id: state.journal.id,
          message: "Локальная контрольная точка сохранена"
        });
      if (this.executionMode === "work") state.journal?.plan(this.driver.checkpoint());
      state.session = await this.planner.begin({
        project,
        goal,
        maxSteps,
        executionMode: this.executionMode,
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
              !["COMPUTER_WINDOW_CHANGED", "COMPUTER_USER_INPUT_ACTIVE", "BROWSER_STALE"].includes(
                error?.message
              )
            )
              throw error;
            // App launch/activation may still be settling. Never dispatch a model
            // request until an unmodified foreground/input snapshot is available.
            await delay(250 * (capture + 1), undefined, { signal: state.controller.signal });
            await this.assertLive(state);
          }
        }
        await this.assertLive(state);
        if (state.workspace) observation = { ...observation, workspace: state.workspace };
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
        if (
          (this.executionMode === "browser" &&
            !action.kind.startsWith("browser_") &&
            !action.kind.startsWith("workspace_") &&
            !["observe", "wait", "done", "ask_user"].includes(action.kind)) ||
          (this.executionMode === "computer" && action.kind.startsWith("browser_")) ||
          (this.executionMode !== "work" && action.kind.startsWith("work_"))
        )
          throw Error("COMPUTER_ACTION_INVALID");
        state.journal?.proposal(step + 1, action, proposal.decision_source);
        this.notify({
          step: step + 1,
          message: proposal.message,
          action: action.kind,
          decision_source: proposal.decision_source
        });
        if (this.driver.isCurrent && !this.driver.isCurrent(observation)) {
          state.journal?.mark(step + 1, "not_executed");
          previousResult = JSON.stringify({
            not_executed: true,
            reason: "BROWSER_STALE",
            instruction: "Inspect the fresh page; the old action was not executed."
          });
          continue;
        }
        if (action.kind === "done") {
          if (this.driver.validateCompletion && !this.driver.validateCompletion(observation))
            throw Error("WORK_RESULT_UNCHECKED");
          state.journal?.mark(step + 1, "not_executed");
          outcome = "completed";
          return result({ status: "completed", summary: action.summary, steps: step + 1 });
        }
        if (this.driver.validateAction) {
          try {
            this.driver.validateAction(action, observation);
          } catch (error) {
            if (
              ![
                "WORK_PLAN_REQUIRED",
                "WORK_ENVIRONMENT_REQUIRED",
                "WORK_STEP_REQUIRED",
                "WORK_FORMAT_UNSUPPORTED"
              ].includes(error.message)
            )
              throw error;
            state.journal?.mark(step + 1, "not_executed");
            previousResult = JSON.stringify({
              not_executed: true,
              reason: error.message,
              instruction:
                "Create the plan, select its running step and authorize the required environment. Text-file tools cannot create Office/PDF documents: use a real authorized application, never rename plain text to an Office extension."
            });
            continue;
          }
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
          this.now() < approval.expires &&
          approval.evidence === (this.driver.approvalKey?.(action, observation) ?? "");
        const approvalEvidence = this.driver.approvalKey?.(action, observation) ?? "";
        const recoveryReview = recovery?.requiresReview && recoveryWriteActions.has(action.kind);
        const workspaceWrite =
          action.kind.startsWith("workspace_") && recoveryWriteActions.has(action.kind);
        const nativeReview = this.driver.requiresConfirmation?.(action, observation) === true;
        if (
          !this.driver.handlesConfirmation?.(action) &&
          (proposal.requires_confirmation || recoveryReview || workspaceWrite || nativeReview) &&
          !approved
        ) {
          if (
            !(await this.confirm({
              kind: "action",
              action,
              message: proposal.message,
              recoveryReview: !!recoveryReview,
              evidence: this.driver.describe?.(action, observation),
              signal: state.controller.signal
            }))
          )
            throw Error("COMPUTER_CANCELLED");
          await this.assertLive(state);
          if (this.executionMode !== "computer" && this.driver.reobserveAfterApproval) {
            let fresh;
            try {
              fresh = await this.driver.observe(state.controller.signal);
            } catch (error) {
              if (error.message !== "BROWSER_STALE") throw error;
              state.journal?.mark(step + 1, "not_executed");
              previousResult = JSON.stringify({
                not_executed: true,
                reason: "approval_invalidated",
                instruction:
                  "The page navigated during confirmation. No action was executed; inspect a fresh page."
              });
              approval = null;
              continue;
            }
            await this.assertLive(state);
            let unchanged = false;
            try {
              unchanged = this.driver.approvalKey(action, fresh) === approvalEvidence;
            } catch {}
            if (!unchanged) {
              state.journal?.mark(step + 1, "not_executed");
              previousResult = JSON.stringify({
                not_executed: true,
                reason: "approval_invalidated",
                instruction:
                  "The browser target changed after confirmation. Inspect the fresh page and request a new decision; no action was executed."
              });
              approval = null;
              continue;
            }
            observation = state.workspace ? { ...fresh, workspace: state.workspace } : fresh;
            approval = null;
          } else {
            approval = {
              action: JSON.stringify(action),
              window: observation.active_window,
              evidence: approvalEvidence,
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
          let response;
          if (action.kind.startsWith("workspace_")) {
            if (!this.workspace) throw Error("COMPUTER_WORKSPACE_UNAVAILABLE");
            response = await this.workspace.execute(action, {
              context: state.grant,
              workspaceId: state.workspace?.id,
              signal: state.controller.signal
            });
          } else response = await this.driver.execute(action, observation, state.controller.signal);
          this.driver.recordResult?.(action, response);
          if (this.executionMode === "work") state.journal?.plan(this.driver.checkpoint());
          state.journal?.mark(step + 1, "requested");
          pendingObservation = step + 1;
          previousResult = JSON.stringify(response).slice(0, 16000);
        } catch (error) {
          const knownWorkspaceRejection = [
            "WORKSPACE_VERSION_CONFLICT",
            "WORKSPACE_ALREADY_EXISTS",
            "WORKSPACE_NOT_FOUND",
            "WORKSPACE_NOT_A_FILE",
            "WORKSPACE_NOT_A_DIRECTORY",
            "WORKSPACE_FILE_TOO_LARGE",
            "WORKSPACE_BINARY_FILE",
            "WORKSPACE_PROTECTED_PATH",
            "WORKSPACE_PATH_TRAVERSAL",
            "WORKSPACE_SYMLINK_REJECTED"
          ].includes(error?.code);
          if (
            !knownWorkspaceRejection &&
            ![
              "COMPUTER_WINDOW_CHANGED",
              "COMPUTER_OBSERVATION_STALE",
              "COMPUTER_USER_INPUT_ACTIVE",
              "COMPUTER_TARGET_OCCLUDED",
              "BROWSER_STALE",
              "BROWSER_ELEMENT_UNAVAILABLE",
              "BROWSER_TAB_LIMIT"
            ].includes(error?.message)
          )
            throw error;
          state.journal?.mark(step + 1, "not_executed");
          previousResult = JSON.stringify({
            not_executed: true,
            reason: knownWorkspaceRejection ? error.code : error.message,
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
        this.workspace?.endSession?.();
      } catch {
        cleanupFailed = true;
        this.poisoned = true;
      }
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
        release?.();
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
    this.workspace?.cancel();
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
