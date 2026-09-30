"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./model-status.module.css";

type ModelRuntimeStatus = {
  mode: "mock" | "openai-compatible" | "anthropic-compatible";
  provider: string;
  model: string;
  registry_version: string | null;
  credential_configured: boolean;
  fallback_to_mock: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; runtime: ModelRuntimeStatus; paused: boolean }
  | { kind: "error" };

const MODE_LABELS: Record<ModelRuntimeStatus["mode"], string> = {
  mock: "Mock",
  "openai-compatible": "OpenAI-compatible",
  "anthropic-compatible": "Anthropic-compatible"
};

const BooleanValue = ({ value }: { value: boolean }) => (
  <span className={value ? styles.positiveValue : styles.neutralValue}>{value ? "Да" : "Нет"}</span>
);

export default function ModelStatusPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const options = {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        } as const;
        const [response, operationsResponse] = await Promise.all([
          fetch("/api/v1/model-runtime", options),
          fetch("/api/v1/operations/status", options)
        ]);
        if (!response.ok) throw new Error(`Model runtime request failed: ${response.status}`);
        if (!operationsResponse.ok) {
          throw new Error(`Operations status request failed: ${operationsResponse.status}`);
        }
        const runtime = (await response.json()) as ModelRuntimeStatus;
        const operations = (await operationsResponse.json()) as {
          process_stop?: { active?: boolean } | null;
        } | null;
        if (
          !operations ||
          (operations.process_stop !== null && typeof operations.process_stop?.active !== "boolean")
        ) {
          throw new Error("Operations status is unavailable");
        }
        const paused = operations.process_stop?.active === true;
        if (active) setState({ kind: "loaded", runtime, paused });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Unable to load model runtime status", error);
        if (active) setState({ kind: "error" });
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [retryKey]);

  const readiness = useMemo(() => {
    if (state.kind !== "loaded") return null;
    const ready =
      !state.paused &&
      state.runtime.mode !== "mock" &&
      state.runtime.credential_configured &&
      !state.runtime.fallback_to_mock;
    return {
      ready,
      title: state.paused
        ? "Запросы приостановлены"
        : ready
          ? "Провайдер настроен"
          : state.runtime.mode !== "mock" && state.runtime.credential_configured
            ? "Резервный режим включён"
            : "Модель не подключена",
      description: state.paused
        ? "Выполнение запросов к модели остановлено для всех проектов."
        : ready
          ? "Провайдер и API-ключ настроены. Маршрут и лимиты требуют проверки; успешный ответ модели пока не подтверждён."
          : state.runtime.mode === "mock"
            ? "Используется локальная заглушка. Внешняя модель не подключена."
            : !state.runtime.credential_configured
              ? "Провайдер выбран, но API-ключ для внешней модели не настроен."
              : "Ответ заглушки может заменить ответ внешней модели. Перед живым запуском отключите резервный режим."
    };
  }, [state]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.backLink} href="/">
            ← Назад в Cosmora
          </Link>
          <div>
            <p className={styles.eyebrow}>Model runtime</p>
            <h1>Подключение модели</h1>
            <p className={styles.lead}>Подключение провайдера и состояние запросов к модели.</p>
          </div>
        </header>

        <section className={styles.card} aria-live="polite" data-testid="model-runtime-card">
          {state.kind === "loading" && (
            <div className={styles.loading} data-testid="runtime-loading">
              <span className={styles.loadingDot} aria-hidden="true" />
              Загружаем состояние модели…
            </div>
          )}

          {state.kind === "error" && (
            <div className={styles.errorState} role="alert">
              <span className={styles.statusIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>Не удалось получить состояние модели</strong>
                <p>API временно недоступен. Проверьте подключение и повторите попытку.</p>
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={() => setRetryKey((value) => value + 1)}
                >
                  Повторить
                </button>
              </div>
            </div>
          )}

          {state.kind === "loaded" && readiness && (
            <>
              <div
                className={readiness.ready ? styles.readyState : styles.disconnectedState}
                data-testid="runtime-readiness"
              >
                <span className={styles.statusIcon} aria-hidden="true">
                  {readiness.ready ? "✓" : "○"}
                </span>
                <div>
                  <strong>{readiness.title}</strong>
                  <p>{readiness.description}</p>
                </div>
              </div>

              <dl className={styles.details}>
                <div className={styles.detailItem}>
                  <dt>Режим подключения</dt>
                  <dd data-testid="runtime-mode">{MODE_LABELS[state.runtime.mode]}</dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Провайдер</dt>
                  <dd data-testid="runtime-provider">{state.runtime.provider}</dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Модель</dt>
                  <dd data-testid="runtime-model">{state.runtime.model}</dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>API-ключ настроен</dt>
                  <dd data-testid="runtime-credential">
                    <BooleanValue value={state.runtime.credential_configured} />
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Резервный режим с заглушкой</dt>
                  <dd data-testid="runtime-fallback">
                    <BooleanValue value={state.runtime.fallback_to_mock} />
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Общая остановка запросов</dt>
                  <dd data-testid="runtime-paused">
                    <span className={styles.neutralValue}>{state.paused ? "Да" : "Нет"}</span>
                  </dd>
                </div>
              </dl>

              {state.runtime.fallback_to_mock && !readiness.ready && (
                <p className={styles.note} data-testid="runtime-fallback-note">
                  Резервная заглушка не подтверждает работу внешней модели.
                </p>
              )}
              {readiness.ready && (
                <p className={styles.note}>
                  Перед первым платным запросом проверьте маршрут и лимиты проекта. Наличие
                  API-ключа не подтверждает, что модель уже ответила.
                </p>
              )}
              {state.paused && (
                <p className={styles.note}>
                  <Link href="/control-center">Открыть Центр управления</Link>
                </p>
              )}
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => setRetryKey((value) => value + 1)}
              >
                Обновить состояние
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
