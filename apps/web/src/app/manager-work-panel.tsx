"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { executionGateLabels, useExecutionGate } from "./use-execution-gate";

type WorkStage = "plan" | "draft" | "review" | "publish" | "done";
type Work = {
  id: string;
  request?: {
    goal: string;
    worker_role?: "analyst" | "architect";
    max_model_requests?: number;
    max_input_tokens?: number;
    max_output_tokens?: number;
  };
  version: number;
  status: string;
  stage: WorkStage;
  pause_requested: boolean;
  model_requests: number;
  error_code: string | null;
  confirmation_id: string | null;
  plan: {
    summary: string;
    instructions: string;
    complexity: string;
    needs_critic: boolean;
    requires_external_actions?: boolean;
  } | null;
  draft: { files: { name: string; content: string }[] } | null;
  review: { verdict: string; reason: string } | null;
  events: { sequence: number; stage?: WorkStage; message: string; at: string }[];
  created_at?: string;
  updated_at?: string;
};
const isActive = (item: Work) => !["completed", "failed", "cancelled"].includes(item.status);
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
const stages: { id: WorkStage; label: string; description: string }[] = [
  { id: "plan", label: "План", description: "Manager формирует способ выполнения" },
  { id: "draft", label: "Черновик", description: "Исполнитель создаёт результат" },
  { id: "review", label: "Проверка", description: "Результат проходит контроль" },
  { id: "publish", label: "Подготовка", description: "Файлы готовятся к выдаче" },
  { id: "done", label: "Готово", description: "Результат доступен в проекте" }
];
const stageLabels = Object.fromEntries(stages.map((stage) => [stage.id, stage.label])) as Record<
  WorkStage,
  string
