"use client";
import { PersonalSkillSettings } from "./chat-skill-settings";
import { AcceptedSkillView } from "./accepted-skill-view";
import { CodeFiles } from "./ui/code-files";

import Link from "next/link";
import { WorkManagerDag } from "./work-manager-dag";
import { WorkManagerProgress } from "./work-manager-progress";
import { WorkManagerMemory } from "./work-manager-memory";
import { DesktopComputerButton } from "./desktop-computer-button";
import { useEffect, useRef, useState } from "react";
import { MANAGER_WORK_CONTROL_EVENTS, type CreateManagerWork } from "@cosmora/contracts";
import { startVisibleReadPolling } from "./visible-read-poller";
import { executionGateLabels, useExecutionGate } from "./use-execution-gate";

type Work = {
  id: string;
  request?: { goal: string };
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
  result_accepted_at?: string | null;
  events: { sequence: number; message: string; at: string }[];
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
const errors: Record<string, string> = {
  INVALID_MODEL_OUTPUT:
    "Модель вернула результат неподходящего формата. Автоматического платного повтора не будет.",
  EXECUTION_BUDGET_EXCEEDED: "Достигнут заданный предел запросов или токенов.",
  PROJECT_TOKEN_LIMIT_EXCEEDED: "Достигнут лимит токенов проекта.",
  USAGE_LIMIT_EXCEEDED: "Достигнут личный лимит токенов. Проверьте расходы и лимиты аккаунта.",
  PROJECT_COST_LIMIT_EXCEEDED: "Достигнут денежный лимит проекта.",
  PROJECT_USAGE_EVIDENCE_MISSING:
    "Не хватает подтверждённых данных о расходах. Новый запрос не отправлен.",
  CRITIC_REJECTED: "Критик не принял черновик. Файлы не опубликованы.",
  RECOVERY_REQUIRED:
    "Запрос был прерван. Чтобы не списать токены повторно, он не отправлен заново.",
  GRAPH_UNAVAILABLE:
    "Подключённый граф не вернул допустимый контекст. Запрос к модели не отправлен.",
  INVALID_PRESENTATION_RESULT:
    "Слайды не прошли локальную проверку формата, количества или размера текста. Автоматического платного повтора нет.",
  INVALID_ARTIFACT_CONTENT: "Файл JSON не прошёл проверку формата. Сохранение остановлено.",
  ARTIFACT_INTEGRITY_MISMATCH: "Не удалось подтвердить целостность файлов. Результат не принят.",
  WORK_RESULT_NOT_READY: "Работа ещё не завершена. Принять результат пока нельзя.",
  UNSUPPORTED_ACTION: "План требует недоступных действий. Сейчас поддерживается создание файлов.",
  ROUTE_UNAVAILABLE: "Настроенная модель недоступна для этой роли или задачи.",
  EMERGENCY_STOP: "Работа прервана аварийной остановкой. Проверьте состояние в Центре управления.",
  DENIED: "Профиль проекта запрещает сохранение файлов.",
  WAITING_CONFIRMATION: "Подтвердите сохранение в центре управления, затем продолжите работу."
};

class WorkHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function json<T>(url: string, init?: RequestInit, onMissing?: () => T): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000)
  });
  if (response.status === 404 && onMissing) return onMissing();
  if (!response.ok) {
    let code: unknown;
    try {
      code = ((await response.json()) as { error?: unknown }).error;
    } catch {
      // Only known error codes are shown; arbitrary server text stays private.
    }
    const message =
      typeof code === "string" && Object.hasOwn(errors, code) ? errors[code] : undefined;
    throw new WorkHttpError(
      message ??
        (response.status === 409
          ? "Состояние уже изменилось. Обновите его и повторите действие."
          : "Не удалось выполнить запрос. Проверьте соединение."),
      response.status
    );
  }
  return response.json() as Promise<T>;
}

