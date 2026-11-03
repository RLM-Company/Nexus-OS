"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseWorkflowPackage,
  validateWorkflowDefinition,
  validateWorkflowInputs,
  type WorkflowDefinitionInput,
  type WorkflowDefinition,
  type WorkflowParameter,
  type WorkflowRun
} from "@cosmora/contracts/workflows";
import type { WorkDag } from "@cosmora/contracts";
import styles from "./work-manager.module.css";

type RunGraph = Pick<WorkDag, "id" | "mode" | "execution"> & {
  nodes: Pick<WorkDag["nodes"][number], "id" | "status">[];
};
type Run = WorkflowRun & { graph: RunGraph | null };
type Library = {
  items: WorkflowDefinition[];
  templates: { id: string; definition: WorkflowDefinitionInput }[];
};
const empty = (): WorkflowDefinitionInput => ({
  name: "Новый сценарий",
  description: "",
  parameters: [],
  nodes: [
    {
      id: "step1",
      title: "Создать результат",
      goal: "Создай result.md по задаче пользователя. Внешние действия не нужны.",
      depends_on: [],
      requires_critic: true
    }
  ],
  requirements: ["work.files.create"],
  expected_results: []
});
const inputOf = (d: WorkflowDefinitionInput): WorkflowDefinitionInput =>
  structuredClone({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    nodes: d.nodes,
    requirements: d.requirements,
    expected_results: d.expected_results
  });
