"use client";
import { useEffect, useState } from "react";
import styles from "./profile-onboarding.module.css";
import {
  ONBOARDING_DONE_KEY,
  onboardingPayload,
  shouldShowOnboarding,
  type Gender,
  type OnboardingSettings as Settings
} from "./profile-onboarding-core";

/** First-run onboarding: name + address gender + assistant gender.
 * Appears once for a fresh account; "Пропустить" keeps server defaults
 * (masculine address, neutral assistant) and never shows again. */
export function ProfileOnboarding({ onSaved }: { onSaved: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [userGender, setUserGender] = useState<Gender>("masculine");
  const [assistantGender, setAssistantGender] = useState<Gender>("neutral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let done: string | null = null;
    try {
      done = localStorage.getItem(ONBOARDING_DONE_KEY);
    } catch {
      /* localStorage may be unavailable; still offer onboarding once. */
    }
    if (done === "done") return;
    const controller = new AbortController();
    void fetch("/api/v1/personal-settings", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { settings?: Settings } | null) => {
        const current = data?.settings;
        if (!current || !shouldShowOnboarding(current, done)) return;
        setSettings(current);
        setUserGender(current.user_gender);
        setAssistantGender(current.assistant_gender);
        setOpen(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const markDone = () => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, "done");
    } catch {
      /* Do not block the first dialog if storage is denied. */
    }
    setOpen(false);
  };

  const submit = async () => {
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/personal-settings", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          onboardingPayload(settings, {
            name,
            userGender,
            assistantGender
          })
        )
      });
      if (!response.ok) throw new Error("Не удалось сохранить профиль.");
      onSaved(name.trim());
      markDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить профиль.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-onboarding-title"
      >
        <h2 id="profile-onboarding-title">Давайте познакомимся</h2>
        <p>
          Это настройки первого входа. Имя появится в приветствии, выбор рода — в ответах обычного
          чата и Koswork. Для существующих аккаунтов уже выбраны мужской род обращения и нейтральный
          род ассистента.
        </p>
        <label>
          Как к вам обращаться
          <input
            type="text"
            maxLength={80}
            value={name}
            autoFocus
            aria-label="Ваше имя"
            placeholder="Имя"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </label>
        <label>
          Обращение к вам
          <select
            value={userGender}
            aria-label="Род обращения к вам"
            onChange={(event) => setUserGender(event.target.value as Gender)}
          >
            <option value="masculine">Мужской</option>
            <option value="feminine">Женский</option>
            <option value="neutral">Нейтральный</option>
          </select>
        </label>
        <label>
          Род ассистента
          <select
            value={assistantGender}
            aria-label="Род ассистента"
            onChange={(event) => setAssistantGender(event.target.value as Gender)}
          >
            <option value="neutral">Нейтральный</option>
            <option value="masculine">Мужской</option>
            <option value="feminine">Женский</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={markDone}>
            Пропустить
          </button>
          <button type="button" disabled={busy} onClick={() => void submit()}>
            Сохранить и начать
          </button>
        </div>
      </section>
    </div>
  );
}
