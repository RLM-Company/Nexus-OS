"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkDag } from "@cosmora/contracts";
import {
  projectChatTaskPlan,
  createChatTaskPlan,
  readChatTaskPlan,
  recordInterval,
  saveChatTaskPlan,
  type ChatTaskPlan,
  type TimingKind
} from "./chat-task-plan";

/** Bridge between durable Work DAGs / chat streams and the plan/timer panel.
 * Events are keyed by a stable scope (project or chat), never by message text. */
export const CHAT_TASK_EVENT = "kosmora:chat-task-event";
export type ChatTaskEvent = { type: TimingKind | "plan" };
const eventTarget = (): EventTarget | null => (typeof window === "undefined" ? null : window);

export function emitChatTaskEvent(scope: string, event: ChatTaskEvent): void {
  const target = eventTarget();
  if (!target) return;
  target.dispatchEvent(new CustomEvent(CHAT_TASK_EVENT, { detail: { scope, ...event } }));
}

/** Announce a real durable DAG as the chat plan, preserving ids and dependencies. */
export function announceChatTaskPlan(
  projectId: string,
  input: {
    id: string;
    goal: string;
    steps: Array<{ id: string; title: string; depends_on: string[] }>;
  }
): void {
  if (typeof window === "undefined") return;
  const plan = createChatTaskPlan({
    id: input.id,
    scope: projectId,
    goal: input.goal,
    steps: input.steps,
    now: Date.now()
  });
  saveChatTaskPlan(window.sessionStorage, plan);
  emitChatTaskEvent(projectId, { type: "plan" });
}
import { startVisibleReadPolling } from "./visible-read-poller";

/** The Plan view already reads graphs. Only the chat view with a selected
 * graph reads its exact server snapshot; chat streams have no input here. */
export function useChatTaskPlan(projectId: string | null, readingInChatView: boolean) {
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const [snapshot, setSnapshot] = useState<WorkDag | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [localPlan, setLocalPlan] = useState<ChatTaskPlan | null>(null);
  const lastEvent = useRef<{ at: number; scope: string } | null>(null);
  const graph = snapshot?.project_id === projectId ? snapshot : null;
  useEffect(() => {
    setSnapshot((current) => (current?.project_id === projectId ? current : null));
  }, [projectId]);
  const observe = useCallback((next: WorkDag) => {
    if (next.project_id !== projectRef.current) return;
    setSnapshot((current) =>
      current?.id === next.id && current.version >= next.version ? current : next
    );
  }, []);

  useEffect(() => {
    if (!projectId || !readingInChatView) return;
    const selectedPlan = () => {
      const params = new URLSearchParams(window.location.search);
      return params.get("project") === projectId ? params.get("plan") : null;
    };
    const planId = selectedPlan();
    if (!planId) return;
    const path =
      "/api/v1/projects/" +
      encodeURIComponent(projectId) +
      "/work-dags/" +
      encodeURIComponent(planId);
    let active = false;
    return startVisibleReadPolling(
      async (signal) => {
        if (selectedPlan() !== planId) return;
        const response = await fetch(path, {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
        });
        if (signal.aborted || selectedPlan() !== planId) return;
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          setSnapshot((current) => (current?.id === planId ? null : current));
          active = false;
          return;
        }
        if (!response.ok) return;
        const next = (await response.json()) as WorkDag;
        if (
          signal.aborted ||
          selectedPlan() !== planId ||
          next.id !== planId ||
          next.project_id !== projectId
        )
          return;
        observe(next);
        active =
          !next.archived_at &&
          (["running", "waiting"].includes(next.execution?.status ?? "") ||
            next.nodes.some((node) => node.status === "running"));
      },
      {
        intervalMs: 15000,
        nextIntervalMs: () => (active ? 2000 : 15000),
        onError: () => {
          active = false;
        }
      }
    );
  }, [observe, projectId, readingInChatView]);

  useEffect(() => {
    const target = eventTarget();
    if (!target || !projectId) return;
    const handler = (raw: Event) => {
      const detail = (raw as CustomEvent<ChatTaskEvent & { scope: string }>).detail;
      if (!detail || detail.scope !== projectId) return;
      if (detail.type === "plan") {
        setLocalPlan(readChatTaskPlan(window.sessionStorage, projectId));
        lastEvent.current = { at: Date.now(), scope: projectId };
        return;
      }
      const kind: TimingKind = detail.type;
      const previous = lastEvent.current;
      const now = Date.now();
      if (previous?.scope === projectId) {
        setLocalPlan((current) =>
          current ? recordInterval(current, kind, previous.at, now) : current
        );
      }
      lastEvent.current = { at: now, scope: projectId };
    };
    target.addEventListener(CHAT_TASK_EVENT, handler);
    setLocalPlan(readChatTaskPlan(window.sessionStorage, projectId));
    return () => target.removeEventListener(CHAT_TASK_EVENT, handler);
  }, [projectId]);

  return {
    plan: graph && !graph.archived_at ? projectChatTaskPlan(graph, collapsed) : localPlan,
    observe,
    setCollapsed
  };
}
