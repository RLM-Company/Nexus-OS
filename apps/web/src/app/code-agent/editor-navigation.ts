"use client";
import { useCallback, useEffect } from "react";

/** A local edit is not a saved review. Leaving it requires an explicit discard. */
export function useCodeEditorNavigationGuard(dirty: boolean) {
  const confirmDiscard = useCallback(
    () =>
      !dirty ||
      window.confirm(
        "Несохранённые правки будут потеряны. Чтобы сохранить их после перехода, сначала сохраните выбранные изменения. Продолжить переход без сохранения?"
      ),
    [dirty]
  );
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onNavigate = (event: NavigateEvent) => {
      if (
        event.defaultPrevented ||
        event.navigationType !== "traverse" ||
        !event.cancelable ||
        !event.destination.sameDocument
      )
        return;
      const target = new URL(event.destination.url);
      const current = new URL(window.location.href);
      if (target.pathname === current.pathname && target.search === current.search) return;
      if (!confirmDiscard()) event.preventDefault();
    };
    const navigation = "navigation" in window ? window.navigation : undefined;
    window.addEventListener("beforeunload", beforeUnload);
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", onNavigate);
    };
  }, [dirty, confirmDiscard]);
  return confirmDiscard;
}