function readPendingWork(key: string): CreateManagerWork | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw || raw.length > 50_000) return null;
    const draft = JSON.parse(raw) as Partial<CreateManagerWork> | null;
    if (
      !draft ||
      Object.keys(draft).length !== 7 ||
      typeof draft.client_request_id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(draft.client_request_id) ||
      typeof draft.goal !== "string" ||
      !draft.goal.trim() ||
      draft.goal.length > 8000 ||
      (draft.worker_role !== "analyst" && draft.worker_role !== "architect") ||
      typeof draft.require_critic !== "boolean" ||
      draft.max_model_requests !== 3 ||
      typeof draft.max_input_tokens !== "number" ||
      !Number.isInteger(draft.max_input_tokens) ||
      draft.max_input_tokens < 1000 ||
      draft.max_input_tokens > 3_000_000 ||
      typeof draft.max_output_tokens !== "number" ||
      !Number.isInteger(draft.max_output_tokens) ||
      draft.max_output_tokens < 256 ||
      draft.max_output_tokens > 300_000
    )
      return null;
    return draft as CreateManagerWork;
  } catch {
    return null;
  }
}

function readWorkSelection(key: string): string | null {
  try {
    const id = window.sessionStorage.getItem(key);
    return id && /^[a-f0-9-]{36}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function savePendingWork(key: string, request: CreateManagerWork | null) {
  try {
    if (request) window.sessionStorage.setItem(key, JSON.stringify(request));
    else window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory request remains available for a retry in the open panel.
  }
}

function saveWorkSelection(key: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(key, id);
    else window.sessionStorage.removeItem(key);
  } catch {
    // The current selection still works when browser storage is unavailable.
  }
}

export function ManagerWorkPanel({
  projectId,
  initialGoal
}: {
  projectId: string;
  initialGoal: string;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [role, setRole] = useState<CreateManagerWork["worker_role"]>("analyst");
  const [critic, setCritic] = useState(true);
  const [work, setWork] = useState<Work | null>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [runtime, setRuntime] = useState<{
    mode: string;
    model: string;
    context_window_tokens?: number;
    max_output_tokens?: number;
  } | null>(null);
  const executionGate = useExecutionGate(projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const lock = useRef(false);
  const mutationEpoch = useRef(0);
  const pending = useRef<CreateManagerWork | null>(null);
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/work";
  const pendingKey = "kosmora:manager-work-pending:v1:" + projectId;
  const selectionKey = "kosmora:manager-work-selection:v1:" + projectId;
  const draft = pending.current;
  const pendingRequest =
    draft &&
    draft.goal === goal &&
    draft.worker_role === role &&
    Boolean(draft.require_critic) === critic
      ? draft
      : null;
  const taskInputBudget =
    pendingRequest?.max_input_tokens ??
    (runtime?.context_window_tokens
      ? Math.min(3_000_000, runtime.context_window_tokens * 3)
      : 32000);
  const taskOutputBudget =
    pendingRequest?.max_output_tokens ??
    (runtime?.max_output_tokens
      ? Math.max(256, Math.min(300_000, runtime.max_output_tokens * 3))
      : 6000);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readPendingWork(pendingKey);
      if (!saved) return;
      pending.current = saved;
      setGoal(saved.goal);
      setRole(saved.worker_role);
      setCritic(Boolean(saved.require_critic));
      setError("Подтверждение предыдущего запуска потеряно. Повтор отправит тот же запрос.");
    });
    return () => {
      active = false;
    };
  }, [pendingKey]);
  useEffect(() => {
    return startVisibleReadPolling(
      async (signal) => {
        const epoch = mutationEpoch.current;
        const [list, model] = await Promise.all([
          json<{ items: Work[] }>(base, { signal }),
          json<{ mode: string; model: string }>("/api/v1/model-runtime", {
            signal
          })
        ]);
        // History is bounded. Its window moving is not a change of selection.
        const wanted = selectedWorkId ?? readWorkSelection(selectionKey);
        const selected = wanted
          ? (list.items.find((item) => item.id === wanted) ??
            (await json<Work | null>(
              base + "/" + encodeURIComponent(wanted),
              { signal },
              () => null
            )))
          : null;
        if (selected && selected.id !== wanted) throw Error("Unexpected work selection");
        const items =
          selected && !list.items.some((item) => item.id === selected.id)
            ? [...list.items, selected]
            : list.items;
        if (!signal.aborted && epoch === mutationEpoch.current && !lock.current) {
          if (wanted && !selected) saveWorkSelection(selectionKey, null);
          setSelectedWorkId(selected?.id ?? null);
          const latest = selected ?? items[0] ?? null;
          setWorks((current) =>
            items.map((item) => {
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
          setReadError("");
        }
      },
      {
        intervalMs: 750,
        onError: () => setReadError("Состояние временно недоступно. Работа сохраняется на сервере.")
      }
    );
  }, [base, selectedWorkId, selectionKey]);
  const recordMutation = (updated: Work, epoch: number) => {
    setWorks((current) =>
      current.some((item) => item.id === updated.id)
        ? current.map((item) =>
            item.id === updated.id && item.version <= updated.version ? updated : item
          )
        : [updated, ...current].slice(0, 80)
    );
    // A later history selection is the current intent. A late command response
    // updates its own history row without switching the selected task back.
    if (epoch === mutationEpoch.current) {
      saveWorkSelection(selectionKey, updated.id);
      setSelectedWorkId(updated.id);
      setWork((previous) =>
        previous?.id === updated.id && previous.version > updated.version ? previous : updated
      );
    }
  };
  const act = async (action?: keyof typeof MANAGER_WORK_CONTROL_EVENTS) => {
    if ((!action || action === "resume" || action === "approve") && executionGate !== "clear")
      return;
    if (lock.current || (action && !work)) return;
    const controlled = action && work ? work : null;
    const epoch = ++mutationEpoch.current;
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
        if (!pendingRequest)
          pending.current = {
            client_request_id: crypto.randomUUID(),
            goal,
            worker_role: role,
            require_critic: critic,
            max_model_requests: 3,
            max_input_tokens: taskInputBudget,
            max_output_tokens: taskOutputBudget
          };
        body = pendingRequest ?? pending.current;
        savePendingWork(pendingKey, pending.current);
      }
      const updated = await json<Work>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      recordMutation(updated, epoch);
      if (!action) {
        pending.current = null;
        savePendingWork(pendingKey, null);
      }
    } catch (cause) {
      if (action && controlled && !(cause instanceof WorkHttpError && cause.status < 500)) {
        const path = base + "/" + encodeURIComponent(controlled.id);
        const current = await json<Work>(path).catch(() => null);
        const lastSequence = controlled.events.at(-1)?.sequence ?? 0;
        if (
          current?.id === controlled.id &&
          current.version > controlled.version &&
          current.events.some(
            (event) =>
              event.sequence > lastSequence && event.message === MANAGER_WORK_CONTROL_EVENTS[action]
          )
        ) {
          recordMutation(current, epoch);
          return;
        }
        if (epoch === mutationEpoch.current)
          setError("Ответ на команду потерян. Проверьте историю задачи перед повтором.");
        return;
      }
      if (epoch === mutationEpoch.current)
        setError(
          cause instanceof Error && cause.name === "TimeoutError"
            ? "Ответ задерживается. Проверьте задачи проекта: сервер мог уже принять действие."
            : cause instanceof Error
              ? cause.message
              : "Не удалось выполнить действие"
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const acceptResult = async () => {
    if (!work || lock.current || executionGate !== "clear") return;
    const epoch = ++mutationEpoch.current;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const path = base + "/" + encodeURIComponent(work.id);
      let updated: Work;
      try {
        updated = await json<Work>(path + "/result/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version: work.version })
        });
      } catch (cause) {
        // The server may have committed acceptance before the response was lost.
        // Read back the original task once; never send an automatic second POST.
        try {
          const current = await json<Work>(path);
          if (
            current.id !== work.id ||
            current.status !== "completed" ||
            current.stage !== "done" ||
            typeof current.result_accepted_at !== "string" ||
            !Number.isFinite(Date.parse(current.result_accepted_at))
          )
            throw cause;
          updated = current;
        } catch {
          throw cause;
        }
      }
      recordMutation(updated, epoch);
    } catch (cause) {
      if (epoch === mutationEpoch.current)
        setError(cause instanceof Error ? cause.message : "Не удалось принять результат");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const active = work && isActive(work);
  const projectHasActiveWork = Boolean(active) || works.some(isActive);
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
      <details>
        <summary>Skills Work</summary>
        <PersonalSkillSettings
          key={projectId}
          path={`/api/v1/projects/${encodeURIComponent(projectId)}/work-skills`}
          disabled={busy}
          label="Skills Work проекта"
          description="До трёх инструкций для новых задач и планов. Применяется сохранённый выбор. Принятые задачи, шаги сохранённых планов и их повторы используют исходный снимок. Новые версии подключаются явно."
          emptyMessage="Создайте личный Skill, чтобы использовать его в Work."
        />
      </details>
      <label className="manager-work-field">
        Задача
        <textarea
          aria-label="Задача для выполнения"
          value={goal}
          maxLength={8000}
          rows={4}
          onChange={(e) => setGoal(e.target.value)}
          disabled={busy || !historyLoaded}
        />
      </label>
      <label className="manager-work-field">
        Исполнитель{" "}
        <select
          aria-label="Исполнитель задачи"
          value={role}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "analyst" || value === "architect") setRole(value);
          }}
          disabled={busy || !historyLoaded}
        >
          <option value="analyst">Аналитик</option>
          <option value="architect">Архитектор</option>
        </select>
      </label>
      <p className="manager-work-limits">
        Бюджет всех этапов задачи: до 3 обращений к модели,{" "}
        {taskInputBudget.toLocaleString("ru-RU")} входных и{" "}
        {taskOutputBudget.toLocaleString("ru-RU")} выходных токенов. Автоматических платных повторов
        нет. Автономность наследуется от проекта.
      </p>
      <label className="manager-work-field">
        <input
          type="checkbox"
          checked={critic}
          disabled={busy || !historyLoaded}
          onChange={(e) => setCritic(e.target.checked)}
        />
        Проверить готовые файлы Критиком
      </label>
      <button
        type="button"
        className="manager-work-submit"
        disabled={busy || !goal.trim() || !runtime || !historyLoaded || executionGate !== "clear"}
        onClick={() => void act()}
      >
        Создать файлы
      </button>
      <DesktopComputerButton
        projectId={projectId}
        goal={goal}
        disabled={busy || executionGate !== "clear"}
      />
      {!historyLoaded && <p className="manager-work-usage">Загружаем задачи проекта…</p>}
      {(error || readError) && <p role="alert">{error || readError}</p>}
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
                  mutationEpoch.current++;
                  saveWorkSelection(selectionKey, item.id);
                  setSelectedWorkId(item.id);
                  setWork(item);
                  setError("");
                }}
              >
                <span>{item.request?.goal ?? `Задача ${index + 1}`}</span>
                <small>{labels[item.status] ?? "Состояние неизвестно"}</small>
              </button>
            ))}
          </div>
          {projectHasActiveWork && !active && (
            <p>Другая задача ещё выполняется. Откройте её в списке, чтобы увидеть шаги.</p>
          )}
        </div>
      )}
      <WorkManagerDag key={"dag:" + projectId} projectId={projectId} />
      <WorkManagerMemory key={projectId} projectId={projectId} />
      {work && (
        <>
          <WorkManagerProgress projectId={projectId} workId={work.id} version={work.version} />
          <AcceptedSkillView
            key={work.id}
            path={base + "/" + encodeURIComponent(work.id) + "/skills"}
            label="Skills этой задачи"
          />
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
          {work.draft && <CodeFiles files={work.draft.files} />}
          <ol
            className="manager-work-events"
            aria-label="Шаги выполнения"
            aria-live="polite"
            aria-relevant="additions"
          >
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
          {work.status === "completed" && (
            <>
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
              {work.result_accepted_at ? (
                <p className="manager-work-accepted" role="status">
                  Результат принят владельцем{" "}
                  {new Date(work.result_accepted_at).toLocaleString("ru-RU")}.
                </p>
              ) : (
                <button
                  className="manager-work-action primary"
                  disabled={busy || executionGate !== "clear"}
                  onClick={() => void acceptResult()}
                >
                  Принять результат
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
