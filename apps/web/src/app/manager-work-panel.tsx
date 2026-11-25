"use client";
import { PersonalSkillSettings } from "./chat-skill-settings";
import { AcceptedSkillView } from "./accepted-skill-view";
import { CodeFiles } from "./ui/code-files";

import Link from "next/link";
import { WorkResultSources } from "./work-result-sources";
import { SupplierWorkResult } from "./supplier-work-result";
import { WorkManagerDag } from "./work-manager-dag";
import { WorkManagerProgress } from "./work-manager-progress";
import { WorkManagerMemory } from "./work-manager-memory";
import { DesktopComputerButton } from "./desktop-computer-button";
import { useEffect, useRef, useState } from "react";
import {
  MANAGER_WORK_CONTROL_EVENTS,
  type CreateManagerWork,
  type ManagerWork,
  type WorkDag
} from "@cosmora/contracts";
import { startVisibleReadPolling } from "./visible-read-poller";
import { executionGateLabels, useExecutionGate } from "./use-execution-gate";
import { aiWorkChainGoal, aiWorkChainSource, requestsAiWorkChain } from "./ai-work-chain";

type Work = {
  id: string;
  request?: Pick<CreateManagerWork, "goal" | "output_contract">;
  supplier_handoff?: ManagerWork["supplier_handoff"];
  materials?: ManagerWork["materials"];
  result_sources?: ManagerWork["result_sources"];
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
const businessLabels = {
  supplier_comparison: "Сравнить поставщиков",
  pdf_field_register: "Извлечь поля из PDF",
  version_change_report: "Сравнить версии данных"
} as const;

type BusinessKind = keyof typeof businessLabels;

function businessKind(request?: Work["request"]): BusinessKind | "" {
  const kind = request?.output_contract?.kind;
  return kind === "supplier_comparison" ||
    kind === "pdf_field_register" ||
    kind === "version_change_report"
    ? kind
    : "";
}

function requestInput(request: CreateManagerWork): string {
  const output = request.output_contract;
  return output && "input" in output ? output.input : request.goal;
}

const supplierExample = {
  requirements: [{ itemId: "item-1", label: "Крепёж", quantity: 10, unit: "шт" }],
  offers: [
    {
      supplier: "Поставщик А",
      currency: "RUB",
      deliveryDays: 3,
      additionalCosts: [],
      lines: [{ itemId: "item-1", quantity: 10, unit: "шт", unitPrice: 25 }]
    },
    {
      supplier: "Поставщик Б",
      currency: "RUB",
      deliveryDays: 5,
      lines: [{ itemId: "item-1", quantity: 8, unit: "шт", unitPrice: 22 }]
    }
  ]
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
  INVALID_BUSINESS_INPUT: "Проверьте исходные данные выбранного отчёта и запустите задачу снова.",
  BUSINESS_REPORT_TOO_LARGE:
    "Отчёт слишком большой. Сократите число позиций и запустите сравнение снова.",
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
    if (!raw || raw.length > 1_500_000) return null;
    const draft = JSON.parse(raw) as Partial<CreateManagerWork> | null;
    if (
      !draft ||
      ![4, 5, 7].includes(Object.keys(draft).length) ||
      (Object.keys(draft).length === 5 && !businessKind(draft as CreateManagerWork)) ||
      (draft.output_contract &&
        "input" in draft.output_contract &&
        (typeof draft.output_contract.input !== "string" ||
          draft.output_contract.input.length > 240_000)) ||
      typeof draft.client_request_id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(draft.client_request_id) ||
      typeof draft.goal !== "string" ||
      !draft.goal.trim() ||
      draft.goal.length > 8000 ||
      (draft.worker_role !== "analyst" && draft.worker_role !== "architect") ||
      typeof draft.require_critic !== "boolean" ||
      (Object.keys(draft).length === 7 &&
        (draft.max_model_requests !== 3 ||
          typeof draft.max_input_tokens !== "number" ||
          !Number.isInteger(draft.max_input_tokens) ||
          draft.max_input_tokens < 1000 ||
          draft.max_input_tokens > 3_000_000 ||
          typeof draft.max_output_tokens !== "number" ||
          !Number.isInteger(draft.max_output_tokens) ||
          draft.max_output_tokens < 256 ||
          draft.max_output_tokens > 300_000))
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

function workFromUrl(projectId: string): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("project") === projectId ? params.get("work") : null;
}

function replaceSelectedWork(projectId: string, work: Work) {
  const url = new URL(window.location.href);
  if (work.supplier_handoff || workFromUrl(projectId)) {
    url.searchParams.set("work", work.id);
    window.history.replaceState(window.history.state, "", url);
  }
}

export function ManagerWorkPanel({
  projectId,
  initialGoal,
  onPlanSnapshot
}: {
  projectId: string;
  initialGoal: string;
  onPlanSnapshot: (graph: WorkDag) => void;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [reportKind, setReportKind] = useState<BusinessKind | "">("");
  const supplierComparison = reportKind === "supplier_comparison";
  const [pdfFields, setPdfFields] = useState("");
  const [pdfStatus, setPdfStatus] = useState("");
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [beforeKey, setBeforeKey] = useState("1");
  const [afterKey, setAfterKey] = useState("1");
  const extraction = useRef<AbortController | null>(null);
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
  const chainGoal = aiWorkChainGoal(goal);
  const pendingRequest =
    draft &&
    (requestInput(draft) === goal || (!reportKind && draft.goal === chainGoal)) &&
    draft.worker_role === role &&
    Boolean(draft.require_critic) === critic &&
    businessKind(draft) === reportKind
      ? draft
      : null;
  const chainRequested =
    !reportKind && (requestsAiWorkChain(goal) || pendingRequest?.goal === chainGoal);
  const creationBlocked =
    busy ||
    Boolean(pdfStatus) ||
    !goal.trim() ||
    !runtime ||
    !historyLoaded ||
    executionGate !== "clear";
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readPendingWork(pendingKey);
      if (!saved) return;
      pending.current = saved;
      setGoal(
        businessKind(saved) ? requestInput(saved) : (aiWorkChainSource(saved.goal) ?? saved.goal)
      );
      setRole(saved.worker_role);
      setReportKind(businessKind(saved));
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
        const linked = workFromUrl(projectId);
        const wanted = linked ?? selectedWorkId ?? readWorkSelection(selectionKey);
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
          const latest = selected ?? (linked ? null : (items[0] ?? null));
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
          setReadError(linked && !selected ? "Задача по этой ссылке недоступна." : "");
        }
      },
      {
        intervalMs: 750,
        onError: () => setReadError("Состояние временно недоступно. Работа сохраняется на сервере.")
      }
    );
  }, [base, projectId, selectedWorkId, selectionKey]);
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
      replaceSelectedWork(projectId, updated);
      setSelectedWorkId(updated.id);
      setWork((previous) =>
        previous?.id === updated.id && previous.version > updated.version ? previous : updated
      );
    }
  };
  useEffect(() => () => extraction.current?.abort(), []);
  const importPdf = async (files: File[]) => {
    if (!files.length || extraction.current) return;
    const fields = pdfFields
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ label: line.replace(/^!\s*/, ""), critical: line.startsWith("!") }));
    if (
      !fields.length ||
      fields.length > 24 ||
      fields.some(({ label }) => !label || label.length > 80)
    ) {
      setError("Укажите от 1 до 24 названий полей длиной до 80 символов.");
      return;
    }
    const controller = new AbortController();
    extraction.current = controller;
    setPdfStatus("Читаем PDF…");
    setGoal("");
    setError("");
    try {
      const { extractLibraryPages } = await import("./studio-files-library-client");
      const pages = [];
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name)) throw Error("Выберите PDF, в том числе PDF со сканами.");
        for (const page of await extractLibraryPages(file, controller.signal, setPdfStatus)) {
          if (page.page !== null)
            pages.push({
              file_name: file.name,
              page: page.page,
              text: page.text,
              source: page.source
            });
        }
      }
      controller.signal.throwIfAborted();
      const input = JSON.stringify({ fields, pages });
      if (input.length > 240_000 || pages.length > 250)
        throw Error(
          "В реестр помещается до 250 страниц и 240 000 символов входных данных. Выберите меньший пакет."
        );
      setGoal(input);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать PDF.");
    } finally {
      extraction.current = null;
      if (!controller.signal.aborted) setPdfStatus("");
    }
  };
  const prepareVersions = async () => {
    if (!beforeFile || !afterFile || busy || extraction.current) return;
    const columns = (value: string) => value.split(",").map((part) => Number(part.trim()));
    const beforeColumns = columns(beforeKey);
    const afterColumns = columns(afterKey);
    if (
      beforeColumns.length !== afterColumns.length ||
      [...beforeColumns, ...afterColumns].some((value) => !Number.isSafeInteger(value) || value < 1)
    ) {
      setError("Укажите одинаковое число номеров колонок для обеих версий.");
      return;
    }
    if (beforeFile.size + afterFile.size > 240_000) {
      setError("Выберите экспорты Studio Data общим размером до 240 КБ.");
      return;
    }
    const controller = new AbortController();
    extraction.current = controller;
    setPdfStatus("Читаем версии…");
    setError("");
    setGoal("");
    try {
      const [before, after] = await Promise.all([beforeFile.text(), afterFile.text()]);
      controller.signal.throwIfAborted();
      const input = JSON.stringify({
        before: { label: beforeFile.name, source: before },
        after: { label: afterFile.name, source: after },
        key: { before_columns: beforeColumns, after_columns: afterColumns }
      });
      if (input.length > 240_000)
        throw Error("Размер данных для сравнения превышает 240 000 символов.");
      setGoal(input);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать данные.");
    } finally {
      extraction.current = null;
      if (!controller.signal.aborted) setPdfStatus("");
    }
  };
  const act = async (action?: keyof typeof MANAGER_WORK_CONTROL_EVENTS, plan = false) => {
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
        const requestedGoal = plan ? chainGoal : goal;
        if (!pendingRequest || requestInput(pendingRequest) !== requestedGoal)
          pending.current = {
            client_request_id: crypto.randomUUID(),
            goal: reportKind && !supplierComparison ? businessLabels[reportKind] : requestedGoal,
            worker_role: role,
            require_critic: critic,
            ...(reportKind === "supplier_comparison"
              ? { output_contract: { kind: reportKind } }
              : reportKind
                ? { output_contract: { kind: reportKind, input: requestedGoal } }
                : {})
          };
        body = pending.current;
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
  const resultControls =
    work?.status === "completed" ? (
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
            Результат принят владельцем {new Date(work.result_accepted_at).toLocaleString("ru-RU")}.
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
    ) : null;
  const workIsSupplier = businessKind(work?.request) === "supplier_comparison";
  const sourcePanel =
    work?.status === "completed" ? (
      <WorkResultSources
        key={work.id}
        projectId={projectId}
        runIds={[
          ...(workIsSupplier ? [work.id] : []),
          ...(work.result_sources ?? []).map((source) => source.run_id)
        ]}
      />
    ) : null;
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
        Тип задачи
        <select
          value={reportKind}
          onChange={(event) => {
            const value = event.target.value as BusinessKind | "";
            setReportKind(value);
            if (value) setCritic(false);
            if (reportKind) setGoal("");
          }}
          disabled={busy || Boolean(pdfStatus) || !historyLoaded}
        >
          <option value="">Обычная задача</option>
          {Object.entries(businessLabels).map(([kind, label]) => (
            <option value={kind} key={kind}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {reportKind === "pdf_field_register" && (
        <>
          <label className="manager-work-field">
            Названия полей по одному на строку. Начните с ! для критичного поля
            <textarea
              value={pdfFields}
              onChange={(event) => setPdfFields(event.target.value)}
              rows={3}
              disabled={busy || Boolean(pdfStatus)}
            />
          </label>
          <label className="manager-work-field">
            PDF и сканы в PDF
            <input
              type="file"
              accept=".pdf"
              multiple
              disabled={busy || Boolean(pdfStatus) || !historyLoaded}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                void importPdf(files);
              }}
            />
          </label>
          <p>Значения извлекаются из строк вида «Название: значение».</p>
        </>
      )}
      {reportKind === "version_change_report" && (
        <>
          <label className="manager-work-field">
            Прежняя версия Studio Data
            <input
              type="file"
              accept=".json"
              disabled={busy || Boolean(pdfStatus)}
              onChange={(event) => {
                setBeforeFile(event.target.files?.[0] ?? null);
                setGoal("");
              }}
            />
          </label>
          <label className="manager-work-field">
            Новая версия Studio Data
            <input
              type="file"
              accept=".json"
              disabled={busy || Boolean(pdfStatus)}
              onChange={(event) => {
                setAfterFile(event.target.files?.[0] ?? null);
                setGoal("");
              }}
            />
          </label>
          <label className="manager-work-field">
            Колонки ключа в прежней версии, через запятую
            <input
              value={beforeKey}
              disabled={busy || Boolean(pdfStatus)}
              onChange={(event) => {
                setBeforeKey(event.target.value);
                setGoal("");
              }}
            />
          </label>
          <label className="manager-work-field">
            Колонки ключа в новой версии, через запятую
            <input
              value={afterKey}
              disabled={busy || Boolean(pdfStatus)}
              onChange={(event) => {
                setAfterKey(event.target.value);
                setGoal("");
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || Boolean(pdfStatus) || !beforeFile || !afterFile}
            onClick={() => void prepareVersions()}
          >
            Подготовить версии
          </button>
        </>
      )}
      {pdfStatus && <p role="status">{pdfStatus}</p>}
      <label className="manager-work-field">
        {reportKind ? "Данные отчёта (JSON)" : "Задача"}
        <textarea
          aria-label={reportKind ? "Данные отчёта (JSON)" : "Задача для выполнения"}
          placeholder={supplierComparison ? '{"requirements":[…],"offers":[…]}' : undefined}
          value={goal}
          maxLength={reportKind && !supplierComparison ? 240_000 : 8000}
          rows={4}
          onChange={(e) => setGoal(e.target.value)}
          disabled={busy || Boolean(pdfStatus) || !historyLoaded}
        />
      </label>
      {supplierComparison && !goal.trim() && (
        <button
          type="button"
          disabled={busy || !historyLoaded}
          onClick={() => setGoal(JSON.stringify(supplierExample, null, 2))}
        >
          Вставить пример предложений
        </button>
      )}
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
        disabled={creationBlocked || (chainRequested && chainGoal.length > 8000)}
        onClick={() => void act(undefined, chainRequested)}
      >
        {reportKind
          ? businessLabels[reportKind]
          : chainRequested
            ? "Построить цепочку с ИИ"
            : "Создать файлы"}
      </button>
      {!chainRequested && !reportKind && (
        <button
          type="button"
          disabled={creationBlocked || chainGoal.length > 8000 || Boolean(pendingRequest)}
          onClick={() => void act(undefined, true)}
        >
          Построить цепочку с ИИ
        </button>
      )}
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
                  replaceSelectedWork(projectId, item);
                  setSelectedWorkId(item.id);
                  setWork(item);
                  setError("");
                }}
              >
                <span>
                  {businessKind(item.request)
                    ? businessLabels[businessKind(item.request) as BusinessKind]
                    : item.request?.goal
                      ? (aiWorkChainSource(item.request.goal) ?? item.request.goal)
                      : `Задача ${index + 1}`}
                </span>
                <small>{labels[item.status] ?? "Состояние неизвестно"}</small>
              </button>
            ))}
          </div>
          {projectHasActiveWork && !active && (
            <p>Другая задача ещё выполняется. Откройте её в списке, чтобы увидеть шаги.</p>
          )}
        </div>
      )}
      <WorkManagerDag
        key={"dag:" + projectId}
        projectId={projectId}
        onPlanSnapshot={onPlanSnapshot}
        aiPlanWorkId={
          work?.status === "completed" &&
          work.stage === "done" &&
          work.request?.goal &&
          aiWorkChainSource(work.request.goal)
            ? work.id
            : null
        }
      />
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
          {workIsSupplier ? (
            <SupplierWorkResult
              projectId={projectId}
              workId={work.id}
              source={work.supplier_handoff}
              instructions={work.materials?.instructions ?? ""}
              evidence={
                work.status === "completed"
                  ? work.draft?.files.find((file) => file.name === "supplier-evidence.json")
                      ?.content
                  : undefined
              }
            >
              {sourcePanel}
              {resultControls}
            </SupplierWorkResult>
          ) : (
            <>
              {sourcePanel}
              {resultControls}
            </>
          )}
        </>
      )}
    </section>
  );
}
