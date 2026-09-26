"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Work = {
  id: string;
  version: number;
  status: string;
  stage: string;
  pause_requested: boolean;
  model_requests: number;
  error_code: string | null;
  confirmation_id: string | null;
  plan: { summary: string; instructions: string; complexity: string; needs_critic: boolean } | null;
  draft: { files: { name: string; content: string }[] } | null;
  review: { verdict: string; reason: string } | null;
  events: { sequence: number; message: string; at: string }[];
};
const labels: Record<string, string> = {
  queued: "В очереди",
  running: "Выполняется",
  paused: "На паузе",
  awaiting_approval: "Нужно подтверждение плана",
  blocked: "Нужно разрешение",
  completed: "Готово",
  failed: "Остановлено с ошибкой",
  cancelled: "Отменено"
};
const errors: Record<string, string> = {
  INVALID_MODEL_OUTPUT:
    "Модель вернула результат неподходящего формата. Автоматического платного повтора не будет.",
  EXECUTION_BUDGET_EXCEEDED: "Достигнут заданный предел запросов или токенов.",
  PROJECT_TOKEN_LIMIT_EXCEEDED: "Достигнут лимит токенов проекта.",
  PROJECT_COST_LIMIT_EXCEEDED: "Достигнут денежный лимит проекта.",
  PROJECT_USAGE_EVIDENCE_MISSING:
    "Не хватает подтверждённых данных о расходах. Новый запрос не отправлен.",
  CRITIC_REJECTED: "Критик не принял черновик. Файлы не опубликованы.",
  RECOVERY_REQUIRED:
    "Запрос был прерван. Чтобы не списать токены повторно, он не отправлен заново.",
  UNSUPPORTED_ACTION: "План требует недоступных действий. Сейчас поддерживается создание файлов.",
  ROUTE_UNAVAILABLE: "Настроенная модель недоступна для этой роли или задачи.",
  EMERGENCY_STOP: "Работа остановлена защитой проекта.",
  DENIED: "Профиль проекта запрещает сохранение файлов.",
  WAITING_CONFIRMATION: "Подтвердите сохранение в центре управления, затем продолжите работу."
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Состояние уже изменилось. Обновите его и повторите действие."
        : "Не удалось выполнить запрос. Проверьте соединение."
    );
  return response.json() as Promise<T>;
}

