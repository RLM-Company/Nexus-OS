"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { safeApiErrorMessage } from "../safe-api-error";
import styles from "./control-center.module.css";

type Overview = {
  paused: boolean;
  environmentStop: boolean;
  activeRuns: number;
  projectStops: number;
  routeAttempts: number;
  generatedAt: string;
};
type State =
  { kind: "loading" } | { kind: "loaded"; overview: Overview } | { kind: "error"; message: string };

export default function RuntimeOverview() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = async (): Promise<void> => {
      setState({ kind: "loading" });
      try {
        const response = await fetch("/api/v1/operations/status", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
        });
        if (!response.ok) {
          if (active) setState({ kind: "error", message: safeApiErrorMessage(response.status) });
          return;
        }
        const operations = (await response.json()) as {
          process_stop?: { active?: boolean; activated_by?: string } | null;
          active_runs?: number;
          active_project_stops?: number;
          metrics?: { route_attempts?: number };
          generated_at?: string;
        } | null;
        const counts = [
          operations?.active_runs,
          operations?.active_project_stops,
          operations?.metrics?.route_attempts
        ];
        if (
          !operations ||
          (operations.process_stop !== null &&
            typeof operations.process_stop?.active !== "boolean") ||
          counts.some(
            (value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
          ) ||
          typeof operations.generated_at !== "string" ||
          !Number.isFinite(Date.parse(operations.generated_at))
        ) {
          throw new Error("Не удалось получить общее состояние запросов.");
        }
        if (active) {
          setState({
            kind: "loaded",
            overview: {
              paused: operations.process_stop?.active === true,
              environmentStop: operations.process_stop?.activated_by === "system:environment",
              activeRuns: operations.active_runs as number,
              projectStops: operations.active_project_stops as number,
              routeAttempts: operations.metrics?.route_attempts as number,
              generatedAt: new Date(operations.generated_at).toLocaleString("ru")
            }
          });
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setState({
            kind: "error",
            message: "Не удалось получить общее состояние запросов."
          });
        }
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [refresh]);

  return (
    <section className={styles.operations} aria-labelledby="runtime-overview-title">
      <header>
        <h2 id="runtime-overview-title">Общее состояние запросов</h2>
        <div className={styles.previewActions}>
          <button
            type="button"
            disabled={state.kind === "loading"}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Обновить сводку
          </button>
        </div>
      </header>
      {state.kind === "loading" && <p className={styles.muted}>Загружаем состояние…</p>}
      {state.kind === "error" && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && (
        <>
          <div className={styles.operationGrid}>
            <article data-stop={state.overview.paused ? "active" : "clear"}>
              <span>Общая остановка</span>
              <strong data-testid="overview-process-stop">
                {state.overview.paused ? "Запросы приостановлены" : "Не активна"}
              </strong>
              <small>
                {state.overview.environmentStop
                  ? "Остановка задана настройкой сервера. Возобновление требует её проверки."
                  : "Состояние общей остановки для всех проектов."}
              </small>
            </article>
            <article>
              <span>Активные запуски</span>
              <strong data-testid="overview-active-runs">{state.overview.activeRuns}</strong>
              <small>Запуски владельца</small>
            </article>
            <article>
              <span>Остановленные проекты</span>
              <strong>{state.overview.projectStops}</strong>
              <small>Проекты владельца</small>
            </article>
            <article>
              <span>Попытки запросов</span>
              <strong data-testid="overview-route-attempts">{state.overview.routeAttempts}</strong>
              <small>За текущий запуск API; счётчик обнуляется при перезапуске.</small>
            </article>
          </div>
          <p className={styles.muted}>Снимок: {state.overview.generatedAt}</p>
          <p className={styles.muted}>
            Снятая общая остановка не подтверждает подключение модели или разрешение запросов в
            отдельном проекте. <Link href="/model-status">Подключение модели</Link>
          </p>
        </>
      )}
    </section>
  );
}