>;
const roleLabels: Record<string, string> = {
  analyst: "Аналитик",
  architect: "Архитектор"
};
const stageState = (item: Work, stage: WorkStage) => {
  const currentIndex = stages.findIndex((candidate) => candidate.id === item.stage);
  const stageIndex = stages.findIndex((candidate) => candidate.id === stage);
  if (item.status === "completed") return "done";
  if (stageIndex < currentIndex) return "done";
  if (stageIndex > currentIndex) return "pending";
  if (item.status === "failed" || item.status === "cancelled") return "failed";
  if (item.status === "blocked" || item.status === "awaiting_approval" || item.status === "paused")
    return "attention";
  return "current";
};
const eventTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
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
  EMERGENCY_STOP: "Работа прервана аварийной остановкой. Проверьте состояние в Центре управления.",
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
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [runtime, setRuntime] = useState<{ mode: string; model: string } | null>(null);
  const executionGate = useExecutionGate(projectId);
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
          const latest = selectedWorkId
            ? (list.items.find((item) => item.id === selectedWorkId) ?? list.items[0] ?? null)
            : (list.items[0] ?? null);
          if (selectedWorkId && !list.items.some((item) => item.id === selectedWorkId))
            setSelectedWorkId(null);
          setWorks((current) =>
            list.items.map((item) => {
              const previous = current.find((candidate) => candidate.id === item.id);
              return previous && previous.version > item.version ? previous : item;
            })
          );
          setWork((previous) =>
            previous && latest && previous.id === latest.id && previous.version > latest.version
              ? previous
              : latest
          );
          setRuntime(model);
          setHistoryLoaded(true);
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
  }, [base, selectedWorkId]);
  const act = async (action?: "pause" | "resume" | "approve" | "cancel") => {
    if ((!action || action === "resume" || action === "approve") && executionGate !== "clear")
      return;
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
      const updated = await json<Work>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      setSelectedWorkId(updated.id);
      setSelectedFileName(null);
      setWork(updated);
      setWorks((current) =>
        current.some((item) => item.id === updated.id)
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : [updated, ...current].slice(0, 30)
      );
      if (!action) pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const active = work && isActive(work);
  const projectHasActiveWork = Boolean(active) || works.some(isActive);
  const selectedFile =
    work?.draft?.files.find((file) => file.name === selectedFileName) ??
    work?.draft?.files[0] ??
    null;
  const selectedFileHref =
    work && selectedFile
      ? base +
        "/" +
        encodeURIComponent(work.id) +
        "/files/" +
        encodeURIComponent(selectedFile.name)
      : null;
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
      {executionGate !== "clear" && (
        <p className="manager-work-boundary" data-testid="manager-execution-gate">
          {executionGateLabels[executionGate]} Сохранённые результаты остаются доступны.{" "}
          <Link href={"/control-center?project=" + encodeURIComponent(projectId)}>
            Центр управления
          </Link>
        </p>
      )}
      <label className="manager-work-field">
        Задача
        <textarea
          aria-label="Задача для выполнения"
          value={goal}
          maxLength={8000}
          rows={4}
          onChange={(e) => setGoal(e.target.value)}
          disabled={projectHasActiveWork || busy || !historyLoaded}
        />
      </label>
      <label className="manager-work-field">
        Исполнитель{" "}
        <select
          aria-label="Исполнитель задачи"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={projectHasActiveWork || busy || !historyLoaded}
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
        disabled={
          busy ||
          projectHasActiveWork ||
          !goal.trim() ||
          !runtime ||
          !historyLoaded ||
          executionGate !== "clear"
        }
        onClick={() => void act()}
      >
        Создать файлы
      </button>
      {!historyLoaded && <p className="manager-work-usage">Загружаем задачи проекта…</p>}
      {error && <p role="alert">{error}</p>}
      {works.length > 0 && (
        <div className="manager-work-history">
          <strong>Задачи проекта</strong>
          <div
            className="manager-work-history-list"
            role="group"
            aria-label="История задач Manager"
          >
            {works.map((item, index) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={item.id === (selectedWorkId ?? works[0]?.id)}
                onClick={() => {
                  setSelectedWorkId(item.id);
                  setSelectedFileName(null);
                  setWork(item);
                  setError("");
                }}
              >
                <span>{item.request?.goal ?? `Задача ${index + 1}`}</span>
                <small>
                  {labels[item.status] ?? "Состояние неизвестно"} ·{" "}
                  {stageLabels[item.stage] ?? "Этап неизвестен"}
                </small>
              </button>
            ))}
          </div>
          {projectHasActiveWork && !active && (
            <p>Другая задача ещё выполняется. Откройте её в списке, чтобы увидеть шаги.</p>
          )}
        </div>
      )}
      {work && (
        <>
          <div className="manager-work-overview" aria-label="Состояние выполнения Manager">
            <div>
              <small>Текущий этап</small>
              <strong>{stageLabels[work.stage] ?? "Неизвестно"}</strong>
            </div>
            <div>
              <small>Исполнитель</small>
              <strong>
                {work.request?.worker_role
                  ? (roleLabels[work.request.worker_role] ?? work.request.worker_role)
                  : "Не указан"}
              </strong>
            </div>
            <div>
              <small>Запросы модели</small>
              <strong>
                {work.model_requests} / {work.request?.max_model_requests ?? 3}
              </strong>
            </div>
          </div>
          <ol className="manager-work-phases" aria-label="Этапы задачи Manager">
            {stages.map((stage, index) => {
              const state = stageState(work, stage.id);
              return (
                <li
                  key={stage.id}
                  data-state={state}
                  aria-current={state === "current" || state === "attention" ? "step" : undefined}
                >
                  <span className="manager-work-phase-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="manager-work-phase-copy">
                    <strong>{stage.label}</strong>
                    <small>{stage.description}</small>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="manager-work-usage">
            Обращений к модели: {work.model_requests} / {work.request?.max_model_requests ?? 3}
          </p>
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
          <ol
            className="manager-work-events"
            aria-label="Шаги выполнения"
            aria-live="polite"
            aria-relevant="additions"
          >
            {work.events.map((e) => {
              const time = eventTime(e.at);
              return (
                <li key={e.sequence}>
                  <span className="manager-work-event-copy">
                    <small>
                      {e.stage ? (stageLabels[e.stage] ?? "Событие") : "Событие"}
                      {time ? " · " + time : ""}
                    </small>
                    <span>{e.message}</span>
                  </span>
                </li>
              );
            })}
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
              disabled={busy || executionGate !== "clear"}
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
              disabled={busy || executionGate !== "clear"}
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
          {work.status === "completed" && work.draft?.files.length ? (
            <section className="manager-work-results" aria-label="Результаты задачи Manager">
              <header>
                <div>
                  <small>Результат</small>
                  <strong>
                    {work.draft.files.length}{" "}
                    {work.draft.files.length === 1 ? "файл" : "файла"}
                  </strong>
                </div>
                <span>Текстовый предпросмотр · без выполнения кода</span>
              </header>
              <div className="manager-work-result-layout">
                <div
                  className="manager-work-result-tabs"
                  role="tablist"
                  aria-label="Файлы результата"
                >
                  {work.draft.files.map((file) => (
                    <button
                      type="button"
                      role="tab"
                      key={file.name}
                      aria-selected={file.name === selectedFile?.name}
                      onClick={() => setSelectedFileName(file.name)}
                    >
                      <span>{file.name}</span>
                      <small>{file.content.length.toLocaleString("ru-RU")} симв.</small>
                    </button>
                  ))}
                </div>
                {selectedFile && selectedFileHref && (
                  <div
                    className="manager-work-result-preview"
                    role="tabpanel"
                    aria-label={"Предпросмотр " + selectedFile.name}
                  >
                    <div className="manager-work-result-preview-head">
                      <div>
                        <strong>{selectedFile.name}</strong>
                        <small>
                          {selectedFile.content.length.toLocaleString("ru-RU")} символов
                        </small>
                      </div>
                      <a download href={selectedFileHref}>
                        {selectedFile.name}
                      </a>
                    </div>
                    <pre>{selectedFile.content}</pre>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
