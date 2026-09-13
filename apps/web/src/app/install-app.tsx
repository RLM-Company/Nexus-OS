"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    setIos(isIosDevice());
    setStandalone(isStandaloneDisplay());

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
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

  if (standalone || (!installPrompt && !ios)) return null;

  const install = async (): Promise<void> => {
    if (!installPrompt) {
      setShowIosHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  return (
    <div className="app-install-control">
      <button
        type="button"
        className="app-install-button"
        aria-label="Установить Cosmora"
        onClick={() => void install()}
      >
        <InstallIcon />
        <span>Установить</span>
      </button>

      {showIosHelp && (
        <div className="install-dialog-layer">
          <button
            type="button"
            className="install-dialog-backdrop"
            aria-label="Закрыть подсказку"
            onClick={() => setShowIosHelp(false)}
          />
          <section
            className="install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
          >
            <span className="brand-mark" aria-hidden="true">
              C
            </span>
            <div>
              <h2 id="install-title">Добавить Cosmora на экран «Домой»</h2>
              <p>В Safari нажмите «Поделиться», затем выберите «На экран Домой».</p>
            </div>
            <button type="button" onClick={() => setShowIosHelp(false)}>
              Понятно
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
