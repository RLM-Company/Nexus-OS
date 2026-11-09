"use client";

import { useEffect, useRef, useState } from "react";

const resultLabels = {
  completed: "Получен результат локальной задачи.",
  failed: "Локальная задача завершилась ошибкой. Подробности — в окне Koswork.",
  cancelled: "Локальная задача отменена.",
  step_limit: "Задаче требуется продолжение в окне Koswork.",
  paused: "Задача приостановлена в окне Koswork.",
  expired: "Ожидание результата истекло. Проверьте окно Koswork.",
  unavailable: "Не удалось передать результат. Проверьте окно Koswork."
} as const;
type LocalResult = { status: keyof typeof resultLabels; summary?: string; planSteps?: number };
type ResultMessage = { request_id: string; project: string; result: LocalResult };
type ComputerOpener = {
  open(input: { project: string; goal: string }): Promise<{ ok: boolean; request_id?: string }>;
  onResult?: (listener: (value: unknown) => void) => () => void;
};
function resultMessage(value: unknown): ResultMessage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>,
    raw = data.result;
  if (
    typeof data.request_id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(data.request_id) ||
    typeof data.project !== "string" ||
    !raw ||
    typeof raw !== "object"
  )
    return null;
  const result = raw as Record<string, unknown>;
  if (
    result.source !== "local_agent_report" ||
    typeof result.status !== "string" ||
    !Object.hasOwn(resultLabels, result.status)
  )
    return null;
  const receipt = result.receipt as Record<string, unknown> | null | undefined;
  const checked = receipt?.checked as Record<string, unknown> | null | undefined;
  const planSteps =
    result.status === "completed" &&
    receipt?.receipt_version === 1 &&
    receipt.kind === "native_work_plan_observed" &&
    receipt.source === "local_agent_report" &&
    receipt.owner_accepted === false &&
    typeof receipt.steps === "number" &&
    Number.isInteger(receipt.steps) &&
    receipt.steps >= 1 &&
    receipt.steps <= 8 &&
    checked?.status === "checked" &&
    checked.count === receipt.steps
      ? receipt.steps
      : undefined;
  return {
    request_id: data.request_id,
    project: data.project,
    result: {
      status: result.status as LocalResult["status"],
      ...(planSteps === undefined ? {} : { planSteps }),
      ...(result.status === "completed" &&
      typeof result.summary === "string" &&
      result.summary.length <= 3000
        ? { summary: result.summary }
        : {})
    }
  };
}
/** Opens native consent; the optional return channel carries no files or device grant. */
export function DesktopComputerButton({
  projectId,
  goal,
  disabled
}: {
  projectId: string;
  goal: string;
  disabled: boolean;
}) {
  const [bridge, setBridge] = useState<ComputerOpener | null>(null);
  const [work, setWork] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<LocalResult | null>(null);
  const version = useRef(0),
    activeRequest = useRef<string | null>(null),
    openingVersion = useRef<number | null>(null);
  const earlyResults = useRef(new Map<string, LocalResult>());
  useEffect(() => {
    const workBridge = (window as Window & { kosmoraDesktopWork?: ComputerOpener })
      .kosmoraDesktopWork;
    if (workBridge && typeof workBridge.open === "function") {
      setBridge(workBridge);
      setWork(true);
      return;
    }
    const candidate = (window as Window & { kosmoraDesktopComputer?: ComputerOpener })
      .kosmoraDesktopComputer;
    if (candidate && typeof candidate.open === "function") setBridge(candidate);
  }, []);
  useEffect(() => {
    version.current++;
    activeRequest.current = null;
    openingVersion.current = null;
    earlyResults.current.clear();
    setOutcome(null);
    if (!bridge?.onResult) return;
    const release = bridge.onResult((value) => {
      const message = resultMessage(value);
      if (!message || message.project !== projectId) return;
      if (activeRequest.current === message.request_id) {
        activeRequest.current = null;
        setOutcome(message.result);
        return;
      }
      if (openingVersion.current === version.current) {
        earlyResults.current.set(message.request_id, message.result);
        if (earlyResults.current.size > 4)
          earlyResults.current.delete(earlyResults.current.keys().next().value!);
      }
    });
    return () => {
      version.current++;
      activeRequest.current = null;
      openingVersion.current = null;
      earlyResults.current.clear();
      release();
    };
  }, [bridge, projectId, goal]);
  if (!bridge) return null;
  return (
    <>
      <button
        type="button"
        className="manager-work-action"
        disabled={disabled || opening || !goal.trim()}
        onClick={() => {
          const requestedVersion = version.current;
          openingVersion.current = requestedVersion;
          activeRequest.current = null;
          earlyResults.current.clear();
          setOutcome(null);
          setOpening(true);
          setError("");
          void bridge
            .open({ project: projectId, goal })
            .then((result) => {
              if (requestedVersion !== version.current) return;
              if (!result.ok)
                setError(
                  work
                    ? "Не удалось открыть задачу Koswork. Проверьте вход в приложение."
                    : "Не удалось открыть управление компьютером. Проверьте вход в приложение."
                );
              else if (bridge.onResult && typeof result.request_id === "string") {
                activeRequest.current = result.request_id;
                const early = earlyResults.current.get(result.request_id);
                if (early) {
                  activeRequest.current = null;
                  setOutcome(early);
                }
              }
            })
            .catch(() => {
              if (requestedVersion === version.current)
                setError(
                  work
                    ? "Не удалось открыть задачу Koswork. Проверьте вход и остановите текущую задачу, если она ещё выполняется."
                    : "Локальное приложение недоступно."
                );
            })
            .finally(() => {
              if (openingVersion.current === requestedVersion) {
                openingVersion.current = null;
                earlyResults.current.clear();
              }
              setOpening(false);
            });
        }}
      >
        {opening ? "Открываем…" : work ? "Выполнить в Koswork" : "Выполнить на компьютере"}
      </button>
      {outcome && (
        <p
          role="status"
          aria-label="Результат локальной задачи"
          style={{ overflowWrap: "anywhere" }}
        >
          {resultLabels[outcome.status]}
          {outcome.summary && <> {outcome.summary}</>}
          {outcome.planSteps && (
            <>
              {" "}
              По отчёту агента: {outcome.planSteps} из {outcome.planSteps} шагов.
            </>
          )}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
