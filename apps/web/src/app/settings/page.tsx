"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./settings.module.css";

type Settings = { enabled: boolean };
type State = "loading" | "ready" | "error";
const STORAGE_KEY = "cosmora:token-economy";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ enabled: false });
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);

  const save = async (next: Settings): Promise<void> => {
    setSaving(true);
    setState("ready");
    try {
      const response = await fetch("/api/v1/settings/token-economy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!response.ok) throw new Error("settings unavailable");
      const stored = (await response.json()) as Settings;
      setSettings(stored);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      setState("error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let active = true;
    let cached: Settings | null = null;
    try {
      cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Settings | null;
      if (cached && typeof cached.enabled === "boolean") setSettings(cached);
      else cached = null;
    } catch {
      // Malformed local preferences never enable the mode.
    }
    void fetch("/api/v1/settings/token-economy", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("settings unavailable");
        return (await response.json()) as Settings;
      })
      .then(async (stored) => {
        // The browser choice is intentionally restored after a local API restart.
        // A malformed cache can never enable the mode because it was discarded above.
        if (cached?.enabled && !stored.enabled) {
          const response = await fetch("/api/v1/settings/token-economy", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(cached)
          });
          if (!response.ok) throw new Error("settings unavailable");
          return (await response.json()) as Settings;
        }
        return stored;
      })
      .then((stored) => {
        if (!active) return;
        setSettings(stored);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.backLink} href="/">
          ← Назад в Cosmora
        </Link>
        <header>
          <p className={styles.eyebrow}>Локальные настройки</p>
          <h1>Экономия токенов</h1>
          <p>
            Настройка действует только для этого владельца и не меняет права, модель, лимиты или
            внешние действия.
          </p>
        </header>
        <section className={styles.card} aria-live="polite">
          <div>
            <h2>Бережный режим</h2>
            <p>
              Ограничивает ответ 360 токенами, выбирает cost-routing и сохраняет только недавний
              контекст в длинном диалоге. Последнее сообщение всегда остаётся целиком.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            className={settings.enabled ? styles.switchOn : styles.switchOff}
            disabled={state === "loading" || saving}
            onClick={() => void save({ enabled: !settings.enabled })}
          >
            {settings.enabled ? "Экономия включена" : "Экономия выключена"}
          </button>
          {state === "error" && (
            <p className={styles.error} role="alert">
              Не удалось сохранить настройку. API недоступен; режим не был включён автоматически.
            </p>
          )}
        </section>
        <section className={styles.skills} aria-label="Skills для экономии">
          <h2>Skills</h2>
          <article>
            <strong>Контекстный компрессор</strong>
            <p>
              Самая сильная экономия: при включённом режиме передаёт в модель только последние
              полные реплики в окне 12&nbsp;KB. История в Cosmora не удаляется.
            </p>
          </article>
          <article>
            <strong>Короткий результат</strong>
            <p>
              Просит начать с ответа и не повторять вводные, чтобы не расходовать output-токены.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
