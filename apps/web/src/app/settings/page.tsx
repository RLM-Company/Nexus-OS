"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CUSTOM_AI_TEMPLATES,
  createAssistantProfile,
  deleteAssistantProfile,
  loadAssistantProfiles,
  readCustomAiProfiles,
  updateAssistantProfile,
  writeCustomAiProfiles,
  type CustomAiProfile
} from "../custom-ai-profiles";
import styles from "./settings.module.css";

type Settings = { enabled: boolean };
type State = "loading" | "ready" | "error";
type ProfileStoreMode = "loading" | "server" | "local";
const STORAGE_KEY = "cosmora:token-economy";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ enabled: false });
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<CustomAiProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileInstructions, setProfileInstructions] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileStoreMode, setProfileStoreMode] = useState<ProfileStoreMode>("loading");
  const [profileSaving, setProfileSaving] = useState(false);
  const [pendingProfileDeleteId, setPendingProfileDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const cached = readCustomAiProfiles();
    setProfiles(cached);
    void loadAssistantProfiles()
      .then(async (stored) => {
        if (stored.length > 0 || cached.length === 0) return stored;
        const migrated: CustomAiProfile[] = [];
        for (const profile of cached) {
          migrated.push(await createAssistantProfile(profile));
        }
        return migrated;
      })
      .then((stored) => {
        if (!active) return;
        setProfiles(stored);
        writeCustomAiProfiles(stored);
        setProfileStoreMode("server");
      })
      .catch(() => {
        if (active) setProfileStoreMode("local");
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseTemplate = (name: string, instructions: string): void => {
    setProfileName(name);
    setProfileInstructions(instructions);
    setProfileError(null);
    setEditingProfileId(null);
    setPendingProfileDeleteId(null);
  };

  const saveProfile = async (): Promise<void> => {
    const name = profileName.trim();
    const instructions = profileInstructions.trim();
    if (!name || !instructions) {
      setProfileError("Укажите имя и инструкции для мини‑ИИ.");
      return;
    }
    const current = editingProfileId
      ? profiles.find((profile) => profile.id === editingProfileId)
      : null;
    if (editingProfileId && !current) {
      setProfileError("Профиль уже изменён или удалён. Обновите страницу.");
      return;
    }
    const draft = {
      id: editingProfileId ?? crypto.randomUUID(),
      name: name.slice(0, 80),
      instructions: instructions.slice(0, 4_000),
      version: current?.version ?? 0,
      created_at: current?.created_at ?? "",
      updated_at: current?.updated_at ?? ""
    };
    setProfileSaving(true);
    setProfileError(null);
    try {
      const saved =
        profileStoreMode === "server"
          ? editingProfileId
            ? await updateAssistantProfile(draft)
            : await createAssistantProfile(draft)
          : draft;
      const next = [saved, ...profiles.filter((profile) => profile.id !== saved.id)];
      writeCustomAiProfiles(next);
      setProfiles(next);
      setProfileName("");
      setProfileInstructions("");
      setEditingProfileId(null);
    } catch (cause) {
      setProfileError(
        cause instanceof Error ? cause.message : "Не удалось сохранить профиль мини‑ИИ."
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const editProfile = (profile: CustomAiProfile): void => {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileInstructions(profile.instructions);
    setProfileError(null);
    setPendingProfileDeleteId(null);
  };

  const createVariant = (profile: CustomAiProfile): void => {
    setEditingProfileId(null);
    setProfileName(`${profile.name} — вариант`.slice(0, 80));
    setProfileInstructions(profile.instructions);
    setProfileError(null);
    setPendingProfileDeleteId(null);
  };

  const cancelProfileEdit = (): void => {
    setEditingProfileId(null);
    setProfileName("");
    setProfileInstructions("");
    setProfileError(null);
    setPendingProfileDeleteId(null);
  };

  const removeProfile = async (profile: CustomAiProfile): Promise<void> => {
    if (pendingProfileDeleteId !== profile.id) {
      setPendingProfileDeleteId(profile.id);
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      if (profileStoreMode === "server") await deleteAssistantProfile(profile);
      const next = profiles.filter((candidate) => candidate.id !== profile.id);
      writeCustomAiProfiles(next);
      setProfiles(next);
      if (editingProfileId === profile.id) cancelProfileEdit();
      setPendingProfileDeleteId(null);
    } catch (cause) {
      setProfileError(
        cause instanceof Error ? cause.message : "Не удалось удалить профиль мини‑ИИ."
      );
    } finally {
      setProfileSaving(false);
    }
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
            <p className={styles.profileStoreStatus} role="status">
              {profileStoreMode === "loading"
                ? "Подключаем библиотеку…"
                : profileStoreMode === "server"
                  ? "Профили синхронизируются с вашим локальным сервером Cosmora."
                  : "API недоступен: профили временно сохраняются только в этом браузере."}
            </p>
          </header>
          <div className={styles.templates} aria-label="Шаблоны мини-ИИ">
            {CUSTOM_AI_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                disabled={profileSaving}
                onClick={() => chooseTemplate(template.name, template.instructions)}
              >
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
          <div className={styles.profileForm}>
            <h3>{editingProfileId ? "Редактировать мини‑ИИ" : "Создать мини‑ИИ"}</h3>
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
            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.saveProfile}
                disabled={profileSaving || profileStoreMode === "loading"}
                onClick={() => void saveProfile()}
              >
                {editingProfileId ? "Сохранить изменения" : "Сохранить мини‑ИИ"}
              </button>
              {editingProfileId && (
                <button
                  type="button"
                  className={styles.cancelProfile}
                  disabled={profileSaving}
                  onClick={cancelProfileEdit}
                >
                  Отменить
                </button>
              )}
            </div>
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
                  <div className={styles.profileActions}>
                    <button
                      type="button"
                      disabled={profileSaving}
                      onClick={() => editProfile(profile)}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      disabled={profileSaving}
                      onClick={() => createVariant(profile)}
                    >
                      Создать вариант
                    </button>
                    <button
                      type="button"
                      disabled={profileSaving}
                      className={
                        pendingProfileDeleteId === profile.id ? styles.confirmDelete : undefined
                      }
                      onClick={() => void removeProfile(profile)}
                    >
                      {pendingProfileDeleteId === profile.id ? "Подтвердить удаление" : "Удалить"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
