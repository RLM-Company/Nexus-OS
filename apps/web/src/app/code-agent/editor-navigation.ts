"use client";
import { useCallback, useEffect } from "react";

/** A local edit is not a saved review. Leaving it requires an explicit discard. */
export function useCodeEditorNavigationGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  return useCallback(
    () =>
      !dirty ||
      window.confirm(
        "Несохранённые правки будут потеряны. Чтобы сохранить их после перехода, сначала сохраните выбранные изменения. Продолжить переход без сохранения?"
      ),
    [dirty]
  );
}
