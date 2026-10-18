"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AcceptedSkillView } from "./accepted-skill-view";
import {
  WORK_PLAN_PACKAGE_MAX_BYTES,
  parseWorkPlanPackageText,
  type WorkPlanPackage
} from "@cosmora/contracts/work-plan-package";
import type { WorkDag, WorkDagNodeInput, WorkDagControl } from "@cosmora/contracts";
import { useExecutionGate } from "./use-execution-gate";
import styles from "./work-manager.module.css";

const statuses: Record<string, string> = {
  pending: "Готов к запуску",
  blocked: "Заблокирован",
  running: "Выполняется",
  completed: "Завершён",
  failed: "Ошибка",
  cancelled: "Отменён"
};
const reasons: Record<string, string> = {
  PROJECT_PAUSED: "Проект на паузе",
  PROJECT_CANCELLED: "Проект отменён",
  EXECUTOR_QUEUE: "Ожидает свободного исполнителя",
  PAUSED: "На паузе; можно продолжить с checkpoint",
  AWAITING_APPROVAL: "Нужно подтвердить план Manager",
  WAITING_CONFIRMATION: "Нужно разрешение в Центре управления",
  DENIED: "Policy Engine запретил сохранение",
  RECOVERY_REQUIRED: "Процесс прерван. Повтор не отправлен; результат запроса неизвестен",
  OWNER_QUIESCED: "Работы остановлены для операции с данными владельца",
  DAG_CYCLE: "Зависимости образуют цикл. Измените их перед сохранением",
  DAG_DEPENDENCY_MISSING: "Зависимость указывает на отсутствующий шаг",
  STALE_DAG: "План изменился. Закройте редактор и откройте актуальную версию",
  STEP_ALREADY_STARTED: "Запущенный шаг редактировать нельзя",
  DEPENDENCY_CONTEXT_LIMIT:
    "Результаты зависимостей слишком велики для лимита контекста (24 000 символов). Измените зависимости ещё не запущенного шага",
  EXECUTION_BUDGET_EXCEEDED: "Достигнут лимит запросов или токенов шага",
  CRITIC_REJECTED: "Критик отклонил результат",
  OWNER_BUDGET_REFUSED:
    "Бюджет владельца не разрешил удержание для запроса. Проверьте лимиты и неопределённые расходы",
  OWNER_BUDGET_EXCEEDED: "Достигнут лимит владельца",
  EXPLICIT_RETRY_REQUIRED: "Для повтора подтвердите возможность нового расхода",
  INVALID_MODEL_OUTPUT: "Модель вернула недопустимый результат",
  UNSUPPORTED_ACTION: "Для задачи нужны недоступные действия",
  STEP_NOT_READY: "Шаг ещё не готов к запуску",
  TERMINAL_STEP: "Шаг уже завершён. Его результат сохранён; отмена недоступна",
  STEP_CANCELLED_BY_OWNER: "Шаг отменён владельцем; автозапуск этого плана остановлен",
  DEPENDENCIES_INCOMPLETE: "Зависимости не завершены",
  DAG_NOT_BOUND: "Подготовленная попытка ещё не привязана к графу",
  AUTO_PLAN_ACTIVE: "Сначала остановите автозапуск, чтобы изменить план или запустить шаг вручную",
  PLAN_EDITED: "План изменён. Подтвердите выполнение обновлённых шагов",
  PLAN_REQUEST_LIMIT: "Достигнут общий лимит запросов. Можно явно продолжить с увеличенным лимитом",
  INVALID_PLAN_BUDGET: "Укажите общий лимит от 3 до 96 запросов",
  STEP_FAILED: "Шаг завершился ошибкой. Повторите только его после проверки причины",
  STOPPED_BY_OWNER: "Автозапуск остановлен; сохранённые результаты доступны",
  RESTART_REQUIRES_RESUME: "Сервер перезапустился. Для новых шагов подтвердите продолжение",
  EMERGENCY_STOP: "Работа остановлена аварийным выключателем",
  PLAN_ARCHIVED: "План в архиве. Восстановите его перед изменением или запуском",
  PLAN_HAS_UNFINISHED_WORK:
    "Сначала завершите или отмените начатые шаги, включая ожидающие подтверждения",
  RESTORED_REQUIRES_START: "План восстановлен. Запуск выполняется отдельно",
  RESULTS_LIMIT: "Результаты слишком велики для общего пакета; скачайте файлы по отдельности"
};
export function workDagReason(reason: string | null, graph: WorkDag): string {
  if (!reason) return "";
  if (reason.startsWith("DEPENDENCIES:"))
    return (
      "Ожидает: " +
      reason
        .slice(13)
        .split(",")
        .map((id) => graph.nodes.find((n) => n.id === id)?.title ?? id)
        .join(", ")
    );
  return reasons[reason] ?? "Причина: " + reason;
}
const inputs = (graph: WorkDag) =>
  graph.nodes.map(({ id, title, goal, depends_on, requires_critic }) => ({
    id,
    title,
    goal,
    depends_on,
    ...(requires_critic === undefined ? {} : { requires_critic })
  }));
