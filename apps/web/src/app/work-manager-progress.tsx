"use client";
import type {
  WorkArtifactVersion,
  WorkCheckpointRecord,
  WorkRuntimeProgress
} from "@cosmora/contracts";
import { useEffect, useState } from "react";
import styles from "./work-manager.module.css";

type Detail = {
  progress: WorkRuntimeProgress;
  checkpoints: WorkCheckpointRecord[];
  artifacts: WorkArtifactVersion[];
  memory: { included: number; omitted: number };
};
const taskLabels: Record<string, string> = {
  pending: "Ожидает этапа",
  ready: "В очереди",
  running: "Выполняется",
  waiting: "Ожидает решения",
  completed: "Готово",
  skipped: "Не требуется",
  failed: "Ошибка",
  cancelled: "Отменено"
};
const stageLabels: Record<string, string> = {
  plan: "План",
  draft: "Создание файлов",
  review: "Проверка",
  publish: "Сохранение",
  done: "Завершено"
};
const workStatusLabels: Record<string, string> = {
  queued: "В очереди",
  running: "Выполняется",
  paused: "На паузе",
  awaiting_approval: "Ожидает подтверждения",
  blocked: "Нужно разрешение",
  completed: "Готово",
  failed: "Ошибка",
  cancelled: "Отменено"
};
const decisions = {
  plan: "Подтвердите план ниже, чтобы начать создание файлов.",
  permission: "Сохранение результата ожидает разрешения проекта.",
  resume: "Сохранён checkpoint. Продолжите работу ниже.",
  recovery:
    "Последний запрос имеет неопределённый результат. Автоматического повтора нет; сохранённые этапы доступны."
};

export function WorkManagerProgress({
  projectId,
  workId,
  version
}: {
  projectId: string;
  workId: string;
  version: number;
}) {
  const [state, setState] = useState<{ key: string; detail: Detail } | null>(null);
  const [error, setError] = useState("");
  const key = projectId + "/" + workId;
  const base = "/api/v1/projects/" + encodeURIComponent(projectId);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(base + "/work/" + encodeURIComponent(workId) + "/runtime", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)])
        });
        if (!response.ok) throw new Error("Состояние этапов временно недоступно");
        const detail = (await response.json()) as Detail;
        if (!controller.signal.aborted) {
          setState({ key, detail });
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Не удалось обновить этапы. Сохранённые данные могут быть устаревшими.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, key, workId, version]);
  const detail = state?.key === key ? state.detail : null;
  return (
    <section className={styles.panel} aria-label="Прогресс Work">
      <h3>План и результат</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!detail ? (
        <p>Загружаем этапы…</p>
      ) : (
        <>
          <p role="status">
            Завершено этапов: {detail.progress.completed} / {detail.progress.total}
          </p>
          <progress
            aria-label="Выполнение этапов"
            value={detail.progress.completed}
            max={detail.progress.total}
          />
          {detail.progress.waiting_decision && <p>{decisions[detail.progress.waiting_decision]}</p>}
          <ol className={styles.tasks} aria-label="Задачи и зависимости">
            {detail.progress.tasks.map((task) => (
              <li key={task.task_id}>
                <div>
                  <strong>{task.title}</strong>
                  {task.depends_on.length > 0 && (
                    <small>
                      После:{" "}
                      {task.depends_on
                        .map(
                          (id) => detail.progress.tasks.find((t) => t.task_id === id)?.title ?? id
                        )
                        .join(", ")}
                    </small>
                  )}
                </div>
                <span>{taskLabels[task.status]}</span>
              </li>
            ))}
          </ol>
          <p className={styles.checkpoint}>
            Память при принятии: {detail.memory.included} записей
            {detail.memory.omitted ? `; не вошло в лимит: ${detail.memory.omitted}` : ""}. Команда
            «Забыть» исключает запись из следующих запросов.
          </p>
          {detail.artifacts.length > 0 && (
            <>
              <strong>Версии результата</strong>
              <ul className={styles.artifacts}>
                {detail.artifacts.map((a) => (
                  <li key={a.id}>
                    {a.published && detail.progress.completed === detail.progress.total ? (
                      <a
                        download
                        href={base + "/work-artifacts/" + encodeURIComponent(a.id) + "/download"}
                      >
                        {a.name} · версия {a.version}
                      </a>
                    ) : (
                      <span>
                        {a.name} · версия {a.version} · черновик
                      </span>
                    )}
                    <small className={styles.checkpoint}>
                      {" "}
                      · {a.bytes} байт · SHA-256 {a.sha256.slice(0, 12)}
                    </small>
                  </li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>Точки сохранения и история восстановления</summary>
            <ul>
              {detail.checkpoints.map((c) => (
                <li key={c.version} className={styles.checkpoint}>
                  Версия {c.version} · {stageLabels[c.stage]} · {workStatusLabels[c.status]} ·{" "}
                  {new Date(c.at).toLocaleString("ru-RU")}
                  {c.inflight_run_id ? " · запрос не завершён" : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
