"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CUSTOM_AI_TEMPLATES,
  readCustomAiProfiles,
  writeCustomAiProfiles,
  type CustomAiProfile
} from "../custom-ai-profiles";
import styles from "./settings.module.css";

type Settings = { enabled: boolean };
type State = "loading" | "ready" | "error";
const STORAGE_KEY = "cosmora:token-economy";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ enabled: false });
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<CustomAiProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileInstructions, setProfileInstructions] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);

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
    setProfiles(readCustomAiProfiles());
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

  const chooseTemplate = (name: string, instructions: string): void => {
    setProfileName(name);
    setProfileInstructions(instructions);
    setProfileError(null);
  };

  const saveProfile = (): void => {
    const name = profileName.trim();
    const instructions = profileInstructions.trim();
    if (!name || !instructions) {
      setProfileError("Укажите имя и инструкции для мини‑ИИ.");
      return;
    }
    const next = [
      ...profiles,
      {
        id: crypto.randomUUID(),
        name: name.slice(0, 80),
        instructions: instructions.slice(0, 4_000)
      }
    ];
    writeCustomAiProfiles(next);
    setProfiles(next);
    setProfileName("");
    setProfileInstructions("");
    setProfileError(null);
  };

  const removeProfile = (id: string): void => {
    const next = profiles.filter((profile) => profile.id !== id);
    writeCustomAiProfiles(next);
    setProfiles(next);
  };

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
        <section className={styles.profiles} id="mini-ai" aria-labelledby="mini-ai-title">
          <header>
            <p className={styles.eyebrow}>Персонализация</p>
            <h2 id="mini-ai-title">Мои мини‑ИИ</h2>
            <p>
              Создайте профиль роли и ответа, затем выберите его перед началом нового чата. Он не
              меняет модель, доступы, инструменты или правила безопасности.
            </p>
          </header>
          <div className={styles.templates} aria-label="Шаблоны мини-ИИ">
            {CUSTOM_AI_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => chooseTemplate(template.name, template.instructions)}
              >
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
          <div className={styles.profileForm}>
            <label>
              Имя
              <input
                value={profileName}
                maxLength={80}
                placeholder="Например, Мой редактор"
                onChange={(event) => setProfileName(event.target.value)}
              />
            </label>
            <label>
              Инструкции для стиля ответа
              <textarea
                value={profileInstructions}
                maxLength={4_000}
                placeholder="Как этот мини‑ИИ должен отвечать?"
                onChange={(event) => setProfileInstructions(event.target.value)}
              />
            </label>
            <button type="button" className={styles.saveProfile} onClick={saveProfile}>
              Сохранить мини‑ИИ
            </button>
            {profileError && <p className={styles.error}>{profileError}</p>}
          </div>
          <div className={styles.profileList} aria-live="polite">
            {profiles.length === 0 ? (
              <p>Пока нет сохранённых мини‑ИИ. Начните с шаблона или создайте свой.</p>
            ) : (
              profiles.map((profile) => (
                <article key={profile.id}>
                  <div>
                    <strong>{profile.name}</strong>
                    <p>{profile.instructions}</p>
                  </div>
                  <button type="button" onClick={() => removeProfile(profile.id)}>
                    Удалить
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
