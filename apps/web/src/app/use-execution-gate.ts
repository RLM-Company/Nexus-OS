"use client";

import { useEffect, useState } from "react";

export type ExecutionGate = "checking" | "clear" | "process-stop" | "project-stop" | "unavailable";
export const executionGateLabels: Record<Exclude<ExecutionGate, "clear">, string> = {
  checking: "Проверяем аварийное состояние перед запуском…",
  "process-stop": "Запросы к модели приостановлены для всех проектов.",
  "project-stop": "Запросы к модели остановлены для этого проекта.",
  unavailable: "Не удалось проверить аварийное состояние. Новый запуск пока недоступен."
};

export function useExecutionGate(projectId?: string): ExecutionGate {
  const [state, setState] = useState<{ scope: string | undefined; gate: ExecutionGate }>({
    scope: undefined,
    gate: "checking"
  });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setState({ scope: projectId, gate: "checking" });
    const status = async <T>(path: string): Promise<T> => {
      const response = await fetch(path, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
      });
      if (!response.ok) throw new Error("Execution status is unavailable");
      return response.json() as Promise<T>;
    };
    const refresh = async (): Promise<void> => {
      try {
        const [operations, projectStop] = await Promise.all([
          status<{ process_stop?: { active?: boolean } | null }>("/api/v1/operations/status"),
          projectId
            ? status<{ active?: boolean } | null>(
                "/api/v1/operations/emergency-stop?project_id=" + encodeURIComponent(projectId)
              )
            : Promise.resolve(null)
        ]);
        if (
          !operations ||
          (operations.process_stop !== null &&
            typeof operations.process_stop?.active !== "boolean") ||
          (projectStop !== null && typeof projectStop?.active !== "boolean")
        )
          throw new Error("Execution status is unavailable");
        if (!controller.signal.aborted) {
          setState({
            scope: projectId,
            gate: operations.process_stop?.active
              ? "process-stop"
              : projectStop?.active
                ? "project-stop"
                : "clear"
          });
        }
      } catch {
        if (!controller.signal.aborted) setState({ scope: projectId, gate: "unavailable" });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3_000);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [projectId]);
  return state.scope === projectId ? state.gate : "checking";
}
