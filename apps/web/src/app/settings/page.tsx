"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./settings.module.css";

type Frequency = "rare" | "balanced" | "often";
type Tone = "natural" | "warm" | "direct" | "professional";
type Verbosity = "short" | "balanced" | "detailed";
type Initiative = "reactive" | "balanced" | "proactive";

type SettingsState = {
  companionEnabled: boolean;
  proactiveFrequency: Frequency;
  quietStart: string;
  quietEnd: string;
  maxProactivePerDay: number;
  tone: Tone;
  verbosity: Verbosity;
  initiative: Initiative;
  naturalCommunicationGuardrail: boolean;
  notificationsEnabled: boolean;
};

const STORAGE_KEY = "cosmora:settings:v1";

const DEFAULT_SETTINGS: SettingsState = {
  companionEnabled: false,
  proactiveFrequency: "balanced",
  quietStart: "22:00",
  quietEnd: "08:00",
  maxProactivePerDay: 3,
  tone: "natural",
  verbosity: "balanced",
  initiative: "balanced",
  naturalCommunicationGuardrail: true,
  notificationsEnabled: false
};

const PROACTIVE_PREVIEW: Record<Frequency, string> = {
  rare: "Напишу только когда есть понятный повод и новая ценность.",
  balanced: "Если появится уместный повод, могу первой начать короткий разговор.",
  often: "Могу чаще предлагать тему или возвращаться к незавершённому разговору."
};

