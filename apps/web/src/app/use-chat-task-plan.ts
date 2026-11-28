"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorkDag } from "@cosmora/contracts";
import { projectChatTaskPlan } from "./chat-task-plan";
import { startVisibleReadPolling } from "./visible-read-poller";

const PLAN_SELECTION = "kosmora:work-plan-selection";

export function notifyWorkPlanSelection(): void {
  window.dispatchEvent(new Event(PLAN_SELECTION));
}

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(PLAN_SELECTION, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(PLAN_SELECTION, listener);
  };
}
const search = () => window.location.search;
const initialSearch = () => "";

export function useChatTaskPlan(projectId: string | null, readingInChatView: boolean) {
  const params = new URLSearchParams(useSyncExternalStore(subscribe, search, initialSearch));
  const planId = projectId && params.get("project") === projectId ? params.get("plan") : null;
  const [snapshot, setSnapshot] = useState<WorkDag | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const graph = snapshot?.project_id === projectId && snapshot?.id === planId ? snapshot : null;

  const observe = useCallback((next: WorkDag) => {
    if (next.project_id !== projectRef.current) return;
    setSnapshot((current) =>
      current?.id === next.id && current.version >= next.version ? current : next
    );
  }, []);

  useEffect(() => {
    if (!projectId || !readingInChatView || !planId) return;
    const path = `/api/v1/projects/${encodeURIComponent(projectId)}/work-dags/${encodeURIComponent(planId)}`;
    let active = false;
    return startVisibleReadPolling(
      async (signal) => {
        const response = await fetch(path, {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
        });
        if (signal.aborted) return;
        if ([401, 403, 404, 410].includes(response.status)) {
          setSnapshot((current) => (current?.id === planId ? null : current));
          setUnverified(null);
          active = false;
          return;
        }
        if (!response.ok) throw new Error("PLAN_READ_FAILED");
        const next = (await response.json()) as WorkDag;
        if (signal.aborted) return;
        if (next.id !== planId || next.project_id !== projectId)
          throw new Error("PLAN_READ_MISMATCH");
        observe(next);
        setUnverified(null);
        active =
          !next.archived_at &&
          (["running", "waiting"].includes(next.execution?.status ?? "") ||
            next.nodes.some((node) => node.status === "running"));
      },
      {
        intervalMs: 15000,
        nextIntervalMs: () => (active ? 2000 : 15000),
        onError: () => {
          setUnverified(planId);
          active = true;
        }
      }
    );
  }, [observe, planId, projectId, readingInChatView]);

  return {
    plan: graph && !graph.archived_at ? projectChatTaskPlan(graph, collapsed) : null,
    stale: readingInChatView && unverified !== null && unverified === planId,
    observe,
    setCollapsed
  };
}
