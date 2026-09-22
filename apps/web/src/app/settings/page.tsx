"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  minGapMinutes: number;
  suppressWhenActive: boolean;
  backoffAfterUnanswered: number;
  allowPush: boolean;
  allowTelegram: boolean;
  tone: Tone;
  verbosity: Verbosity;
  initiative: Initiative;
  naturalCommunicationGuardrail: boolean;
  avoidCannedFraming: boolean;
  preferConcreteExamples: boolean;
  preserveUserRegister: boolean;
  notificationsEnabled: boolean;
};

type SettingsEnvelopeV2 = {
  version: 2;
  companion: {
    enabled: boolean;
    frequency: Frequency;
    max_proactive_per_day: number;
    min_gap_minutes: number;
    quiet_hours: { start: string; end: string; timezone: string };
    suppress_when_active: boolean;
    backoff_after_unanswered: number;
    allow_push: boolean;
    allow_telegram: boolean;
  };
  communication: {
    tone: Tone;
    verbosity: Verbosity;
    initiative: Initiative;
    natural_guardrail_enabled: boolean;
    avoid_canned_framing: boolean;
    prefer_concrete_examples: boolean;
    preserve_user_register: boolean;
  };
  notifications_enabled: boolean;
};

const STORAGE_KEY = "cosmora:settings:v2";
const LEGACY_STORAGE_KEY = "cosmora:settings:v1";
const TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

const DEFAULT_SETTINGS: SettingsState = {
  companionEnabled: false,
  proactiveFrequency: "balanced",
  quietStart: "22:00",
  quietEnd: "08:00",
  maxProactivePerDay: 3,
  minGapMinutes: 120,
  suppressWhenActive: true,
  backoffAfterUnanswered: 3,
  allowPush: false,
  allowTelegram: false,
  tone: "natural",
  verbosity: "balanced",
  initiative: "balanced",
  naturalCommunicationGuardrail: true,
  avoidCannedFraming: true,
  preferConcreteExamples: true,
  preserveUserRegister: true,
  notificationsEnabled: false
};