const freshStep = (): WorkDagNodeInput => ({
  id: "step_" + crypto.randomUUID().slice(0, 8),
  title: "",
  goal: "",
  requires_critic: true,
  depends_on: []
});

export function WorkManagerDag({ projectId }: { projectId: string }) {
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/work-dags";
  const gate = useExecutionGate(projectId);
  const [graphs, setGraphs] = useState<WorkDag[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [collection, setCollection] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [rename, setRename] = useState<{ id: string; version: number; title: string } | null>(null);
  const [editor, setEditor] = useState<{
    graphId: string | null;
    version: number;
    title: string;
    nodes: WorkDagNodeInput[];
    requestId: string;
  } | null>(null);
  const [copy, setCopy] = useState<{
    sourceId: string;
    sourceVersion: number;
    title: string;
    skills: "source" | "project";
    targetProjectId: string;
    requestId: string;
  } | null>(null);
  const [copyProjects, setCopyProjects] = useState<{ id: string; title: string; status: string }[]>(
    []
  );
  const [copyProjectsError, setCopyProjectsError] = useState("");
  const [copiedElsewhere, setCopiedElsewhere] = useState<WorkDag | null>(null);
  const [importDraft, setImportDraft] = useState<{
    package: WorkPlanPackage;
    requestId: string;
    checked: boolean;
  } | null>(null);
  const [readingImport, setReadingImport] = useState(false);
  const importEpoch = useRef(0);
  const [retry, setRetry] = useState<string | null>(null);
  const [cancellation, setCancellation] = useState<{
    graphId: string;
    nodeId: string;
    version: number;
    title: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [autoConfirmed, setAutoConfirmed] = useState(false);
  const [requestLimit, setRequestLimit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkpoints, setCheckpoints] = useState<{ version: number; at: string }[]>([]);
  const lock = useRef(false),
    epoch = useRef(0);
  const visibleGraphs = graphs.filter(
    (g) =>
      Boolean(g.archived_at) === (collection === "archived") &&
      [g.title, ...g.nodes.flatMap((n) => [n.title, n.goal])].some((text) =>
        text.toLocaleLowerCase("ru-RU").includes(search.trim().toLocaleLowerCase("ru-RU"))
      )
  );
  const graph = visibleGraphs.find((g) => g.id === selected) ?? visibleGraphs[0] ?? null;
  const browsingLocked =
    busy ||
    Boolean(editor) ||
    Boolean(copy) ||
    Boolean(importDraft) ||
    Boolean(rename) ||
    Boolean(cancellation) ||
    readingImport;
  const automatic = graph?.execution && ["running", "waiting"].includes(graph.execution.status);
  const totalLimit =
    requestLimit ??
    Math.min(
      96,
      Math.max(
        (graph?.nodes.length ?? 1) * 3,
        (graph?.usage?.model_requests ?? 0) +
          (graph?.nodes.filter((node) => !["completed", "cancelled"].includes(node.status))
            .length ?? 1) *
            3
      )
    );
  useEffect(() => {
    setRetry(null);
    setCancellation(null);
    setAcknowledged(false);
    setAutoConfirmed(false);
    setRequestLimit(null);
  }, [graph?.id]);
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(reasons[data.error ?? ""] ?? data.error ?? "Не удалось выполнить запрос");
    }
    return response.json() as Promise<T>;
  }
  useEffect(() => {
    setSelected(new URLSearchParams(window.location.search).get("plan"));
  }, [projectId]);
  const copySource = copy?.sourceId;
  useEffect(() => {
    if (!copySource) return;
    const controller = new AbortController();
    setCopyProjects([]);
    setCopyProjectsError("");
    void request<{ items: { id: string; title: string; status: string }[] }>("/api/v1/projects", {
      signal: controller.signal
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setCopyProjects(data.items.filter((p) => p.status === "ACTIVE"));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCopyProjectsError(
            "Не удалось загрузить другие проекты. Можно сохранить копию в текущем проекте или открыть форму заново."
          );
      });
    return () => controller.abort();
  }, [copySource]);
  function acceptSaved(result: WorkDag) {
    if (result.project_id === projectId) {
      setGraphs((current) => [result, ...current.filter((g) => g.id !== result.id)]);
      setSelected(result.id);
      setCollection(result.archived_at ? "archived" : "active");
      setSearch("");
    } else {
      setCopiedElsewhere(result);
    }
    setEditor(null);
    setRename(null);
    setCopy(null);
    setImportDraft(null);
    setCancellation(null);
    setRetry(null);
    setAcknowledged(false);
    setAutoConfirmed(false);
    setRequestLimit(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let linkedPlan = new URLSearchParams(window.location.search).get("plan");
    async function refresh() {
      const before = epoch.current;
      try {
        const data = await request<{ items: WorkDag[] }>(base, { signal: controller.signal });
        if (!controller.signal.aborted && before === epoch.current && !lock.current) {
          setGraphs(data.items);
          if (linkedPlan) {
            const linked = data.items.find((item) => item.id === linkedPlan);
            if (linked) {
              setSelected(linked.id);
              setCollection(linked.archived_at ? "archived" : "active");
            } else {
              setError("План из ссылки не найден в этом проекте");
            }
            linkedPlan = null;
          }
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Не удалось обновить план. Состояние сохранено на сервере");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    if (!graph) {
      setCheckpoints([]);
      return;
    }
    void request<{ items: { version: number; at: string }[] }>(
      base + "/" + graph.id + "/checkpoints",
      { signal: controller.signal }
    )
      .then((r) => {
        if (!controller.signal.aborted) setCheckpoints(r.items);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [base, graph?.id, graph?.version]);
  async function mutate(url: string, method: string, body: unknown) {
    if (lock.current) return;
    lock.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    setCopiedElsewhere(null);
    try {
      const result = await request<WorkDag>(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      acceptSaved(result);
    } catch (e) {
      // Lost acknowledgement: read canonical state, never repeat the command.
      if (method === "POST" && url.endsWith("/control")) {
        const expected = body as WorkDagControl;
        if (expected.action === "cancel_step") {
          try {
            const latest = await request<WorkDag>(url.slice(0, -"/control".length));
            setGraphs((current) => [latest, ...current.filter((g) => g.id !== latest.id)]);
            if (
              latest.version >= expected.version &&
              latest.nodes.find((n) => n.id === expected.node_id)?.status === "cancelled"
            ) {
              acceptSaved(latest);
              return;
            }
          } catch {
            /* Preserve the confirmation and never repeat cancellation automatically. */
          }
        }
      }
      if (method === "PUT" && url.endsWith("/title")) {
        try {
          const expected = body as { expected_version: number; title: string };
          const latest = await request<WorkDag>(url.slice(0, -"/title".length));
          setGraphs((current) => [latest, ...current.filter((g) => g.id !== latest.id)]);
          if (latest.version >= expected.expected_version && latest.title === expected.title) {
            acceptSaved(latest);
            return;
          }
        } catch {
          /* Retain the draft; never repeat a write automatically. */
        }
      }
      if (method === "PUT" && url.endsWith("/archive")) {
        try {
          const expected = body as { expected_version: number; archived: boolean };
          const latest = await request<WorkDag>(url.slice(0, -"/archive".length));
          setGraphs((current) => [latest, ...current.filter((g) => g.id !== latest.id)]);
          if (
            latest.version > expected.expected_version &&
            Boolean(latest.archived_at) === expected.archived
          ) {
            setSelected(latest.id);
            setCollection(latest.archived_at ? "archived" : "active");
            setSearch("");
            setRetry(null);
            setAutoConfirmed(false);
            return;
          }
        } catch {
          /* Read-only polling can still recover the canonical state. */
        }
      }
      if (method === "POST" && url.endsWith("/clone")) {
        try {
          const data = body as {
            client_request_id: string;
            expected_version: number;
            title: string;
            skills: "source" | "project";
            target_project_id?: string;
          };
          const targetBase =
            "/api/v1/projects/" +
            encodeURIComponent(data.target_project_id ?? projectId) +
            "/work-dags";
          const latest = await request<{ items: WorkDag[] }>(targetBase);
          const found = latest.items.find(
            (g) =>
              g.client_request_id === data.client_request_id &&
              g.title === data.title &&
              g.copied_from?.graph_id === url.slice(base.length + 1, -"/clone".length) &&
              g.copied_from?.version === data.expected_version &&
              g.copied_from.skills === data.skills
          );
          if (found) {
            acceptSaved(found);
            setError("");
            return;
          }
        } catch {
          /* Keep the copy draft and its idempotency key for a later explicit retry. */
        }
      }
      if (method === "POST" && url === base + "/import") {
        try {
          const data = body as { client_request_id: string };
          const latest = await request<{ items: WorkDag[] }>(base);
          const found = latest.items.find((g) => g.client_request_id === data.client_request_id);
          if (found) {
            setGraphs(latest.items);
            setSelected(found.id);
            setCollection("active");
            setSearch("");
            setImportDraft(null);
            setError("");
            return;
          }
        } catch {
          /* Preserve the reviewed file and key. No automatic second POST. */
        }
      }
      const control = body as Partial<WorkDagControl>;
      if (method === "POST" && control.action === "run_plan" && url.endsWith("/control")) {
        try {
          const latest = await request<WorkDag>(url.slice(0, -"/control".length));
          if (
            latest.version > (control.version ?? 0) &&
            latest.execution?.max_model_requests === control.max_model_requests
          ) {
            setGraphs((current) => [latest, ...current.filter((g) => g.id !== latest.id)]);
            setSelected(latest.id);
            setAutoConfirmed(false);
            setError("");
            return;
          }
        } catch {
          /* The regular read-only refresh remains available. */
        }
      }
      setError(e instanceof Error ? e.message : "Ошибка действия");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function loadImport(file: File | undefined) {
    const epoch = ++importEpoch.current;
    setImportDraft(null);
    setError("");
    if (!file) return;
    if (!file.size || file.size > WORK_PLAN_PACKAGE_MAX_BYTES) {
      setError("Выберите JSON плана размером до 600 КБ.");
      return;
    }
    setReadingImport(true);
    try {
      const pkg = parseWorkPlanPackageText(await file.text());
      if (epoch === importEpoch.current)
        setImportDraft({ package: pkg, requestId: crypto.randomUUID(), checked: false });
    } catch {
      if (epoch === importEpoch.current)
        setError(
          "Файл не соответствует формату плана Kosmora или содержит недопустимые зависимости."
        );
    } finally {
      if (epoch === importEpoch.current) setReadingImport(false);
    }
  }
  function act(action: WorkDagControl["action"], nodeId?: string) {
    if (
      !graph ||
      graph.archived_at ||
      (["run", "retry", "resume", "resume_step", "approve_step", "run_plan"].includes(action) &&
        gate !== "clear")
    )
      return;
    if (action === "run_plan" && !autoConfirmed) return;
    void mutate(base + "/" + graph.id + "/control", "POST", {
      version: graph.version,
      action,
      ...(nodeId ? { node_id: nodeId } : {}),
      ...(action === "retry" ? { acknowledge_cost: true } : {}),
      ...(action === "run_plan" ? { acknowledge_cost: true, max_model_requests: totalLimit } : {})
    });
  }
  function update(index: number, change: Partial<WorkDagNodeInput>) {
    if (editor)
      setEditor({
        ...editor,
        nodes: editor.nodes.map((n, i) => (i === index ? { ...n, ...change } : n))
      });
  }
  return (
    <section className={styles.panel} aria-label="План с зависимостями">
      <h3>План проекта</h3>
      <p>
        Создайте шаги и зависимости, затем выполните план целиком или запускайте шаги отдельно.
        Каждый шаг создаёт файлы через Manager: до 3 запросов, 32 000 входных и 6 000 выходных
        токенов. Повторы запускаются вручную.
      </p>
      <div className={styles.actions}>
        {graph && (
          <button
            type="button"
            disabled={browsingLocked}
            onClick={() =>
              setCopy({
                sourceId: graph.id,
                sourceVersion: graph.version,
                title: (graph.title + " — копия").slice(0, 160),
                skills: "source",
                targetProjectId: projectId,
                requestId: crypto.randomUUID()
              })
            }
          >
            Создать копию плана
          </button>
        )}
        <button
          disabled={browsingLocked}
          onClick={() =>
            setEditor({
              graphId: null,
              version: 0,
              title: "",
              nodes: [freshStep()],
              requestId: crypto.randomUUID()
            })
          }
        >
          Новый план
        </button>
        {graph && (
          <button
            disabled={
              browsingLocked ||
              Boolean(graph.archived_at) ||
              graph.mode === "cancelled" ||
              Boolean(automatic)
            }
            onClick={() =>
              setEditor({
                graphId: graph.id,
                version: graph.version,
                title: graph.title,
                nodes: inputs(graph),
                requestId: graph.client_request_id
              })
            }
          >
            Редактировать не запущенные шаги
          </button>
        )}
      </div>
      {graphs.length > 0 && (
        <>
          <label>
            Раздел планов
            <select
              aria-label="Раздел планов"
              value={collection}
              disabled={browsingLocked}
              onChange={(e) => {
                setCollection(e.target.value as "active" | "archived");
                setSelected(null);
                setRetry(null);
                setAutoConfirmed(false);
                setRequestLimit(null);
              }}
            >
              <option value="active">
                Текущие ({graphs.filter((g) => !g.archived_at).length})
              </option>
              <option value="archived">Архив ({graphs.filter((g) => g.archived_at).length})</option>
            </select>
          </label>
          <label>
            Поиск планов
            <input
              type="search"
              value={search}
              disabled={browsingLocked}
              placeholder="Название или текст задачи"
              onChange={(e) => {
                setSearch(e.target.value);
                setRetry(null);
                setAutoConfirmed(false);
                setRequestLimit(null);
              }}
            />
          </label>
          {visibleGraphs.length === 0 ? (
            <p role="status">В этом разделе подходящих планов нет.</p>
          ) : (
            <label>
              Сохранённые планы
              <select
                value={graph?.id ?? ""}
                disabled={browsingLocked}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setRetry(null);
                  setAcknowledged(false);
                  setAutoConfirmed(false);
                  setRequestLimit(null);
                }}
              >
                {visibleGraphs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <details>
        <summary>Перенос плана через JSON</summary>
        <p>
          Файл содержит задачи и зависимости. После локального предпросмотра импорт создаст новый
          план с текущим сохранённым выбором Skills Work проекта. Запуск выполняется отдельно.
        </p>
        <label>
          JSON плана
          <input
            aria-label="JSON плана"
            type="file"
            accept=".json,application/json"
            disabled={
              busy ||
              Boolean(editor) ||
              Boolean(copy) ||
              Boolean(rename) ||
              Boolean(cancellation) ||
              readingImport
            }
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              void loadImport(file);
            }}
          />
        </label>
        {readingImport && <p role="status">Проверка файла…</p>}
        {importDraft && (
          <form
            aria-label="Предпросмотр импорта плана"
            onSubmit={(e) => {
              e.preventDefault();
              if (importDraft.checked)
                void mutate(base + "/import", "POST", {
                  client_request_id: importDraft.requestId,
                  package: importDraft.package
                });
            }}
          >
            <strong>{importDraft.package.title}</strong>
            <ol className={styles.importPreview}>
              {importDraft.package.nodes.map((n) => (
                <li key={n.id}>
                  <strong>{n.title}</strong>
                  <p>{n.goal}</p>
                  <p>
                    Зависимости:{" "}
                    {n.depends_on
                      .map((id) => importDraft.package.nodes.find((x) => x.id === id)?.title ?? id)
                      .join(", ") || "нет"}{" "}
                    · {n.requires_critic ? "Критик обязателен" : "Критик по риску"}
                  </p>
                </li>
              ))}
            </ol>
            <label>
              <input
                type="checkbox"
                checked={importDraft.checked}
                disabled={busy}
                onChange={(e) => setImportDraft({ ...importDraft, checked: e.target.checked })}
              />
              Я проверил задачи и зависимости; использовать сохранённые Skills Work проекта
            </label>
            <button type="submit" disabled={busy || !importDraft.checked}>
              Сохранить импортированный план
            </button>
            <button type="button" disabled={busy} onClick={() => setImportDraft(null)}>
              Отмена импорта
            </button>
          </form>
        )}
      </details>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {copiedElsewhere && (
        <p role="status">
          Копия «{copiedElsewhere.title}» сохранена в другом проекте.{" "}
          <a
            href={
              "/?project=" +
              encodeURIComponent(copiedElsewhere.project_id) +
              "&view=plan&plan=" +
              encodeURIComponent(copiedElsewhere.id)
            }
          >
            Открыть сохранённую копию
          </a>
        </p>
      )}
      {copy && (
        <form
          aria-label="Копия плана"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(base + "/" + encodeURIComponent(copy.sourceId) + "/clone", "POST", {
              client_request_id: copy.requestId,
              expected_version: copy.sourceVersion,
              title: copy.title,
              skills: copy.skills,
              target_project_id: copy.targetProjectId
            });
          }}
        >
          <p>
            Будет создан отдельный план с теми же задачами и зависимостями. История запусков,
            результаты, разрешения и расходы не переносятся. Запуск потребует отдельного действия.
          </p>
          <label>
            Название копии
            <input
              aria-label="Название копии"
              maxLength={160}
              required
              value={copy.title}
              disabled={busy}
              onChange={(e) => setCopy({ ...copy, title: e.target.value })}
            />
          </label>
          <label>
            Проект для копии
            <select
              aria-label="Проект для копии"
              value={copy.targetProjectId}
              disabled={busy}
              onChange={(e) => setCopy({ ...copy, targetProjectId: e.target.value })}
            >
              <option value={projectId}>Текущий проект</option>
              {copyProjects
                .filter((p) => p.id !== projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </label>
          {copyProjectsError && <p role="status">{copyProjectsError}</p>}
          <label>
            Инструкции для копии
            <select
              aria-label="Инструкции для копии"
              value={copy.skills}
              disabled={busy}
              onChange={(e) => setCopy({ ...copy, skills: e.target.value as "source" | "project" })}
            >
              <option value="source">Сохранённый снимок Skills исходного плана</option>
              <option value="project">Сохранённый выбор Skills Work целевого проекта</option>
            </select>
          </label>
          <p>
            Исходный снимок может содержать текст удалённых Skills. Для текущего набора инструкций
            выберите настройки целевого проекта. Материалы проекта будут взяты при запуске каждого
            шага в целевом проекте.
          </p>
          <button type="submit" disabled={busy || !copy.title.trim()}>
            Сохранить копию
          </button>
          <button type="button" disabled={busy} onClick={() => setCopy(null)}>
            Отмена копирования
          </button>
        </form>
      )}
      {editor && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              editor.graphId ? base + "/" + editor.graphId : base,
              editor.graphId ? "PUT" : "POST",
              editor.graphId
                ? { version: editor.version, nodes: editor.nodes }
                : { client_request_id: editor.requestId, title: editor.title, nodes: editor.nodes }
            );
          }}
        >
          <label>
            Название плана
            <input
              required
              maxLength={160}
              disabled={Boolean(editor.graphId) || busy}
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
          </label>
          {editor.nodes.map((node, index) => {
            const savedNode =
              graph?.id === editor.graphId ? graph.nodes.find((n) => n.id === node.id) : undefined;
            const started = Boolean(
              savedNode?.attempts.length || savedNode?.status === "cancelled"
            );
            return (
              <fieldset key={node.id} disabled={started || busy} className={styles.dagStep}>
                <legend>
                  Шаг {index + 1}
                  {savedNode?.status === "cancelled"
                    ? " · отменён"
                    : started
                      ? " · уже запущен"
                      : ""}
                </legend>
                <label>
                  Название
                  <input
                    required
                    maxLength={160}
                    value={node.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                  />
                </label>
                <label>
                  Задача для Manager
                  <textarea
                    required
                    maxLength={4000}
                    rows={3}
                    value={node.goal}
                    onChange={(e) => update(index, { goal: e.target.value })}
                  />
                </label>
                <p>Запуск после завершения:</p>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(node.requires_critic)}
                    onChange={(e) => update(index, { requires_critic: e.target.checked })}
                  />
                  Проверить результат Критиком
                </label>
                {editor.nodes
                  .filter((n) => n.id !== node.id)
                  .map((dependency) => (
                    <label key={dependency.id}>
                      <input
                        type="checkbox"
                        checked={node.depends_on.includes(dependency.id)}
                        onChange={(e) =>
                          update(index, {
                            depends_on: e.target.checked
                              ? [...node.depends_on, dependency.id]
                              : node.depends_on.filter((d) => d !== dependency.id)
                          })
                        }
                      />
                      {dependency.title || "Без названия"}
                    </label>
                  ))}
                <button
                  type="button"
                  disabled={editor.nodes.length === 1}
                  onClick={() =>
                    setEditor({
                      ...editor,
                      nodes: editor.nodes
                        .filter((n) => n.id !== node.id)
                        .map((n) => ({
                          ...n,
                          depends_on: n.depends_on.filter((d) => d !== node.id)
                        }))
                    })
                  }
                >
                  Удалить шаг из плана
                </button>
              </fieldset>
            );
          })}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || editor.nodes.length >= 32}
              onClick={() => setEditor({ ...editor, nodes: [...editor.nodes, freshStep()] })}
            >
              Добавить шаг
            </button>
            <button disabled={busy} type="submit">
              Сохранить план
            </button>
            <button disabled={busy} type="button" onClick={() => setEditor(null)}>
              Закрыть редактор
            </button>
          </div>
        </form>
      )}
      {rename && (
        <form
          aria-label="Переименование плана"
          onSubmit={(e) => {
            e.preventDefault();
            if (rename.title.trim())
              void mutate(base + "/" + rename.id + "/title", "PUT", {
                expected_version: rename.version,
                title: rename.title.trim()
              });
          }}
        >
          <label>
            Новое название плана
            <input
              required
              maxLength={160}
              value={rename.title}
              disabled={busy}
              onChange={(e) => setRename({ ...rename, title: e.target.value })}
            />
          </label>
          <button type="submit" disabled={busy || !rename.title.trim()}>
            Сохранить название
          </button>
          <button type="button" disabled={busy} onClick={() => setRename(null)}>
            Отмена переименования
          </button>
        </form>
      )}
      {graph && (
        <>
          <h4>{graph.title}</h4>
          {!graph.archived_at && (
            <button
              type="button"
              disabled={browsingLocked}
              onClick={() =>
                setRename({ id: graph.id, version: graph.version, title: graph.title })
              }
            >
              Переименовать план
            </button>
          )}

          {graph.archived_at && (
            <p role="status">
              В архиве с {new Date(graph.archived_at).toLocaleString("ru-RU")}. Файлы и история
              сохранены. Для запуска восстановите план.
            </p>
          )}
          <button
            type="button"
            disabled={
              browsingLocked ||
              (!graph.archived_at &&
                (Boolean(automatic) ||
                  graph.nodes.some(
                    (n) =>
                      n.attempts.length && !["completed", "failed", "cancelled"].includes(n.status)
                  )))
            }
            onClick={() =>
              void mutate(base + "/" + graph.id + "/archive", "PUT", {
                expected_version: graph.version,
                archived: !graph.archived_at
              })
            }
          >
            {graph.archived_at ? "Восстановить план" : "В архив"}
          </button>
          {!graph.archived_at && (
            <p>
              Архив сохраняет результаты и историю. Начатые шаги должны быть завершены или отменены,
              автозапуск — остановлен.
            </p>
          )}
          <a
            href={base + "/" + encodeURIComponent(graph.id) + "/package"}
            download="work-plan.json"
          >
            Скачать JSON плана
          </a>
          <p>
            <a href={base + "/" + encodeURIComponent(graph.id) + "/results.zip"}>
              Скачать отчёт и файлы (ZIP)
            </a>{" "}
            — опубликованные результаты, версии и источники. Незавершённые шаги отмечены в отчёте.
          </p>
          {graph.copied_from && (
            <p>
              Копия плана · исходная версия {graph.copied_from.version} ·{" "}
              {graph.copied_from.skills === "source"
                ? "Skills из исходного снимка"
                : "Skills из настроек проекта"}
            </p>
          )}
          <AcceptedSkillView
            key={graph.id}
            path={base + "/" + encodeURIComponent(graph.id) + "/skills"}
            label="Skills этого плана"
          />
          <p>
            {graph.archived_at ? "Состояние при архивировании: " : ""}
            {graph.mode === "active"
              ? "Проект активен"
              : graph.mode === "paused"
                ? "Проект на паузе"
                : "Проект отменён"}{" "}
            · версия {graph.version} · завершено{" "}
            {graph.nodes.filter((n) => n.status === "completed").length} из {graph.nodes.length}
          </p>
          <progress
            aria-label="Прогресс плана"
            value={graph.nodes.filter((n) => n.status === "completed").length}
            max={graph.nodes.length}
          />
          <div className={styles.entry} aria-label="Автоматическое выполнение плана">
            <strong>
              {graph.execution?.status === "completed"
                ? "План выполнен"
                : automatic
                  ? "План выполняется автоматически"
                  : "Выполнить план целиком"}
            </strong>
            <p>
              Шаги идут по зависимостям последовательно. Подтверждения планов и разрешений остаются
              явными; ошибки не вызывают автоматического повтора.
            </p>
            {graph.execution?.reason && (
              <p role="status">{workDagReason(graph.execution.reason, graph)}</p>
            )}
            <p>
              Запросов модели: {graph.usage?.model_requests ?? 0}
              {graph.execution ? " из " + graph.execution.max_model_requests : ""}. Считаются и
              предыдущие попытки.
            </p>
            {!automatic &&
              !graph.archived_at &&
              graph.mode === "active" &&
              graph.nodes.some((node) => !["completed", "cancelled"].includes(node.status)) && (
                <>
                  <label>
                    Общий лимит запросов плана
                    <input
                      type="number"
                      min={3}
                      max={96}
                      value={totalLimit}
                      disabled={browsingLocked}
                      onChange={(e) => {
                        setRequestLimit(Number(e.target.value));
                        setAutoConfirmed(false);
                      }}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={autoConfirmed}
                      disabled={browsingLocked}
                      onChange={(e) => setAutoConfirmed(e.target.checked)}
                    />
                    Разрешаю выполнение оставшихся шагов в этом лимите с расходом токенов
                  </label>
                  <button
                    disabled={
                      browsingLocked ||
                      gate !== "clear" ||
                      !autoConfirmed ||
                      totalLimit < 3 ||
                      totalLimit > 96 ||
                      graph.nodes.some((node) => ["failed", "cancelled"].includes(node.status))
                    }
                    onClick={() => act("run_plan")}
                  >
                    Выполнить план
                  </button>
                </>
              )}
            {automatic && (
              <button disabled={browsingLocked} onClick={() => act("stop_plan")}>
                Остановить автозапуск
              </button>
            )}
            {graph.nodes.some((node) => node.artifacts.length) && (
              <p>
                <a href={base + "/" + graph.id + "/results"}>Скачать все результаты плана</a>
              </p>
            )}
            {!!graph.execution_waves?.length && (
              <details>
                <summary>Порядок по зависимостям</summary>
                <ol>
                  {graph.execution_waves.map((wave, i) => (
                    <li key={i}>
                      {wave
                        .map((id) => graph.nodes.find((node) => node.id === id)?.title)
                        .join(" · ")}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
          <div className={styles.actions}>
            {!graph.archived_at && graph.mode === "active" && (
              <button disabled={browsingLocked} onClick={() => act("pause")}>
                Приостановить проект
              </button>
            )}
            {!graph.archived_at && graph.mode === "paused" && (
              <button disabled={browsingLocked || gate !== "clear"} onClick={() => act("resume")}>
                Продолжить проект
              </button>
            )}
            {!graph.archived_at && graph.mode !== "cancelled" && (
              <button disabled={browsingLocked} onClick={() => act("cancel")}>
                Отменить работы проекта
              </button>
            )}
          </div>
          {gate !== "clear" && (
            <p>
              Запуски недоступны до снятия ограничений в{" "}
              <Link href={"/control-center?project=" + encodeURIComponent(projectId)}>
                Центре управления
              </Link>
              .
            </p>
          )}
          <ol className={styles.entries}>
            {graph.nodes.map((node) => (
              <li className={styles.entry} key={node.id}>
                <strong>
                  {node.title} · {statuses[node.status]}
                </strong>
                <p>{node.goal}</p>
                {node.depends_on.length > 0 && (
                  <small>
                    Зависимости:{" "}
                    {node.depends_on
                      .map((d) => graph.nodes.find((n) => n.id === d)?.title ?? d)
                      .join(", ")}
                  </small>
                )}
                {node.blocked_reason && <p>{workDagReason(node.blocked_reason, graph)}</p>}
                {node.result?.plan_summary && (
                  <details>
                    <summary>План Manager</summary>
                    <p>{node.result.plan_summary}</p>
                    <p>{node.result.plan_instructions}</p>
                  </details>
                )}
                {node.result?.review && (
                  <p>
                    Критик: {node.result.review.verdict} — {node.result.review.reason}
                  </p>
                )}
                <div className={styles.actions}>
                  {!graph.archived_at &&
                    ["pending", "blocked", "running"].includes(node.status) && (
                      <button
                        type="button"
                        disabled={browsingLocked}
                        onClick={() => {
                          setRetry(null);
                          setCancellation({
                            graphId: graph.id,
                            nodeId: node.id,
                            version: graph.version,
                            title: node.title
                          });
                        }}
                      >
                        Отменить этот шаг…
                      </button>
                    )}
                  {!graph.archived_at && node.status === "pending" && (
                    <button
                      disabled={
                        browsingLocked ||
                        graph.mode !== "active" ||
                        gate !== "clear" ||
                        Boolean(automatic)
                      }
                      onClick={() => act("run", node.id)}
                    >
                      Запустить шаг
                    </button>
                  )}
                  {!graph.archived_at &&
                    node.status === "blocked" &&
                    node.blocked_reason === "AWAITING_APPROVAL" && (
                      <button
                        disabled={browsingLocked || graph.mode !== "active" || gate !== "clear"}
                        onClick={() => act("approve_step", node.id)}
                      >
                        Подтвердить план Manager
                      </button>
                    )}
                  {!graph.archived_at &&
                    node.status === "blocked" &&
                    ["PAUSED", "DENIED", "WAITING_CONFIRMATION"].includes(
                      node.blocked_reason ?? ""
                    ) && (
                      <button
                        disabled={browsingLocked || graph.mode !== "active" || gate !== "clear"}
                        onClick={() => act("resume_step", node.id)}
                      >
                        Продолжить шаг
                      </button>
                    )}
                  {!graph.archived_at && node.status === "failed" && (
                    <button
                      disabled={browsingLocked || graph.mode !== "active" || gate !== "clear"}
                      onClick={() => {
                        setRetry(node.id);
                        setAcknowledged(false);
                      }}
                    >
                      Повторить этот шаг…
                    </button>
                  )}
                </div>
                {cancellation?.graphId === graph.id && cancellation.nodeId === node.id && (
                  <div role="group" aria-label="Подтверждение отмены шага">
                    <p>
                      Отменить «{cancellation.title}»? Автозапуск этого плана остановится. Зависимые
                      шаги останутся заблокированы, готовые результаты сохранятся. Другие шаги и
                      планы не отменяются. Уже отправленный запрос мог быть оплачен. Отменённый шаг
                      нельзя продолжить; для нового запуска создайте копию плана.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(base + "/" + cancellation.graphId + "/control", "POST", {
                          version: cancellation.version,
                          action: "cancel_step",
                          node_id: cancellation.nodeId
                        })
                      }
                    >
                      Подтвердить отмену шага
                    </button>
                    <button type="button" disabled={busy} onClick={() => setCancellation(null)}>
                      Оставить шаг
                    </button>
                  </div>
                )}
                {retry === node.id && (
                  <div>
                    <label>
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      Разрешаю новую попытку этого шага с возможным расходом токенов. Предыдущий
                      запрос мог быть оплачен.
                    </label>
                    <button
                      disabled={
                        !acknowledged || busy || gate !== "clear" || graph.mode !== "active"
                      }
                      onClick={() => act("retry", node.id)}
                    >
                      Запустить новую попытку
                    </button>
                  </div>
                )}
                <ul className={styles.artifacts}>
                  {node.artifacts.map((a) => (
                    <li key={a.id}>
                      <a
                        href={
                          "/api/v1/projects/" +
                          encodeURIComponent(projectId) +
                          "/work-artifacts/" +
                          a.id +
                          "/download"
                        }
                      >
                        {a.name} · версия {a.version}
                      </a>
                      <small>
                        Источник: Work {a.work_id}; SHA-256 {a.sha256}; {a.bytes} байт
                      </small>
                    </li>
                  ))}
                </ul>
                {node.result?.sources.map((s) => (
                  <small key={s.run_id}>
                    Источник модели: {s.provider} / {s.model}; запрос {s.run_id}; этап {s.stage}
                  </small>
                ))}
                {node.attempts.map((a) => (
                  <small key={a.work_id}>
                    Попытка {a.number}: {a.work_id} ·{" "}
                    {new Date(a.started_at).toLocaleString("ru-RU")}
                    {a.source_artifact_ids.length
                      ? " · использованные артефакты: " + a.source_artifact_ids.join(", ")
                      : ""}
                  </small>
                ))}
              </li>
            ))}
          </ol>
          <details>
            <summary>История событий и checkpoints</summary>
            <ol>
              {graph.events.map((e) => (
                <li key={e.sequence}>
                  {new Date(e.at).toLocaleString("ru-RU")} · {e.message}
                </li>
              ))}
            </ol>
            <p className={styles.checkpoint}>
              {checkpoints
                .map((c) => "v" + c.version + " — " + new Date(c.at).toLocaleString("ru-RU"))
                .join("; ")}
            </p>
          </details>
        </>
      )}
    </section>
  );
}
