"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./model-status.module.css";

type ModelRuntimeStatus = {
  mode: string;
  provider: string;
  model: string;
  credential_configured: boolean;
  fallback_to_mock: boolean;
  registry_version: string;
  updated_at: string;
};

type SafeStatusErrorKind =
  | "offline"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "rate-limit"
  | "server"
  | "network"
  | "invalid";

type SafeStatusError = {
  kind: SafeStatusErrorKind;
  title: string;
  message: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; runtime: ModelRuntimeStatus }
  | { kind: "error"; error: SafeStatusError };

const REQUEST_TIMEOUT_MS = 5_000;

const SAFE_ERRORS: Record<SafeStatusErrorKind, SafeStatusError> = {
  offline: {
    kind: "offline",
    title: "Нет соединения",
    message: "Проверьте, что локальные API и web запущены, затем повторите проверку."
  },
  timeout: {
    kind: "timeout",
    title: "API не ответил вовремя",
    message: "Локальный API превысил безопасный таймаут. Повторите проверку после запуска API."
  },
  unauthorized: {
    kind: "unauthorized",
    title: "Требуется авторизация",
    message: "Статус модели не получен. Проверьте локальную конфигурацию доступа и повторите."
  },
  forbidden: {
    kind: "forbidden",
    title: "Доступ запрещён",
    message: "Локальный API отклонил проверку статуса. Внутренние детали ответа скрыты."
  },
  "rate-limit": {
    kind: "rate-limit",
    title: "Слишком много запросов",
    message: "Подождите немного и повторите проверку. Ответ провайдера и служебные заголовки не показываются."
  },
  server: {
    kind: "server",
    title: "Локальный API временно недоступен",
    message: "Сервер вернул ошибку. Внутренние детали скрыты; повторите проверку после восстановления API."
  },
  network: {
    kind: "network",
    title: "Не удалось связаться с API",
    message: "Проверьте локальные процессы API и web, затем повторите проверку."
  },
  invalid: {
    kind: "invalid",
    title: "Получен неожиданный ответ",
    message: "Статус не используется, пока локальный API не вернёт ожидаемый безопасный формат."
  }
};

const isModelRuntimeStatus = (value: unknown): value is ModelRuntimeStatus => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mode === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.model === "string" &&
    typeof candidate.credential_configured === "boolean" &&
    typeof candidate.fallback_to_mock === "boolean" &&
    typeof candidate.registry_version === "string" &&
    typeof candidate.updated_at === "string"
  );
};

const safeErrorForStatus = (status: number): SafeStatusError => {
  if (status === 401) return SAFE_ERRORS.unauthorized;
  if (status === 403) return SAFE_ERRORS.forbidden;
  if (status === 429) return SAFE_ERRORS["rate-limit"];
  if (status >= 500) return SAFE_ERRORS.server;
  return SAFE_ERRORS.invalid;
};

function DetailItem({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className={styles.detailItem}>
      <dt>{label}</dt>
      <dd
        className={
          tone === "positive"
            ? styles.positiveValue
            : tone === "negative"
              ? styles.negativeValue
              : styles.neutralValue
        }
      >
        {value}
      </dd>
    </div>
  );
}

function BooleanValue({
  value,
  positiveWhen = true
}: {
  value: boolean;
  positiveWhen?: boolean;
}) {
  const positive = value === positiveWhen;
  return (
    <span className={positive ? styles.positiveValue : styles.negativeValue}>
      {value ? "Да" : "Нет"}
    </span>
  );
}