const PROACTIVE_PREVIEW: Record<Frequency, string> = {
  rare: "Напишу только когда есть понятный повод и новая ценность.",
  balanced: "Если появится уместный повод, могу первой начать короткий разговор.",
  often: "Могу чаще предлагать тему или возвращаться к незавершённому разговору."
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;

const normalizeSettings = (value: unknown): SettingsState => {
  if (!isRecord(value)) return DEFAULT_SETTINGS;

  const isV2 = value.version === 2 && isRecord(value.companion) && isRecord(value.communication);
  const companion = isV2 ? (value.companion as Record<string, unknown>) : value;
  const communication = isV2 ? (value.communication as Record<string, unknown>) : value;

  const frequencyValue = isV2 ? companion.frequency : companion.proactiveFrequency;
  const quietStartValue =
    isV2 && isRecord(companion.quiet_hours) ? companion.quiet_hours.start : companion.quietStart;
  const quietEndValue =
    isV2 && isRecord(companion.quiet_hours) ? companion.quiet_hours.end : companion.quietEnd;
  const toneValue = communication.tone;
  const verbosityValue = communication.verbosity;
  const initiativeValue = communication.initiative;

  return {
    companionEnabled:
      typeof (isV2 ? companion.enabled : companion.companionEnabled) === "boolean"
        ? Boolean(isV2 ? companion.enabled : companion.companionEnabled)
        : DEFAULT_SETTINGS.companionEnabled,
    proactiveFrequency:
      frequencyValue === "rare" || frequencyValue === "balanced" || frequencyValue === "often"
        ? frequencyValue
        : DEFAULT_SETTINGS.proactiveFrequency,
    quietStart:
      typeof quietStartValue === "string" && TIME_PATTERN.test(quietStartValue)
        ? quietStartValue
        : DEFAULT_SETTINGS.quietStart,
    quietEnd:
      typeof quietEndValue === "string" && TIME_PATTERN.test(quietEndValue)
        ? quietEndValue
        : DEFAULT_SETTINGS.quietEnd,
    maxProactivePerDay: boundedInteger(
      isV2 ? companion.max_proactive_per_day : companion.maxProactivePerDay,
      0,
      20,
      DEFAULT_SETTINGS.maxProactivePerDay
    ),
    minGapMinutes: boundedInteger(
      isV2 ? companion.min_gap_minutes : companion.minGapMinutes,
      0,
      1440,
      DEFAULT_SETTINGS.minGapMinutes
    ),
    suppressWhenActive:
      typeof (isV2 ? companion.suppress_when_active : companion.suppressWhenActive) === "boolean"
        ? Boolean(isV2 ? companion.suppress_when_active : companion.suppressWhenActive)
        : DEFAULT_SETTINGS.suppressWhenActive,
    backoffAfterUnanswered: boundedInteger(
      isV2 ? companion.backoff_after_unanswered : companion.backoffAfterUnanswered,
      0,
      10,
      DEFAULT_SETTINGS.backoffAfterUnanswered
    ),
    allowPush:
      typeof (isV2 ? companion.allow_push : companion.allowPush) === "boolean"
        ? Boolean(isV2 ? companion.allow_push : companion.allowPush)
        : DEFAULT_SETTINGS.allowPush,
    allowTelegram:
      typeof (isV2 ? companion.allow_telegram : companion.allowTelegram) === "boolean"
        ? Boolean(isV2 ? companion.allow_telegram : companion.allowTelegram)
        : DEFAULT_SETTINGS.allowTelegram,
    tone:
      toneValue === "natural" ||
      toneValue === "warm" ||
      toneValue === "direct" ||
      toneValue === "professional"
        ? toneValue
        : DEFAULT_SETTINGS.tone,
    verbosity:
      verbosityValue === "short" || verbosityValue === "balanced" || verbosityValue === "detailed"
        ? verbosityValue
        : DEFAULT_SETTINGS.verbosity,
    initiative:
      initiativeValue === "reactive" ||
      initiativeValue === "balanced" ||
      initiativeValue === "proactive"
        ? initiativeValue
        : DEFAULT_SETTINGS.initiative,
    naturalCommunicationGuardrail:
      typeof (isV2
        ? communication.natural_guardrail_enabled
        : communication.naturalCommunicationGuardrail) === "boolean"
        ? Boolean(
            isV2
              ? communication.natural_guardrail_enabled
              : communication.naturalCommunicationGuardrail
          )
        : DEFAULT_SETTINGS.naturalCommunicationGuardrail,
    avoidCannedFraming:
      typeof (isV2 ? communication.avoid_canned_framing : communication.avoidCannedFraming) ===
      "boolean"
        ? Boolean(isV2 ? communication.avoid_canned_framing : communication.avoidCannedFraming)
        : DEFAULT_SETTINGS.avoidCannedFraming,
    preferConcreteExamples:
      typeof (isV2
        ? communication.prefer_concrete_examples
        : communication.preferConcreteExamples) === "boolean"
        ? Boolean(
            isV2 ? communication.prefer_concrete_examples : communication.preferConcreteExamples
          )
        : DEFAULT_SETTINGS.preferConcreteExamples,
    preserveUserRegister:
      typeof (isV2 ? communication.preserve_user_register : communication.preserveUserRegister) ===
      "boolean"
        ? Boolean(isV2 ? communication.preserve_user_register : communication.preserveUserRegister)
        : DEFAULT_SETTINGS.preserveUserRegister,
    notificationsEnabled:
      typeof (isV2 ? value.notifications_enabled : value.notificationsEnabled) === "boolean"
        ? Boolean(isV2 ? value.notifications_enabled : value.notificationsEnabled)
        : DEFAULT_SETTINGS.notificationsEnabled
  };
};

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const toStoredEnvelope = (settings: SettingsState): SettingsEnvelopeV2 => ({
  version: 2,
  companion: {
    enabled: settings.companionEnabled,
    frequency: settings.proactiveFrequency,
    max_proactive_per_day: settings.maxProactivePerDay,
    min_gap_minutes: settings.minGapMinutes,
    quiet_hours: {
      start: settings.quietStart,
      end: settings.quietEnd,
      timezone: browserTimezone()
    },
    suppress_when_active: settings.suppressWhenActive,
    backoff_after_unanswered: settings.backoffAfterUnanswered,
    allow_push: settings.allowPush,
    allow_telegram: settings.allowTelegram
  },
  communication: {
    tone: settings.tone,
    verbosity: settings.verbosity,
    initiative: settings.initiative,
    natural_guardrail_enabled: settings.naturalCommunicationGuardrail,
    avoid_canned_framing: settings.avoidCannedFraming,
    prefer_concrete_examples: settings.preferConcreteExamples,
    preserve_user_register: settings.preserveUserRegister
  },
  notifications_enabled: settings.notificationsEnabled
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [savedNotice, setSavedNotice] = useState("Настройки сохраняются только в этом браузере.");
  const hydrationNoticeRef = useRef<string | null>(null);
  const storageWriteBlockedRef = useRef(false);
  const [preview, setPreview] = useState(PROACTIVE_PREVIEW.balanced);
  const [notificationPermission, setNotificationPermission] = useState<
    "unsupported" | "default" | "granted" | "denied"
  >("unsupported");

  useEffect(() => {
    const announceHydration = (message: string): void => {
      hydrationNoticeRef.current = message;
      setSavedNotice(message);
    };
    const restoreStoredSettings = (stored: string, notice: string): boolean => {
      try {
        setSettings(normalizeSettings(JSON.parse(stored)));
        announceHydration(notice);
        return true;
      } catch {
        return false;
      }
    };

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY);

      if (stored) {
        try {
          const parsedStored: unknown = JSON.parse(stored);
          if (
            isRecord(parsedStored) &&
            typeof parsedStored.version === "number" &&
            parsedStored.version > 2
          ) {
            storageWriteBlockedRef.current = true;
            announceHydration(
              "Настройки созданы более новой версией Cosmora. Автоматическая перезапись отключена."
            );
          } else {
            setSettings(normalizeSettings(parsedStored));
          }
        } catch {
          if (
            !legacyStored ||
            !restoreStoredSettings(
              legacyStored,
              "Текущие настройки повреждены. Восстановлена предыдущая версия."
            )
          ) {
            announceHydration(
              "Не удалось прочитать локальные настройки. Используются безопасные значения."
            );
          }
        }
      } else if (legacyStored) {
        if (!restoreStoredSettings(legacyStored, "Старые настройки безопасно обновлены.")) {
          announceHydration(
            "Не удалось прочитать локальные настройки. Используются безопасные значения."
          );
        }
      }
    } catch {
      announceHydration(
        "Не удалось прочитать локальные настройки. Используются безопасные значения."
      );
    }
    if ("Notification" in window) {
      setNotificationPermission(window.Notification.permission);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || storageWriteBlockedRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStoredEnvelope(settings)));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      if (hydrationNoticeRef.current) {
        hydrationNoticeRef.current = null;
      } else {
        setSavedNotice("Сохранено локально");
      }
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
    storageWriteBlockedRef.current = false;
    setSettings({ ...DEFAULT_SETTINGS });
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
              Настройка уже сохраняется, но реальный scheduler/delivery backend ещё не подключён. Он
              должен проверять согласие, тихие часы, лимиты, отсутствие активного диалога и
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
                step={1}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isInteger(value)) return;
                  update("maxProactivePerDay", Math.max(0, Math.min(20, value)));
                }}
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
