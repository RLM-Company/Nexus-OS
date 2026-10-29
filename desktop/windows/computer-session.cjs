"use strict";

const { ComputerSessionGate } = require("./computer-policy.cjs");
const { setTimeout: delay } = require("node:timers/promises");

class ComputerSession {
  constructor({ driver, planner, identity, confirm, notify, now = Date.now }) {
    Object.assign(this, { driver, planner, identity, confirm, notify, now });
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
  async run({ project, goal, maxSteps = 20 }) {
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
    try {
      const context = await this.identity();
      if (!context) throw Error("COMPUTER_OWNER_UNVERIFIED");
      if (this.active !== state || state.controller.signal.aborted)
        throw Error("COMPUTER_SESSION_STOPPED");
      if (
        !(await this.confirm({
          kind: "session",
          origin: context.origin,
          project,
          goal,
          signal: state.controller.signal
        }))
      )
        throw Error("COMPUTER_CANCELLED");
      if (this.active !== state || state.controller.signal.aborted)
        throw Error("COMPUTER_SESSION_STOPPED");
      state.grant = this.gate.enable({ ...context, project, goal });
      await this.assertLive(state);
      state.session = await this.planner.begin({
        project,
        goal,
        maxSteps,
        context: state.grant,
        signal: state.controller.signal
      });
      let previousResult = "";
      let approval = null;
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
        this.notify({ step: step + 1, message: proposal.message, action: action.kind });
        if (action.kind === "done")
          return { status: "completed", summary: action.summary, steps: step + 1 };
        if (action.kind === "ask_user")
          return { status: "needs_user", summary: action.question, steps: step + 1 };
        const approved =
          approval &&
          approval.action === JSON.stringify(action) &&
          approval.window === observation.active_window &&
          this.now() < approval.expires;
        if (proposal.requires_confirmation && !approved) {
          if (
            !(await this.confirm({
              kind: "action",
              action,
              message: proposal.message,
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
        if (this.now() - authorizationStarted >= 10000)
          throw Error("COMPUTER_ACTION_AUTHORIZATION_EXPIRED");
        try {
          previousResult = JSON.stringify(
            await this.driver.execute(action, observation, state.controller.signal)
          ).slice(0, 16000);
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
          previousResult = JSON.stringify({
            not_executed: true,
            reason: error.message,
            instruction:
              "Inspect a fresh observation and replan; never blindly repeat the prior action."
          });
        }
      }
      return {
        status: "step_limit",
        summary: "Достигнут лимит шагов. Проверьте результат перед продолжением.",
        steps: maxSteps
      };
    } finally {
      this.gate.stop();
      state.controller.abort();
      this.driver.stop?.();
      await this.planner.end({ session: state.session, project }).catch(() => {});
      if (this.active === state) this.active = null;
    }
  }
  stop() {
    this.gate.stop();
    this.active?.controller.abort();
    this.driver.stop?.();
  }
}
module.exports = { ComputerSession };
