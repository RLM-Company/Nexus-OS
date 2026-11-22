"use client";
import { useEffect, useRef, useState } from "react";
import {
  blockActiveStep,
  clearChatTaskPlan,
  completeStep,
  createChatTaskPlan,
  failStep,
  pauseActiveStep,
  readChatTaskPlan,
  recordInterval,
  resumeActiveStep,
  saveChatTaskPlan,
  startStep,
  unblockActiveStep,
  type ChatTaskPlan,
  type TimingKind
} from "./chat-task-plan";

/** Integration events, same pattern as `kosmora:open-work-plan` /
 * `kosmora:clarification`. The page emits them from its existing SSE handlers;
 * no second state machine or scheduler is introduced. */
export const CHAT_TASK_PLAN_EVENT = "kosmora:chat-task-plan";
export const CHAT_TASK_EVENT = "kosmora:chat-task-event";

export type ChatTaskPlanRequest = {
  id: string;
  goal: string;
  steps: Array<{ id: string; title: string; depends_on?: string[] }>;
};

export function announceChatTaskPlan(scope: string, request: ChatTaskPlanRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_TASK_PLAN_EVENT, { detail: { scope, ...request } }));
}

export type ChatTaskEvent =
  | { type: "run.started" }
  | { type: "message.delta" }
  | { type: "run.completed" }
  | { type: "run.failed" }
  | { type: "run.cancelled" }
  | { type: "queue" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "await_owner" }
  | { type: "permission" }
  | { type: "approval" }
  | { type: "tool" };

export function emitChatTaskEvent(scope: string, event: ChatTaskEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_TASK_EVENT, { detail: { scope, ...event } }));
}

/** Owns the durable plan for the current chat/project. Time is derived only
 * from recorded event timestamps; no wall-clock estimates while a tab is idle. */
export function useChatTaskPlan(scope: string) {
  const [plan, setPlan] = useState<ChatTaskPlan | null>(null);
  const interval = useRef<{ kind: TimingKind; from: number } | null>(null);
  const planRef = useRef<ChatTaskPlan | null>(null);

  const commit = (next: ChatTaskPlan) => {
    planRef.current = next;
    setPlan(next);
    if (typeof window !== "undefined") {
      try {
        saveChatTaskPlan(window.localStorage, next);
      } catch {
        /* In-memory state remains authoritative for this tab. */
      }
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = readChatTaskPlan(window.localStorage, scope);
      const next = stored?.scope === scope ? stored : null;
      planRef.current = next;
      setPlan(next);
    } catch {
      planRef.current = null;
      setPlan(null);
    }
    interval.current = null;
  }, [scope]);

  useEffect(() => {
    const onPlan = (event: Event) => {
      const detail = (event as CustomEvent<ChatTaskPlanRequest & { scope: string }>).detail;
      if (detail?.scope !== scope) return;
      try {
        const existing = readChatTaskPlan(window.localStorage, scope);
        if (existing?.id === detail.id) {
          commit(existing);
          return;
        }
        commit(
          createChatTaskPlan({
            id: detail.id,
            scope,
            goal: detail.goal,
            steps: detail.steps,
            now: Date.now()
          })
        );
      } catch {
        /* A malformed request is ignored, never rendered as a plan. */
      }
    };
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<ChatTaskEvent & { scope: string }>).detail;
      if (detail?.scope !== scope) return;
      const current = planRef.current;
      if (!current) return;
      const now = Date.now();

      // Close the previous measured interval before changing phase. A pause, a
      // permission gate and a queue are distinct kinds and never merge into
      // "model" time merely because the step stays active.
      if (interval.current) {
        commit(recordInterval(current, interval.current.kind, interval.current.from, now));
        interval.current = null;
      }
      let active = planRef.current!;

      if (detail.type === "run.started") {
        // Only a pending, dependency-free step can be admitted. An active step
        // (including paused/blocked) is never restarted or duplicated.
        if (active.active_step_id) return;
        const ready = active.steps.find(
          (step) =>
            step.status === "pending" &&
            step.depends_on.every(
              (dep) => active.steps.find((s) => s.id === dep)?.status === "completed"
            )
        );
        if (ready) {
          commit(startStep(active, ready.id, now));
          interval.current = { kind: "model", from: now };
        }
        return;
      }
      if (detail.type === "message.delta") {
        interval.current = { kind: "model", from: now };
        return;
      }
      if (detail.type === "tool") {
        // Emitted from tool.call when available. With no event the timer stays "—".
        interval.current = { kind: "tool", from: now };
        return;
      }
      if (detail.type === "queue") {
        interval.current = { kind: "queue", from: now };
        return;
      }
      if (detail.type === "pause") {
        active = pauseActiveStep(active);
        commit(active);
        interval.current = { kind: "pause", from: now };
        return;
      }
      if (detail.type === "resume") {
        active = resumeActiveStep(active);
        commit(active);
        interval.current = { kind: "model", from: now };
        return;
      }
      if (detail.type === "await_owner") {
        interval.current = { kind: "await_owner", from: now };
        return;
      }
      if (detail.type === "permission") {
        active = blockActiveStep(active, "awaiting_permission");
        commit(active);
        interval.current = { kind: "await_owner", from: now };
        return;
      }
      if (detail.type === "approval") {
        active = unblockActiveStep(active);
        commit(active);
        interval.current = { kind: "model", from: now };
        return;
      }
      if (!active.active_step_id) return;
      if (detail.type === "run.completed") {
        commit(completeStep(active, active.active_step_id, now));
        // The promoted step starts now; timing for it begins on the next
        // model/tool event, not on an invented interval.
        interval.current = null;
      } else if (detail.type === "run.failed")
        commit(failStep(active, active.active_step_id, now, "failed"));
      else if (detail.type === "run.cancelled")
        commit(failStep(active, active.active_step_id, now, "cancelled"));
    };
    const onClarification = (event: Event) => {
      // A required clarification is an owner gate: open the wait timer as soon
      // as the question is announced, so the elapsed decision time is measured
      // rather than inferred when the answer finally arrives.
      const detail = (event as CustomEvent<{ projectId?: string; required?: boolean }>).detail;
      if (detail?.projectId !== scope || !detail.required) return;
      if (!planRef.current?.active_step_id) return;
      if (interval.current) {
        commit(
          recordInterval(planRef.current, interval.current.kind, interval.current.from, Date.now())
        );
        interval.current = null;
      }
      interval.current = { kind: "await_owner", from: Date.now() };
    };
    window.addEventListener(CHAT_TASK_PLAN_EVENT, onPlan);
    window.addEventListener(CHAT_TASK_EVENT, onEvent);
    window.addEventListener("kosmora:clarification", onClarification);
    return () => {
      window.removeEventListener(CHAT_TASK_PLAN_EVENT, onPlan);
      window.removeEventListener(CHAT_TASK_EVENT, onEvent);
      window.removeEventListener("kosmora:clarification", onClarification);
    };
  }, [scope]);

  const clear = () => {
    if (typeof window !== "undefined") {
      try {
        clearChatTaskPlan(window.localStorage, scope);
      } catch {
        /* Nothing to clear. */
      }
    }
    planRef.current = null;
    setPlan(null);
  };

  return { plan, setPlan: commit, clear };
}