const normalizeSettings = (value: unknown): SettingsState => {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const candidate = value as Partial<SettingsState>;
  return {
    companionEnabled:
      typeof candidate.companionEnabled === "boolean"
        ? candidate.companionEnabled
        : DEFAULT_SETTINGS.companionEnabled,
    proactiveFrequency:
      candidate.proactiveFrequency === "rare" ||
      candidate.proactiveFrequency === "balanced" ||
      candidate.proactiveFrequency === "often"
        ? candidate.proactiveFrequency
        : DEFAULT_SETTINGS.proactiveFrequency,
    quietStart:
      typeof candidate.quietStart === "string" &&
      /^[0-9]{2}:[0-9]{2}$/.test(candidate.quietStart)
        ? candidate.quietStart
        : DEFAULT_SETTINGS.quietStart,
    quietEnd:
      typeof candidate.quietEnd === "string" &&
      /^[0-9]{2}:[0-9]{2}$/.test(candidate.quietEnd)
        ? candidate.quietEnd
        : DEFAULT_SETTINGS.quietEnd,
    maxProactivePerDay:
      typeof candidate.maxProactivePerDay === "number" &&
      Number.isInteger(candidate.maxProactivePerDay) &&
      candidate.maxProactivePerDay >= 0 &&
      candidate.maxProactivePerDay <= 20
        ? candidate.maxProactivePerDay
        : DEFAULT_SETTINGS.maxProactivePerDay,
    tone:
      candidate.tone === "natural" ||
      candidate.tone === "warm" ||
      candidate.tone === "direct" ||
      candidate.tone === "professional"
        ? candidate.tone
        : DEFAULT_SETTINGS.tone,
    verbosity:
      candidate.verbosity === "short" ||
      candidate.verbosity === "balanced" ||
      candidate.verbosity === "detailed"
        ? candidate.verbosity
        : DEFAULT_SETTINGS.verbosity,
    initiative:
      candidate.initiative === "reactive" ||
      candidate.initiative === "balanced" ||
      candidate.initiative === "proactive"
        ? candidate.initiative
        : DEFAULT_SETTINGS.initiative,
    naturalCommunicationGuardrail:
      typeof candidate.naturalCommunicationGuardrail === "boolean"
        ? candidate.naturalCommunicationGuardrail
        : DEFAULT_SETTINGS.naturalCommunicationGuardrail,
    notificationsEnabled:
      typeof candidate.notificationsEnabled === "boolean"
        ? candidate.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled
  };
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [savedNotice, setSavedNotice] = useState("Настройки сохраняются только в этом браузере.");
  const [preview, setPreview] = useState(PROACTIVE_PREVIEW.balanced);
  const [notificationPermission, setNotificationPermission] = useState<
    "unsupported" | "default" | "granted" | "denied"
  >("unsupported");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSettings(normalizeSettings(JSON.parse(stored)));
    } catch {
      setSavedNotice(
        "Не удалось прочитать локальные настройки. Используются безопасные значения."
      );
    }
    if ("Notification" in window) {
      setNotificationPermission(window.Notification.permission);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSavedNotice("Сохранено локально");
    } catch {
      setSavedNotice("Браузер не разрешил сохранить настройки.");
    }
  }, [hydrated, settings]);

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const companionSummary = useMemo(
    () =>
      settings.companionEnabled
        ? `Включено · до ${settings.maxProactivePerDay} сообщений/день · тихие часы ${settings.quietStart}–${settings.quietEnd}`
        : "Выключено · ИИ не инициирует сообщения",
    [settings]
  );

  const requestNotifications = async (): Promise<void> => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      update("notificationsEnabled", permission === "granted");
      setSavedNotice(
        permission === "granted"
          ? "Уведомления разрешены в браузере."
          : "Уведомления не разрешены. Это можно изменить в настройках браузера."
      );
    } catch {
      setSavedNotice("Не удалось запросить разрешение на уведомления.");
    }
  };

  const resetSettings = (): void => {
    setSettings(DEFAULT_SETTINGS);
    setPreview(PROACTIVE_PREVIEW.balanced);
    setSavedNotice("Настройки возвращены к безопасным значениям.");
  };

  return (
    <main className={styles.shell}>
      <div className={styles.topbar}>
        <Link className={styles.back} href="/">
          ← Cosmora
        </Link>
        <span className={styles.status}>{savedNotice}</span>
      </div>

      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Cosmora / Settings</span>
          <h1>Настройки</h1>
          <p>
            Здесь задаётся то, как Cosmora общается, когда она может проявлять инициативу и какие
            способы входа будут доступны после подключения серверной авторизации.
          </p>
        </div>
        <Link className={styles.primary} href="/login">
          Вход и верификация
        </Link>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="account-title">
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Аккаунт</span>
              <h2 id="account-title">Личный профиль</h2>
            </div>
            <span className={styles.badgeMuted}>Локальный alpha</span>
          </div>
          <p className={styles.lead}>
            Сейчас консоль работает в локальном контуре. Реальный Google/Telegram login не подключён
            в этой ветке, поэтому браузер не получает и не хранит OAuth-токены.
          </p>
          <div className={styles.accountRow}>
            <div>
              <strong>Статус</strong>
              <span>Не выполнен вход</span>
            </div>
            <Link className={styles.secondary} href="/login">
              Открыть вход
            </Link>
          </div>
          <div className={styles.accountRow}>
            <div>
              <strong>Верификация</strong>
              <span>Ожидает серверной проверки identity provider</span>
            </div>
            <span className={styles.badgeMuted}>Не подключено</span>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="companion-title">
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Live Companion</span>
              <h2 id="companion-title">ИИ может писать первой</h2>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={settings.companionEnabled}
                onChange={(event) => update("companionEnabled", event.target.checked)}
                aria-label="Разрешить ИИ писать первой"
              />
              <span />
            </label>
          </div>
          <p className={styles.lead}>{companionSummary}</p>
          <div className={styles.notice}>
            <strong>Сейчас это безопасный preview.</strong>
            <span>
              Настройка уже сохраняется, но реальный scheduler/delivery backend ещё не подключён.
              Он должен проверять согласие, тихие часы, лимиты, отсутствие активного диалога и
              emergency-stop до отправки любого proactive-сообщения.
            </span>
          </div>

          <div className={styles.formGrid}>
            <label>
              Частота
              <select
                value={settings.proactiveFrequency}
                onChange={(event) => update("proactiveFrequency", event.target.value as Frequency)}
                disabled={!settings.companionEnabled}
              >
                <option value="rare">Редко</option>
                <option value="balanced">Сбалансированно</option>
                <option value="often">Часто</option>
              </select>
            </label>
            <label>
              Максимум в день
              <input
                type="number"
                min={0}
                max={20}
                value={settings.maxProactivePerDay}
                onChange={(event) =>
                  update(
                    "maxProactivePerDay",
                    Math.max(0, Math.min(20, Number(event.target.value)))
                  )
                }
                disabled={!settings.companionEnabled}
              />
            </label>
            <label>
              Тихие часы с
              <input
                type="time"
                value={settings.quietStart}
                onChange={(event) => update("quietStart", event.target.value)}
                disabled={!settings.companionEnabled}
              />
            </label>
            <label>
              Тихие часы до
              <input
                type="time"
                value={settings.quietEnd}
                onChange={(event) => update("quietEnd", event.target.value)}
                disabled={!settings.companionEnabled}
              />
            </label>
          </div>

          <div className={styles.previewBox} aria-label="Предпросмотр инициативного сообщения">
            <div>
              <span className={styles.previewLabel}>Как это должно ощущаться</span>
              <strong>{preview}</strong>
            </div>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setPreview(PROACTIVE_PREVIEW[settings.proactiveFrequency])}
              disabled={!settings.companionEnabled}
            >
              Проверить preview
            </button>
          </div>

          <div className={styles.rules}>
            <span>✓ Никакой вины за молчание</span>
            <span>✓ Один лимит на все proactive-сообщения</span>
            <span>✓ Тихие часы обязательны</span>
            <span>✓ Активный чат подавляет лишний check-in</span>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="communication-title">
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Communication</span>
              <h2 id="communication-title">Как должна общаться ИИ</h2>
            </div>
            <span className={styles.badge}>Natural v1</span>
          </div>
          <p className={styles.lead}>
            Эти настройки описывают стиль общения. Они не обещают «неопределяемый AI» — цель в
            естественной, конкретной и живой речи без шаблонных AI-манер.
          </p>

          <div className={styles.formGrid}>
            <label>
              Тон
              <select
                value={settings.tone}
                onChange={(event) => update("tone", event.target.value as Tone)}
              >
                <option value="natural">Естественный</option>
                <option value="warm">Тёплый</option>
                <option value="direct">Прямой</option>
                <option value="professional">Профессиональный</option>
              </select>
            </label>
            <label>
              Подробность
              <select
                value={settings.verbosity}
                onChange={(event) => update("verbosity", event.target.value as Verbosity)}
              >
                <option value="short">Кратко</option>
                <option value="balanced">Сбалансированно</option>
                <option value="detailed">Подробно</option>
              </select>
            </label>
            <label>
              Инициативность
              <select
                value={settings.initiative}
                onChange={(event) => update("initiative", event.target.value as Initiative)}
              >
                <option value="reactive">Только по запросу</option>
                <option value="balanced">Сама иногда предлагает</option>
                <option value="proactive">Более инициативная</option>
              </select>
            </label>
          </div>

          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={settings.naturalCommunicationGuardrail}
              onChange={(event) => update("naturalCommunicationGuardrail", event.target.checked)}
            />
            <span>
              <strong>Natural Communication Guardrail</strong>
              <small>
                Меньше формальных шаблонов, повторов и искусственных связок; больше конкретики,
                вариативности длины фраз и нормальной человеческой пунктуации.
              </small>
            </span>
          </label>
        </section>

        <section className={styles.card} aria-labelledby="notifications-title">
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Notifications</span>
              <h2 id="notifications-title">Уведомления</h2>
            </div>
            <span className={styles.badgeMuted}>
              {notificationPermission === "granted"
                ? "Разрешены"
                : notificationPermission === "denied"
                  ? "Заблокированы"
                  : notificationPermission === "unsupported"
                    ? "Не поддерживаются"
                    : "Не запрошены"}
            </span>
          </div>
          <p className={styles.lead}>
            Для настоящих сообщений вне открытого чата понадобится server-side delivery и Web Push.
            Разрешение браузера запрашивается только по вашему нажатию.
          </p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void requestNotifications()}
            disabled={notificationPermission === "unsupported"}
          >
            {notificationPermission === "granted"
              ? "Уведомления разрешены"
              : "Разрешить уведомления"}
          </button>
        </section>

        <section className={styles.card} aria-labelledby="privacy-title">
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.kicker}>Privacy</span>
              <h2 id="privacy-title">Данные и границы</h2>
            </div>
          </div>
          <ul className={styles.list}>
            <li>Настройки этой страницы хранятся только в localStorage текущего браузера.</li>
            <li>OAuth credentials, токены и секреты сюда не записываются.</li>
            <li>
              Реальный companion не должен использовать чувствительный контекст без отдельного
              разрешения.
            </li>
            <li>Любая будущая отправка proactive-сообщения должна быть отменяема до delivery.</li>
          </ul>
          <button type="button" className={styles.danger} onClick={resetSettings}>
            Сбросить настройки
          </button>
        </section>
      </div>
    </main>
  );
}