const labels: Record<string, string> = {
  text: "Текст",
  number: "Число",
  boolean: "Да / нет",
  choice: "Выбор",
  file: "Документ проекта",
  link: "Ссылка"
};
const states: Record<string, string> = {
  running: "Выполняется",
  waiting: "Ожидает решения",
  paused: "На паузе",
  stopped: "Автозапуск остановлен",
  completed: "Завершён",
  failed: "Ошибка",
  pending: "Готов",
  blocked: "Ожидает",
  cancelled: "Отменён"
};
function runState(graph: RunGraph | null): string {
  if (!graph) return "План недоступен";
  if (graph.nodes.every((n) => n.status === "completed")) return states.completed!;
  if (graph.mode === "cancelled") return states.cancelled!;
  if (graph.nodes.some((n) => n.status === "failed")) return states.failed!;
  return states[graph.execution?.status ?? "pending"] ?? "Ожидает";
}
const errors: Record<string, string> = {
  STALE_WORKFLOW: "Сценарий изменился. Откройте актуальную версию.",
  WORKFLOW_ARCHIVED: "Восстановите сценарий из архива перед запуском.",
  WORKFLOW_TOOL_UNAVAILABLE: "Для этого сценария нужен пока недоступный инструмент.",
  WORKFLOW_FILE_NOT_READY: "Дождитесь завершения анализа выбранного файла.",
  WORKFLOW_FILE_NOT_FOUND: "Выберите доступный файл текущего проекта.",
  WORKFLOW_FILE_EMPTY: "В документе нет доступного текста для анализа.",
  WORKFLOW_MATERIALS_TOO_LARGE:
    "Материалы превышают допустимый объём. Разделите задачу или выберите меньший документ.",
  WORKFLOW_RENDER_TOO_LARGE: "Параметры слишком длинные для выбранных шагов.",
  OWNER_DATA_FENCED: "Сейчас выполняется операция с данными. Повторите после её завершения.",
  IDEMPOTENCY_CONFLICT: "Данные запроса изменились. Откройте сценарий заново.",
  DAG_LIMIT: "В проекте достигнут лимит сохранённых планов.",
  WORKFLOW_LIMIT: "В проекте достигнут лимит сценариев."
};
async function request<T>(
  url: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000)
  });
  const value = (await response.json()) as T & { error?: string | { code?: string } };
  if (!response.ok) {
    const code = typeof value.error === "string" ? value.error : value.error?.code;
    throw new Error(
      code && errors[code]
        ? errors[code]
        : "Не удалось выполнить действие. Проверьте данные и соединение."
    );
  }
  return value;
}
export function WorkflowPanel({ projectId }: { projectId: string }) {
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/workflows`;
  const [open, setOpen] = useState(false),
    [library, setLibrary] = useState<Library>({ items: [], templates: [] }),
    [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDefinitionInput | null>(null),
    [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [values, setValues] = useState<Record<string, string>>({}),
    [auto, setAuto] = useState(false),
    [runs, setRuns] = useState<Run[]>([]),
    [files, setFiles] = useState<{ id: string; name: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [versions, setVersions] = useState<
      { version: number; definition: WorkflowDefinitionInput; created_at: string }[]
    >([]);
  const pendingSave = useRef<{ key: string; id: string } | null>(null),
    pendingRun = useRef<{ key: string; id: string } | null>(null),
    lock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const current = library.items.find((d) => d.id === selected) ?? null;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void Promise.all([
      request<Library>(base, undefined, undefined, controller.signal),
      request<{ files: typeof files }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/document-library`,
        undefined,
        undefined,
        controller.signal
      )
    ])
      .then(([next, docs]) => {
        if (!controller.signal.aborted) {
          setLibrary(next);
          setFiles(docs.files);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Не удалось загрузить сценарии.");
      });
    return () => controller.abort();
  }, [base, open, projectId, refresh]);
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const url = base + "/" + encodeURIComponent(selected) + "/runs";
    let known = new Set<string>();
    const load = async (full: boolean) => {
      try {
        const result = await request<{ items: Run[] }>(
          url + (full ? "" : "?summary=1"),
          undefined,
          undefined,
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (!full && result.items.some((r) => !known.has(r.id))) {
          await load(true);
          return;
        }
        if (full) {
          known = new Set(result.items.map((r) => r.id));
          setRuns(result.items);
        } else
          setRuns((previous) =>
            previous.map((r) => ({
              ...r,
              graph: result.items.find((n) => n.id === r.id)?.graph ?? null
            }))
          );
        if (
          result.items.some(
            (r) =>
              r.graph?.mode === "active" &&
              r.graph.nodes.some((n) => !["completed", "failed", "cancelled"].includes(n.status))
          )
        )
          timer = setTimeout(() => void load(false), 3000);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Не удалось обновить историю.");
      }
    };
    void load(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [base, open, selected, refresh]);
  const update = (change: Partial<WorkflowDefinitionInput>) => {
    if (draft) setDraft({ ...draft, ...change });
  };
  const runAction = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? /^[A-Z][A-Z0-9_]+$/.test(e.message)
            ? (errors[e.message] ?? "Проверьте параметры и шаги сценария.")
            : e.message
          : "Не удалось выполнить действие."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reload = async () => setLibrary(await request<Library>(base));
  const save = () =>
    runAction(async () => {
      if (!draft) return;
      validateWorkflowDefinition(draft);
      const key = JSON.stringify({ editing: editing?.id, version: editing?.version, draft });
      if (pendingSave.current?.key !== key) pendingSave.current = { key, id: crypto.randomUUID() };
      const result = editing
        ? await request<WorkflowDefinition>(
            base + "/" + editing.id,
            { expected_version: editing.version, definition: draft },
            "PUT"
          )
        : await request<WorkflowDefinition>(base, {
            client_creation_id: pendingSave.current.id,
            definition: draft
          });
      pendingSave.current = null;
      setDraft(null);
      setEditing(null);
      setSelected(result.id);
      setValues({});
      await reload();
      setNotice("Сценарий сохранён.");
    });
  const launch = () =>
    runAction(async () => {
      if (!current) return;
      const inputs: Record<string, string | number | boolean> = {};
      for (const p of current.parameters) {
        const raw = values[p.id];
        if (p.type === "boolean") {
          inputs[p.id] = raw === "true";
          continue;
        }
        if (raw === undefined || raw.trim() === "") continue;
        inputs[p.id] = p.type === "number" ? Number(raw) : raw;
      }
      validateWorkflowInputs(current, inputs);
      const key = JSON.stringify({ id: current.id, version: current.version, inputs, auto });
      if (pendingRun.current?.key !== key) pendingRun.current = { key, id: crypto.randomUUID() };
      const result = await request<{ run: WorkflowRun; graph: WorkDag }>(
        base + "/" + current.id + "/runs",
        {
          client_request_id: pendingRun.current.id,
          expected_version: current.version,
          inputs,
          auto_start: auto
        }
      );
      pendingRun.current = null;
      setRefresh((v) => v + 1);
      setRuns((previous) => [
        { ...result.run, graph: result.graph },
        ...previous.filter((r) => r.id !== result.run.id)
      ]);
      setNotice(
        auto
          ? "Сценарий передан исполнителю. Прогресс — в плане ниже."
          : "План подготовлен. Просмотрите шаги перед запуском."
      );
    });
  const select = (id: string) => {
    setSelected(id);
    setValues({});
    setRuns([]);
    setVersions([]);
    setAuto(false);
    setError("");
    setDraft(null);
  };
  return (
    <details className={styles.entry} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Сценарии Koswork</summary>
      {open && (
        <section aria-label="Сохранённые сценарии Koswork">
          <p>
            Сохраните последовательность работы и запускайте её с новыми данными. Результаты
            предыдущих запусков сохраняются.
          </p>
          <p>
            Сейчас сценарии создают документы и тексты. Браузер и управление компьютером подключим
            отдельно.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
              Обновить сценарии
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setDraft(empty());
                setEditing(null);
              }}
            >
              Создать сценарий
            </button>
            <label>
              Начать с шаблона
              <select
                aria-label="Шаблон сценария"
                disabled={busy}
                value=""
                onChange={(e) => {
                  const t = library.templates.find((t) => t.id === e.target.value);
                  if (t) {
                    setDraft(inputOf(t.definition));
                    setEditing(null);
                  }
                }}
              >
                <option value="">Выберите шаблон</option>
                {library.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.definition.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Импорт JSON
              <input
                aria-label="Импорт сценария"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (f)
                    void runAction(async () => {
                      if (f.size > 64000) throw new Error("Файл сценария слишком большой.");
                      setDraft(parseWorkflowPackage(JSON.parse(await f.text())));
                      setEditing(null);
                      setNotice(
                        "Определение загружено для проверки. Сохранение и запуск выполняются отдельно."
                      );
                    });
                }}
              />
            </label>
          </div>
          <ul className={styles.entries}>
            {library.items.map((d) => (
              <li key={d.id} className={styles.entry}>
                <button
                  disabled={busy}
                  aria-pressed={selected === d.id}
                  onClick={() => select(d.id)}
                >
                  {d.name} · v{d.version}
                  {d.archived_at ? " · архив" : ""}
                </button>
              </li>
            ))}
          </ul>
          {!library.items.length && <p>Сценариев пока нет. Создайте свой или выберите шаблон.</p>}
          {draft && (
            <fieldset disabled={busy} aria-label="Редактор сценария">
              <legend>{editing ? "Редактирование сценария" : "Новый сценарий"}</legend>
              <label>
                Название
                <input
                  aria-label="Название сценария"
                  maxLength={160}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <label>
                Описание
                <textarea
                  value={draft.description}
                  maxLength={2000}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              <h4>Параметры</h4>
              {draft.parameters.map((p, index) => (
                <div key={index} className={styles.entry}>
                  <label>
                    Код параметра
                    <input
                      aria-label={`Код параметра ${index + 1}`}
                      value={p.id}
                      onChange={(e) =>
                        update({
                          parameters: draft.parameters.map((v, i) =>
                            i === index ? { ...v, id: e.target.value } : v
                          )
                        })
                      }
                    />
                  </label>
                  <label>
                    Название
                    <input
                      value={p.label}
                      onChange={(e) =>
                        update({
                          parameters: draft.parameters.map((v, i) =>
                            i === index ? { ...v, label: e.target.value } : v
                          )
                        })
                      }
                    />
                  </label>
                  <label>
                    Тип
                    <select
                      value={p.type}
                      onChange={(e) =>
                        update({
                          parameters: draft.parameters.map((v, i) =>
                            i === index
                              ? {
                                  id: v.id,
                                  label: v.label,
                                  required: v.required,
                                  type: e.target.value as WorkflowParameter["type"],
                                  ...(e.target.value === "choice" ? { choices: ["Вариант 1"] } : {})
                                }
                              : v
                          )
                        })
                      }
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.type === "choice" && (
                    <label>
                      Варианты, каждый с новой строки
                      <textarea
                        value={p.choices?.join("\n") ?? ""}
                        onChange={(e) =>
                          update({
                            parameters: draft.parameters.map((v, i) =>
                              i === index ? { ...v, choices: e.target.value.split("\n") } : v
                            )
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) =>
                        update({
                          parameters: draft.parameters.map((v, i) =>
                            i === index ? { ...v, required: e.target.checked } : v
                          )
                        })
                      }
                    />
                    Обязательный
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      update({ parameters: draft.parameters.filter((_, i) => i !== index) })
                    }
                  >
                    Удалить параметр {index + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  update({
                    parameters: [
                      ...draft.parameters,
                      {
                        id: `p${crypto.randomUUID().slice(0, 8)}`,
                        label: "Новый параметр",
                        type: "text",
                        required: true
                      }
                    ]
                  })
                }
                disabled={draft.parameters.length >= 32}
              >
                Добавить параметр
              </button>
              <h4>Шаги</h4>
              <p>
                Для подстановки параметра используйте {"{{код}}"}. Значения передаются как данные.
              </p>
              {draft.nodes.map((node, index) => (
                <div key={node.id} className={styles.entry}>
                  <label>
                    Название шага
                    <input
                      value={node.title}
                      maxLength={160}
                      onChange={(e) =>
                        update({
                          nodes: draft.nodes.map((n, i) =>
                            i === index ? { ...n, title: e.target.value } : n
                          )
                        })
                      }
                    />
                  </label>
                  <label>
                    Задача шага
                    <textarea
                      aria-label={`Задача шага сценария ${index + 1}`}
                      value={node.goal}
                      maxLength={4000}
                      onChange={(e) =>
                        update({
                          nodes: draft.nodes.map((n, i) =>
                            i === index ? { ...n, goal: e.target.value } : n
                          )
                        })
                      }
                    />
                  </label>
                  <label>
                    Зависимости
                    <select
                      multiple
                      value={node.depends_on}
                      onChange={(e) => {
                        const ids = Array.from(e.currentTarget.selectedOptions, (o) => o.value);
                        update({
                          nodes: draft.nodes.map((n, i) =>
                            i === index ? { ...n, depends_on: ids } : n
                          )
                        });
                      }}
                    >
                      {draft.nodes
                        .filter((n) => n.id !== node.id)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={node.requires_critic ?? false}
                      onChange={(e) =>
                        update({
                          nodes: draft.nodes.map((n, i) =>
                            i === index ? { ...n, requires_critic: e.target.checked } : n
                          )
                        })
                      }
                    />
                    Проверить результат критиком
                  </label>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        const nodes = [...draft.nodes];
                        [nodes[index - 1], nodes[index]] = [nodes[index]!, nodes[index - 1]!];
                        update({ nodes });
                      }}
                    >
                      Выше
                    </button>
                    <button
                      type="button"
                      disabled={index === draft.nodes.length - 1}
                      onClick={() => {
                        const nodes = [...draft.nodes];
                        [nodes[index + 1], nodes[index]] = [nodes[index]!, nodes[index + 1]!];
                        update({ nodes });
                      }}
                    >
                      Ниже
                    </button>
                    <button
                      type="button"
                      disabled={draft.nodes.length === 1}
                      onClick={() =>
                        update({
                          nodes: draft.nodes
                            .filter((_, i) => i !== index)
                            .map((n) => ({
                              ...n,
                              depends_on: n.depends_on.filter((id) => id !== node.id)
                            }))
                        })
                      }
                    >
                      Удалить шаг {index + 1}
                    </button>
                  </div>
                </div>
              ))}
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={draft.nodes.length >= 32}
                  onClick={() =>
                    update({
                      nodes: [
                        ...draft.nodes,
                        {
                          id: `s${crypto.randomUUID().slice(0, 8)}`,
                          title: "Новый шаг",
                          goal: "",
                          depends_on: []
                        }
                      ]
                    })
                  }
                >
                  Добавить шаг
                </button>
                <button type="button" onClick={() => void save()}>
                  Сохранить сценарий
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setEditing(null);
                  }}
                >
                  Закрыть редактор
                </button>
              </div>
            </fieldset>
          )}
          {current && !draft && (
            <div className={styles.entry} aria-label="Выбранный сценарий">
              <h4>
                {current.name} · версия {current.version}
              </h4>
              <p>{current.description}</p>
              <div className={styles.actions}>
                <button
                  disabled={busy || Boolean(current.archived_at)}
                  onClick={() => {
                    setDraft(inputOf(current));
                    setEditing(current);
                  }}
                >
                  Редактировать
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setDraft({
                      ...inputOf(current),
                      name: current.name.slice(0, 145) + " · копия"
                    });
                    setEditing(null);
                  }}
                >
                  Создать копию
                </button>
                <a download href={base + "/" + current.id + "/package"}>
                  Экспорт JSON
                </a>
                <button
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      await request(base + "/" + current.id + "/archive", {
                        expected_version: current.version,
                        archived: !current.archived_at
                      });
                      await reload();
                    })
                  }
                >
                  {current.archived_at ? "Восстановить сценарий" : "Архивировать сценарий"}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () =>
                      setVersions(
                        (
                          await request<{ items: typeof versions }>(
                            base + "/" + current.id + "/versions"
                          )
                        ).items
                      )
                    )
                  }
                >
                  Версии
                </button>
              </div>
              {versions.length > 0 && (
                <ul>
                  {versions.map((v) => (
                    <li key={v.version}>
                      Версия {v.version}: {v.definition.name}{" "}
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDraft(v.definition);
                          setEditing(current);
                        }}
                      >
                        Открыть как новую редакцию
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <h4>Входные данные</h4>
              {current.parameters.map((p) => (
                <label key={p.id}>
                  {p.label}
                  {p.required ? " *" : ""}
                  {p.type === "boolean" ? (
                    <select
                      aria-label={p.label}
                      aria-required={p.required}
                      value={values[p.id] ?? "false"}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    >
                      <option value="false">Нет</option>
                      <option value="true">Да</option>
                    </select>
                  ) : p.type === "choice" ? (
                    <select
                      aria-label={p.label}
                      aria-required={p.required}
                      value={values[p.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    >
                      <option value="">Выберите значение</option>
                      {p.choices?.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : p.type === "file" ? (
                    <select
                      aria-label={p.label}
                      aria-required={p.required}
                      value={values[p.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    >
                      <option value="">Выберите документ проекта</option>
                      {files.map((f) => (
                        <option key={f.id} value={f.id} disabled={f.status !== "ready"}>
                          {f.name}
                          {f.status !== "ready" ? " · обрабатывается" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      value={values[p.id] ?? ""}
                      maxLength={2000}
                      onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                      aria-label={p.label}
                    />
                  )}
                </label>
              ))}
              <p>
                Шаги: {current.nodes.map((n) => n.title).join(" → ")}. Подтверждения и доступы
                проверяются при выполнении.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={auto}
                  disabled={busy || Boolean(current.archived_at)}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                Начать выполнение сразу; запросы модели расходуют токены
              </label>
              <button disabled={busy || Boolean(current.archived_at)} onClick={() => void launch()}>
                {auto ? "Запустить сценарий" : "Подготовить план сценария"}
              </button>
              <h4>История запусков</h4>
              {!runs.length && <p>Запусков пока нет.</p>}
              <ul className={styles.entries}>
                {runs.map((r) => (
                  <li key={r.id} className={styles.entry}>
                    <strong>Версия {r.definition_version}</strong> ·{" "}
                    {new Date(r.created_at).toLocaleString("ru-RU")}
                    <p>{runState(r.graph)}</p>
                    <details>
                      <summary>Входные данные запуска</summary>
                      <dl>
                        {r.definition.parameters
                          .filter((p) => Object.hasOwn(r.inputs, p.id))
                          .map((p) => (
                            <div key={p.id}>
                              <dt>{p.label}</dt>
                              <dd>
                                {p.type === "file"
                                  ? (files.find((f) => f.id === r.inputs[p.id])?.name ??
                                    "Документ сохранён в материалах плана")
                                  : p.type === "boolean"
                                    ? r.inputs[p.id]
                                      ? "Да"
                                      : "Нет"
                                    : String(r.inputs[p.id])}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                    <button
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("kosmora:open-work-plan", {
                            detail: { projectId, id: r.dag_id }
                          })
                        )
                      }
                    >
                      Открыть выполнение в плане ниже
                    </button>
                    {r.graph?.nodes.every((n) => n.status === "completed") && (
                      <a
                        download
                        href={`/api/v1/projects/${encodeURIComponent(projectId)}/work-dags/${r.dag_id}/results.zip`}
                      >
                        Скачать результаты
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </details>
  );
}
