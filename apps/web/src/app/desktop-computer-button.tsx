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
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
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
                setError("Не удалось открыть управление компьютером. Проверьте вход в приложение.");
            })
            .catch(() => setError("Локальное приложение недоступно."))
            .finally(() => setOpening(false));
        }}
      >
        {opening ? "Открываем…" : "Выполнить на компьютере"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
