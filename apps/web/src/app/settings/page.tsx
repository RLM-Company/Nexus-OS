"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CUSTOM_AI_TEMPLATES,
  createAssistantProfile,
  customAiProfileFileName,
  deleteAssistantProfile,
  loadAssistantProfiles,
  parseCustomAiProfile,
  readDefaultCustomAiProfileId,
  readCustomAiProfiles,
  serializeCustomAiProfile,
  updateAssistantProfile,
  writeDefaultCustomAiProfileId,
  writeCustomAiProfiles,
  type CustomAiProfile,
  type CustomAiTemplate
} from "../custom-ai-profiles";
import styles from "./settings.module.css";

type Settings = { enabled: boolean };
type State = "loading" | "ready" | "error";
type ProfileStoreMode = "loading" | "server" | "local";
const STORAGE_KEY = "cosmora:token-economy";
const RESPONSE_PREFERENCES_MARKER = "\n\nПараметры ответа (Cosmora):\n";
const TONE_OPTIONS = {
  friendly: "Дружелюбный и поддерживающий тон",
  direct: "Прямой тон без лишних вступлений",
  formal: "Сдержанный деловой тон",
  creative: "Живой творческий тон"
} as const;
const LENGTH_OPTIONS = {
  short: "Короткие ответы",
  balanced: "Умеренно подробные ответы",
  detailed: "Подробные ответы с объяснениями"
} as const;
const FORMAT_OPTIONS = {
  natural: "Естественный формат по ситуации",
  bullets: "Списки для перечислений",
  steps: "Пошаговая структура для задач"
} as const;
const LANGUAGE_OPTIONS = {
  auto: "Отвечай на языке пользователя",
  russian: "Отвечай на русском языке",
  english: "Отвечай на английском языке"
} as const;
const AUDIENCE_OPTIONS = {
  general: "Объясняй ясно без лишнего профессионального жаргона",
  beginner: "Объясняй для новичка и раскрывай незнакомые термины",
  professional: "Пиши для опытного специалиста и не разжёвывай базовые понятия"
} as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ enabled: false });
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<CustomAiProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileInstructions, setProfileInstructions] = useState("");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileStarters, setProfileStarters] = useState<string[]>(["", "", "", ""]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileStoreMode, setProfileStoreMode] = useState<ProfileStoreMode>("loading");
  const [profileReloadNonce, setProfileReloadNonce] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [pendingProfileDeleteId, setPendingProfileDeleteId] = useState<string | null>(null);
  const [profileTone, setProfileTone] = useState<keyof typeof TONE_OPTIONS>("friendly");
  const [profileLength, setProfileLength] = useState<keyof typeof LENGTH_OPTIONS>("balanced");
  const [profileFormat, setProfileFormat] = useState<keyof typeof FORMAT_OPTIONS>("natural");
  const [profileLanguage, setProfileLanguage] = useState<keyof typeof LANGUAGE_OPTIONS>("auto");
  const [profileAudience, setProfileAudience] = useState<keyof typeof AUDIENCE_OPTIONS>("general");
  const profileImportRef = useRef<HTMLInputElement | null>(null);

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
    setProfileStoreMode("loading");
    const cached = readCustomAiProfiles();
    const preferredProfileId = readDefaultCustomAiProfileId();
    setDefaultProfileId(preferredProfileId);
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
        if (preferredProfileId && !stored.some((profile) => profile.id === preferredProfileId)) {
          writeDefaultCustomAiProfileId(null);
          setDefaultProfileId(null);
        }
        setProfileStoreMode("server");
      })
      .catch(() => {
        if (active) setProfileStoreMode("local");
      });
    return () => {
      active = false;
    };
  }, [profileReloadNonce]);

  const chooseTemplate = (template: CustomAiTemplate): void => {
    setProfileName(template.name);
    setProfileInstructions(template.instructions);
    setProfileAvatar(template.avatar ?? "");
    setProfileStarters([...template.starter_prompts, "", "", ""].slice(0, 4));
    setProfileError(null);
    setProfileNotice(null);
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
      avatar: profileAvatar.trim().slice(0, 16) || null,
      starter_prompts: profileStarters.map((prompt) => prompt.trim().slice(0, 160)).filter(Boolean),
      version: current?.version ?? 0,
      created_at: current?.created_at ?? "",
      updated_at: current?.updated_at ?? ""
    };
    setProfileSaving(true);
    setProfileError(null);
    setProfileNotice(null);
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
      setProfileAvatar("");
      setProfileStarters(["", "", "", ""]);
      setEditingProfileId(null);
      setProfileNotice("Мини‑ИИ сохранён.");
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
    setProfileAvatar(profile.avatar ?? "");
    setProfileStarters([...profile.starter_prompts, "", "", "", ""].slice(0, 4));
    setProfileError(null);
    setProfileNotice(null);
    setPendingProfileDeleteId(null);
  };

  const createVariant = (profile: CustomAiProfile): void => {
    setEditingProfileId(null);
    setProfileName(`${profile.name} — вариант`.slice(0, 80));
    setProfileInstructions(profile.instructions);
    setProfileAvatar(profile.avatar ?? "");
    setProfileStarters([...profile.starter_prompts, "", "", "", ""].slice(0, 4));
    setProfileError(null);
    setProfileNotice(null);
    setPendingProfileDeleteId(null);
  };

  const cancelProfileEdit = (): void => {
    setEditingProfileId(null);
    setProfileName("");
    setProfileInstructions("");
    setProfileAvatar("");
    setProfileStarters(["", "", "", ""]);
    setProfileError(null);
    setProfileNotice(null);
    setPendingProfileDeleteId(null);
  };

  const applyResponsePreferences = (): void => {
    const base = profileInstructions.split(RESPONSE_PREFERENCES_MARKER, 1)[0]?.trim() ?? "";
    const preferences = [
      TONE_OPTIONS[profileTone],
      LENGTH_OPTIONS[profileLength],
      FORMAT_OPTIONS[profileFormat],
      LANGUAGE_OPTIONS[profileLanguage],
      AUDIENCE_OPTIONS[profileAudience]
    ];
    setProfileInstructions(
      `${base.slice(0, 3_600)}${RESPONSE_PREFERENCES_MARKER}${preferences.map((item) => `- ${item}`).join("\n")}`.trim()
    );
    setProfileError(null);
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
      if (defaultProfileId === profile.id) {
        writeDefaultCustomAiProfileId(null);
        setDefaultProfileId(null);
      }
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

  const toggleDefaultProfile = (profile: CustomAiProfile): void => {
    const next = defaultProfileId === profile.id ? null : profile.id;
    writeDefaultCustomAiProfileId(next);
    setDefaultProfileId(next);
  };

  const exportProfile = (profile: CustomAiProfile): void => {
    const blob = new Blob([serializeCustomAiProfile(profile)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = customAiProfileFileName(profile.name);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const importProfile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfileError(null);
    setProfileNotice(null);
    try {
      if (file.size > 20_000) throw new Error("Файл мини‑ИИ слишком большой");
      const profile = parseCustomAiProfile(await file.text());
      setEditingProfileId(null);
      setProfileName(profile.name);
      setProfileInstructions(profile.instructions);
      setProfileAvatar(profile.avatar ?? "");
      setProfileStarters([...profile.starter_prompts, "", "", "", ""].slice(0, 4));
      setPendingProfileDeleteId(null);
      setProfileNotice(
        "Профиль загружен как черновик. Проверьте его и нажмите «Сохранить мини‑ИИ»."
      );
    } catch (cause) {
      setProfileError(
        cause instanceof Error ? cause.message : "Не удалось прочитать файл мини‑ИИ."
      );
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
            <div className={styles.profileStoreRow}>
              <p className={styles.profileStoreStatus} role="status">
                {profileStoreMode === "loading"
                  ? "Подключаем библиотеку…"
                  : profileStoreMode === "server"
                    ? "Профили синхронизируются с вашим локальным сервером Cosmora."
                    : "API недоступен: профили временно сохраняются только в этом браузере."}
              </p>
              {profileStoreMode === "local" && (
                <button
                  type="button"
                  className={styles.retryProfiles}
                  disabled={profileSaving}
                  onClick={() => {
                    setProfileError(null);
                    setProfileReloadNonce((current) => current + 1);
                  }}
                >
                  Повторить подключение
                </button>
              )}
            </div>
          </header>
          <div className={styles.templates} aria-label="Шаблоны мини-ИИ">
            {CUSTOM_AI_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                disabled={profileSaving}
                onClick={() => chooseTemplate(template)}
              >
                <strong>
                  {template.avatar} {template.name}
                </strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
          <div className={styles.profileTransfer}>
            <button
              type="button"
              disabled={profileSaving}
              onClick={() => profileImportRef.current?.click()}
            >
              Импортировать профиль
            </button>
            <input
              ref={profileImportRef}
              type="file"
              accept="application/json,.json"
              aria-label="Файл профиля мини‑ИИ"
              onChange={(event) => void importProfile(event)}
            />
            <span>Импорт создаёт только черновик. Экспорт не включает чаты, ключи и доступы.</span>
          </div>
          <div className={styles.profileForm}>
            <h3>{editingProfileId ? "Редактировать мини‑ИИ" : "Создать мини‑ИИ"}</h3>
            <fieldset className={styles.behaviorBuilder}>
              <legend>Характер ответа</legend>
              <label>
                Тон
                <select
                  value={profileTone}
                  onChange={(event) =>
                    setProfileTone(event.target.value as keyof typeof TONE_OPTIONS)
                  }
                >
                  <option value="friendly">Дружелюбный</option>
                  <option value="direct">Прямой</option>
                  <option value="formal">Деловой</option>
                  <option value="creative">Творческий</option>
                </select>
              </label>
              <label>
                Подробность
                <select
                  value={profileLength}
                  onChange={(event) =>
                    setProfileLength(event.target.value as keyof typeof LENGTH_OPTIONS)
                  }
                >
                  <option value="short">Коротко</option>
                  <option value="balanced">Сбалансированно</option>
                  <option value="detailed">Подробно</option>
                </select>
              </label>
              <label>
                Формат
                <select
                  value={profileFormat}
                  onChange={(event) =>
                    setProfileFormat(event.target.value as keyof typeof FORMAT_OPTIONS)
                  }
                >
                  <option value="natural">По ситуации</option>
                  <option value="bullets">Списки</option>
                  <option value="steps">По шагам</option>
                </select>
              </label>
              <label>
                Язык
                <select
                  value={profileLanguage}
                  onChange={(event) =>
                    setProfileLanguage(event.target.value as keyof typeof LANGUAGE_OPTIONS)
                  }
                >
                  <option value="auto">Как у пользователя</option>
                  <option value="russian">Русский</option>
                  <option value="english">English</option>
                </select>
              </label>
              <label>
                Уровень
                <select
                  value={profileAudience}
                  onChange={(event) =>
                    setProfileAudience(event.target.value as keyof typeof AUDIENCE_OPTIONS)
                  }
                >
                  <option value="general">Универсальный</option>
                  <option value="beginner">Для новичка</option>
                  <option value="professional">Для специалиста</option>
                </select>
              </label>
              <button type="button" onClick={applyResponsePreferences}>
                Применить к инструкции
              </button>
            </fieldset>
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
              Значок
              <input
                value={profileAvatar}
                maxLength={16}
                placeholder="Например, ✨"
                aria-describedby="profile-avatar-hint"
                onChange={(event) => setProfileAvatar(event.target.value)}
              />
              <small id="profile-avatar-hint">Эмодзи или короткий символ до 16 знаков.</small>
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
            <fieldset className={styles.starterBuilder}>
              <legend>Стартовые запросы</legend>
              <p>До четырёх кнопок для начала диалога. Нажатие только заполнит поле ввода.</p>
              {profileStarters.map((prompt, index) => (
                <label key={index}>
                  Запрос {index + 1}
                  <input
                    value={prompt}
                    maxLength={160}
                    placeholder={index === 0 ? "Например, помоги составить план" : "Необязательно"}
                    onChange={(event) =>
                      setProfileStarters((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item
                        )
                      )
                    }
                  />
                </label>
              ))}
            </fieldset>
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
            {profileNotice && (
              <p className={styles.profileNotice} role="status">
                {profileNotice}
              </p>
            )}
          </div>
          <div className={styles.profileList} aria-live="polite">
            {profiles.length === 0 ? (
              <p>Пока нет сохранённых мини‑ИИ. Начните с шаблона или создайте свой.</p>
            ) : (
              profiles.map((profile) => (
                <article key={profile.id}>
                  <div>
                    <strong>
                      {profile.avatar ? `${profile.avatar} ` : ""}
                      {profile.name}
                    </strong>
                    {defaultProfileId === profile.id && (
                      <span className={styles.defaultBadge}>Основной на этом устройстве</span>
                    )}
                    <p>{profile.instructions}</p>
                    {profile.starter_prompts.length > 0 && (
                      <ul className={styles.savedStarters} aria-label="Стартовые запросы">
                        {profile.starter_prompts.map((prompt, index) => (
                          <li key={`${index}:${prompt}`}>{prompt}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className={styles.profileActions}>
                    <button
                      type="button"
                      disabled={profileSaving || profileStoreMode === "loading"}
                      aria-pressed={defaultProfileId === profile.id}
                      onClick={() => toggleDefaultProfile(profile)}
                    >
                      {defaultProfileId === profile.id
                        ? "Не использовать основным"
                        : "Сделать основным"}
                    </button>
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
                      onClick={() => exportProfile(profile)}
                    >
                      Экспортировать
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
