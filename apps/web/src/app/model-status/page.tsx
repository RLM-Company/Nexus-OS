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
  { kind: "loading" } | { kind: "loaded"; runtime: ModelRuntimeStatus } | { kind: "error" };

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
        const response = await fetch("/api/v1/model-runtime", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Model runtime request failed: ${response.status}`);
        const runtime = (await response.json()) as ModelRuntimeStatus;
        if (active) setState({ kind: "loaded", runtime });
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
      state.runtime.mode !== "mock" &&
      state.runtime.credential_configured &&
      !state.runtime.fallback_to_mock;
    return {
      ready,
      title: ready
        ? "Готово к запуску"
        : state.runtime.mode !== "mock" && state.runtime.credential_configured
          ? "Отключите mock fallback"
          : "Модель не подключена",
      description: ready
        ? "Внешний провайдер и credential настроены. Успешный ответ модели пока не проверен."
        : state.runtime.mode === "mock"
          ? "Runtime работает в mock-режиме. Внешняя модель не подключена."
          : !state.runtime.credential_configured
            ? "Провайдер выбран, но credential для запуска внешней модели не настроен."
            : "Перед live smoke установите MODEL_FALLBACK_TO_MOCK=false и перезапустите API."
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
            <p className={styles.lead}>
              Read-only состояние текущего Model Runtime. Секреты здесь не вводятся и не
              отображаются.
            </p>
          </div>
        </header>

        <section className={styles.card} aria-live="polite" data-testid="model-runtime-card">
          {state.kind === "loading" && (
            <div className={styles.loading} data-testid="runtime-loading">
              <span className={styles.loadingDot} aria-hidden="true" />
              Загружаем состояние runtime…
            </div>
          )}

          {state.kind === "error" && (
            <div className={styles.errorState} role="alert">
              <span className={styles.statusIcon} aria-hidden="true">
                !
              </span>
              <div>
                <strong>Не удалось получить состояние runtime</strong>
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
                  <dt>Режим runtime</dt>
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
                  <dt>Credential настроен</dt>
                  <dd data-testid="runtime-credential">
                    <BooleanValue value={state.runtime.credential_configured} />
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Mock fallback разрешён</dt>
                  <dd data-testid="runtime-fallback">
                    <BooleanValue value={state.runtime.fallback_to_mock} />
                  </dd>
                </div>
              </dl>

              {state.runtime.fallback_to_mock && !readiness.ready && (
                <p className={styles.note} data-testid="runtime-fallback-note">
                  Mock fallback доступен как резервный режим, но не считается подключённой внешней
                  моделью.
                </p>
              )}
              {readiness.ready && (
                <p className={styles.note}>
                  Перед первым платным запросом выполните <code>pnpm manager:preflight</code> в
                  локальном проекте. Проверка не вызывает модель.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
