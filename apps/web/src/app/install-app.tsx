"use client";

import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const isIosDevice = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandaloneDisplay = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

function InstallIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" />
    </svg>
  );
}

export function InstallApp() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installPending, setInstallPending] = useState(false);
  const installButtonRef = useRef<HTMLButtonElement | null>(null);
  const installPendingRef = useRef(false);

  useEffect(() => {
    setIos(isIosDevice());
    setStandalone(isStandaloneDisplay());

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallError(null);
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallError(null);
      setInstallPrompt(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const closeIosHelp = (): void => {
    setShowIosHelp(false);
    window.requestAnimationFrame(() => installButtonRef.current?.focus());
  };

  if (standalone || (!installPrompt && !ios)) return null;

  const install = async (): Promise<void> => {
    if (installPendingRef.current) return;

    setInstallError(null);
    if (!installPrompt) {
      setShowIosHelp(true);
      return;
    }

    installPendingRef.current = true;
    setInstallPending(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch {
      setInstallError(
        "Не удалось открыть установку Cosmora. Используйте меню браузера и повторите попытку."
      );
    } finally {
      installPendingRef.current = false;
      setInstallPending(false);
    }
  };

  return (
    <div className="app-install-control">
      <button
        ref={installButtonRef}
        type="button"
        className="app-install-button"
        aria-label="Установить Cosmora"
        disabled={installPending}
        onClick={() => void install()}
      >
        <InstallIcon />
        <span>Установить</span>
      </button>

      {installError && (
        <p className="app-install-error" role="alert">
          {installError}
        </p>
      )}

      {showIosHelp && (
        <div className="install-dialog-layer">
          <button
            type="button"
            className="install-dialog-backdrop"
            aria-label="Закрыть подсказку"
            onClick={closeIosHelp}
          />
          <section
            className="install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeIosHelp();
            }}
          >
            <span className="brand-mark" aria-hidden="true">
              C
            </span>
            <div>
              <h2 id="install-title">Добавить Cosmora на экран «Домой»</h2>
              <p>В Safari нажмите «Поделиться», затем выберите «На экран Домой».</p>
            </div>
            <button type="button" autoFocus onClick={closeIosHelp}>
              Понятно
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
