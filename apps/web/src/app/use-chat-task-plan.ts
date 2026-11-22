"use client";
import { useEffect, useRef, useState } from "react";
import {
  clearChatTaskPlan,
  completeStep,
  createChatTaskPlan,
  failStep,
  readChatTaskPlan,
  recordInterval,
  saveChatTaskPlan,
  startStep,
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
  | { type: "pause" }
  | { type: "await_owner" }
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

      // Close the previous measured interval on a new phase.
      if (interval.current) {
        commit(recordInterval(current, interval.current.kind, interval.current.from, now));
        interval.current = null;
      }
      const active = planRef.current;

      if (detail.type === "run.started") {
        const ready = active?.steps.find(
          (step) =>
            step.status === "pending" &&
            step.depends_on.every(
              (dep) => active.steps.find((s) => s.id === dep)?.status === "completed"
            )
        );
        if (active && ready) {
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
        interval.current = { kind: "tool", from: now };
        return;
      }
      if (detail.type === "pause") {
        interval.current = { kind: "pause", from: now };
        return;
      }
      if (detail.type === "await_owner") {
        interval.current = { kind: "await_owner", from: now };
        return;
      }
      if (!active?.active_step_id) return;
      if (detail.type === "run.completed") commit(completeStep(active, active.active_step_id, now));
      else if (detail.type === "run.failed" || detail.type === "run.cancelled")
        commit(failStep(active, active.active_step_id, now));
    };
    window.addEventListener(CHAT_TASK_PLAN_EVENT, onPlan);
    window.addEventListener(CHAT_TASK_EVENT, onEvent);
    return () => {
      window.removeEventListener(CHAT_TASK_PLAN_EVENT, onPlan);
      window.removeEventListener(CHAT_TASK_EVENT, onEvent);
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