export default function ModelStatusPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const loadRuntime = useCallback(async () => {
    if (!navigator.onLine) {
      setState({ kind: "error", error: SAFE_ERRORS.offline });
      return;
    }

    setState({ kind: "loading" });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/v1/model-runtime", {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        setState({ kind: "error", error: safeErrorForStatus(response.status) });
        return;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setState({ kind: "error", error: SAFE_ERRORS.invalid });
        return;
      }

      if (!isModelRuntimeStatus(payload)) {
        setState({ kind: "error", error: SAFE_ERRORS.invalid });
        return;
      }

      setState({ kind: "loaded", runtime: payload });
    } catch {
      const error = controller.signal.aborted
        ? SAFE_ERRORS.timeout
        : navigator.onLine
          ? SAFE_ERRORS.network
          : SAFE_ERRORS.offline;
      setState({ kind: "error", error });
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void loadRuntime();

    const handleOffline = () => setState({ kind: "error", error: SAFE_ERRORS.offline });
    const handleOnline = () => void loadRuntime();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadRuntime]);

  const runtime = state.kind === "loaded" ? state.runtime : null;
  const mockMode = runtime?.mode === "mock";
  const externalMode = Boolean(runtime && !mockMode);
  const credentialConfigured = Boolean(runtime?.credential_configured);
  const fallbackBlocked = runtime ? !runtime.fallback_to_mock : false;
  const liveConfigured = externalMode && credentialConfigured && fallbackBlocked;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>
            ← Назад в Cosmora
          </Link>
          <div>
            <p className={styles.eyebrow}>Local model status</p>
            <h1>Подключение модели</h1>
            <p className={styles.lead}>
              Здесь отображается только безопасный статус локальной конфигурации. Значение
              MODEL_API_KEY, ответы провайдера и служебные заголовки никогда не показываются.
            </p>
          </div>
        </header>

        <section className={styles.card} aria-live="polite">
          {state.kind === "loading" ? (
            <div className={styles.loading} role="status">
              <span className={styles.loadingDot} aria-hidden="true" />
              Проверяю локальный runtime…
            </div>
          ) : state.kind === "error" ? (
            <div className={styles.errorState} role="alert">
              <span className={styles.statusIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>{state.error.title}</strong>
                <p>{state.error.message}</p>
              </div>
            </div>
          ) : mockMode ? (
            <div className={styles.readyState}>
              <span className={styles.statusIcon} aria-hidden="true">
                M
              </span>
              <div>
                <strong>Mock-режим активен</strong>
                <p>Внешняя модель не вызывается. Это безопасный режим для разработки и тестов.</p>
              </div>
            </div>
          ) : !credentialConfigured ? (
            <div className={styles.disconnectedState}>
              <span className={styles.statusIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>Live-провайдер не настроен полностью</strong>
                <p>
                  Runtime выбран, но локальный credential не настроен. Добавьте ключ только
                  локально и перезапустите API.
                </p>
              </div>
            </div>
          ) : !fallbackBlocked ? (
            <div className={styles.unsafeState}>
              <span className={styles.statusIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>Live заблокирован безопасностью</strong>
                <p>
                  Автоматический fallback на mock включён. Для fail-closed live-режима установите
                  MODEL_FALLBACK_TO_MOCK=false и перезапустите API.
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.readyState}>
              <span className={styles.statusIcon} aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Live-провайдер настроен</strong>
                <p>
                  Credential присутствует, выбран внешний runtime, автоматический fallback на mock
                  запрещён. Перед первым live-вызовом выполните локальный preflight.
                </p>
              </div>
            </div>
          )}

          {runtime ? (
            <>
              <dl className={styles.details}>
                <DetailItem label="Режим" value={mockMode ? "Mock" : "Live"} />
                <DetailItem label="Provider" value={runtime.provider} />
                <DetailItem label="Модель" value={runtime.model} />
                <div className={styles.detailItem}>
                  <dt>Credential configured</dt>
                  <dd>
                    <BooleanValue value={runtime.credential_configured} />
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Mock fallback разрешён</dt>
                  <dd>
                    <BooleanValue value={runtime.fallback_to_mock} positiveWhen={false} />
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Fail-closed route</dt>
                  <dd>
                    <BooleanValue value={!runtime.fallback_to_mock} />
                  </dd>
                </div>
                <DetailItem label="Registry version" value={runtime.registry_version} />
                <DetailItem label="Статус обновлён" value={runtime.updated_at} />
              </dl>
              <p className={styles.note}>
                {liveConfigured
                  ? "Статус показывает только конфигурационную готовность. Он не отправляет запрос модели и не подтверждает валидность ключа."
                  : "Проверка статуса не отправляет запрос внешней модели и не раскрывает credential."}
              </p>
            </>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className={styles.actionButton} onClick={() => void loadRuntime()}>
              Проверить снова
            </button>
            <a className={styles.actionLink} href="/live-model-setup.md">
              Локальная инструкция настройки
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
