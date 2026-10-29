"use client";

import { useEffect, useState } from "react";

type ComputerOpener = { open(input: { project: string; goal: string }): Promise<{ ok: boolean }> };

/** Opens a native consent window; it cannot authorize or execute an OS action. */
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
  if (!bridge) return null;
  return (
    <>
      <button
        type="button"
        className="manager-work-action"
        disabled={disabled || opening || !goal.trim()}
        onClick={() => {
          setOpening(true);
          setError("");
          void bridge
            .open({ project: projectId, goal })
            .then((result) => {
              if (!result.ok)
                setError(
                  work
                    ? "Не удалось открыть задачу Koswork. Проверьте вход в приложение."
                    : "Не удалось открыть управление компьютером. Проверьте вход в приложение."
                );
            })
            .catch(() =>
              setError(
                work
                  ? "Не удалось открыть задачу Koswork. Проверьте вход и остановите текущую задачу, если она ещё выполняется."
                  : "Локальное приложение недоступно."
              )
            )
            .finally(() => setOpening(false));
        }}
      >
        {opening ? "Открываем…" : work ? "Выполнить в Koswork" : "Выполнить на компьютере"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
