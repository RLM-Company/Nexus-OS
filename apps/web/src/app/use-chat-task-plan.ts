"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkDag } from "@cosmora/contracts";
import { projectChatTaskPlan } from "./chat-task-plan";
import { startVisibleReadPolling } from "./visible-read-poller";

/** The Plan view already reads graphs. Only the chat view with a selected
 * graph reads its exact server snapshot; chat streams have no input here. */
export function useChatTaskPlan(projectId: string | null, readingInChatView: boolean) {
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const [snapshot, setSnapshot] = useState<WorkDag | null>(null);
  const [collapsed, setCollapsed] = useState(false);
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

  return {
    plan: graph && !graph.archived_at ? projectChatTaskPlan(graph, collapsed) : null,
    observe,
    setCollapsed
  };
}