export function ManagerWorkPanel({
  projectId,
  initialGoal
}: {
  projectId: string;
  initialGoal: string;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [role, setRole] = useState("analyst");
  const [work, setWork] = useState<Work | null>(null);
  const [runtime, setRuntime] = useState<{ mode: string; model: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mutationEpoch = useRef(0);
  const pending = useRef<{ goal: string; role: string; id: string } | null>(null);
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/work";
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const epoch = mutationEpoch.current;
      try {
        const [list, model] = await Promise.all([
          json<{ items: Work[] }>(base, { signal: controller.signal }),
          json<{ mode: string; model: string }>("/api/v1/model-runtime", {
            signal: controller.signal
          })
        ]);
        if (!controller.signal.aborted && epoch === mutationEpoch.current && !lock.current) {
          const latest = list.items[0] ?? null;
          setWork((previous) =>
            previous && latest && previous.id === latest.id && previous.version > latest.version
              ? previous
              : latest
          );
          setRuntime(model);
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Состояние временно недоступно. Работа сохраняется на сервере.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 750);
      }
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base]);
  const act = async (action?: "pause" | "resume" | "approve" | "cancel") => {
    if (lock.current) return;
    mutationEpoch.current++;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let url = base,
        body: unknown;
      if (action && work) {
        url += "/" + encodeURIComponent(work.id) + "/control";
        body = { version: work.version, action };
      } else {
        if (!pending.current || pending.current.goal !== goal || pending.current.role !== role)
          pending.current = { goal, role, id: crypto.randomUUID() };
        body = {
          client_request_id: pending.current.id,
          goal,
          worker_role: role,
          max_model_requests: 3,
          max_input_tokens: 32000,
          max_output_tokens: 6000
        };
      }
      setWork(
        await json<Work>(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        })
      );
      if (!action) pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const active = work && !["completed", "failed", "cancelled"].includes(work.status);
  return (
    <section className="manager-demo manager-work-panel" aria-label="Выполнение задачи Manager">
      <header className="manager-work-header">
        <div>
          <small className="manager-work-kicker">Выполнение в рамках проекта</small>
          <strong>Создать результат с Manager</strong>
        </div>
        <span className={`manager-work-status ${work?.status ?? "new"}`} role="status">
          {work ? labels[work.status] : "Новая задача"}
        </span>
      </header>
      <p className="manager-work-runtime">
        {runtime?.mode === "mock"
          ? "Демонстрационный режим: модели не вызываются, файлы помечены mock."
          : runtime
            ? "Модель: " + runtime.model
            : "Проверка подключения…"}
      </p>
      <p className="manager-work-boundary">
        Manager → выбранный исполнитель → Критик по риску. Роли используют настроенную модель.
        Результат — файлы для скачивания; запуск кода и публикация пока недоступны.
      </p>
      <label className="manager-work-field">
        Задача
        <textarea
          aria-label="Задача для выполнения"
          value={goal}
          maxLength={8000}
          rows={4}
          onChange={(e) => setGoal(e.target.value)}
          disabled={Boolean(active) || busy}
        />
      </label>
      <label className="manager-work-field">
        Исполнитель{" "}
        <select
          aria-label="Исполнитель задачи"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={Boolean(active) || busy}
        >
          <option value="analyst">Аналитик</option>
          <option value="architect">Архитектор</option>
        </select>
      </label>
      <p className="manager-work-limits">
        Предел на задачу: 3 обращения к модели, 32 000 входных и 6 000 выходных токенов. Повторы
        тоже входят в предел. Автономность наследуется от проекта.
      </p>
      <button
        type="button"
        className="manager-work-submit"
        disabled={busy || Boolean(active) || !goal.trim() || !runtime}
        onClick={() => void act()}
      >
        Создать файлы
      </button>
      {error && <p role="alert">{error}</p>}
      {work && (
        <>
          <p className="manager-work-usage">Обращений к модели: {work.model_requests} / 3</p>
          {work.plan && (
            <div className="manager-work-plan">
              <strong>{work.plan.summary}</strong>
              <p>{work.plan.instructions}</p>
              <p>
                {work.plan.complexity === "complex" ? "Сложная задача" : "Простая задача"} ·{" "}
                {work.plan.needs_critic ? "С проверкой Критика" : "С проверкой структуры файлов"}
              </p>
            </div>
          )}
          <ol className="manager-work-events" aria-label="Шаги выполнения">
            {work.events.map((e) => (
              <li key={e.sequence}>{e.message}</li>
            ))}
          </ol>
          {work.review && (
            <p className={`manager-work-review ${work.review.verdict.toLowerCase()}`}>
              Критик: {work.review.verdict}. {work.review.reason}
            </p>
          )}
          {work.error_code && (
            <p className="manager-work-error" role="alert">
              {errors[work.error_code] ??
                "Работа остановлена. Сохранённые этапы доступны; автоматического повтора нет."}
            </p>
          )}
          {work.status === "awaiting_approval" && (
            <button
              className="manager-work-action primary"
              disabled={busy}
              onClick={() => void act("approve")}
            >
              Подтвердить план
            </button>
          )}
          {["running", "queued"].includes(work.status) && (
            <button
              className="manager-work-action"
              disabled={busy || work.pause_requested}
              onClick={() => void act("pause")}
            >
              {work.pause_requested ? "Ожидается пауза" : "Пауза"}
            </button>
          )}
          {["paused", "blocked"].includes(work.status) && (
            <button
              className="manager-work-action primary"
              disabled={busy}
              onClick={() => void act("resume")}
            >
              Продолжить
            </button>
          )}
          {active && (
            <button
              className="manager-work-action"
              disabled={busy}
              onClick={() => void act("cancel")}
            >
              Остановить задачу
            </button>
          )}
          {work.status === "blocked" && (
            <Link
              className="manager-work-permissions"
              href={"/control-center?project=" + encodeURIComponent(projectId)}
            >
              Разрешения проекта
            </Link>
          )}
          {work.status === "completed" && (
            <ul className="manager-work-files" aria-label="Готовые файлы">
              {work.draft?.files.map((file) => (
                <li key={file.name}>
                  <a
                    download
                    href={
                      base +
                      "/" +
                      encodeURIComponent(work.id) +
                      "/files/" +
                      encodeURIComponent(file.name)
                    }
                  >
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
