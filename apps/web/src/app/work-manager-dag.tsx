"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  DEPENDENCIES_INCOMPLETE: "Зависимости не завершены",
  DAG_NOT_BOUND: "Подготовленная попытка ещё не привязана к графу"
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
  graph.nodes.map(({ id, title, goal, depends_on }) => ({ id, title, goal, depends_on }));
const freshStep = (): WorkDagNodeInput => ({
  id: "step_" + crypto.randomUUID().slice(0, 8),
  title: "",
  goal: "",
  depends_on: []
});

export function WorkManagerDag({ projectId }: { projectId: string }) {
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/work-dags";
  const gate = useExecutionGate(projectId);
  const [graphs, setGraphs] = useState<WorkDag[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    graphId: string | null;
    version: number;
    title: string;
    nodes: WorkDagNodeInput[];
    requestId: string;
  } | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkpoints, setCheckpoints] = useState<{ version: number; at: string }[]>([]);
  const lock = useRef(false),
    epoch = useRef(0);
  const graph = graphs.find((g) => g.id === selected) ?? graphs[0] ?? null;
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: "no-store" });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(reasons[data.error ?? ""] ?? data.error ?? "Не удалось выполнить запрос");
    }
    return response.json() as Promise<T>;
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const before = epoch.current;
      try {
        const data = await request<{ items: WorkDag[] }>(base, { signal: controller.signal });
        if (!controller.signal.aborted && before === epoch.current && !lock.current)
          setGraphs(data.items);
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
    try {
      const result = await request<WorkDag>(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      setGraphs((current) => [result, ...current.filter((g) => g.id !== result.id)]);
      setSelected(result.id);
      setEditor(null);
      setRetry(null);
      setAcknowledged(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка действия");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function act(action: WorkDagControl["action"], nodeId?: string) {
    if (
      !graph ||
      (["run", "retry", "resume", "resume_step", "approve_step"].includes(action) &&
        gate !== "clear")
    )
      return;
    void mutate(base + "/" + graph.id + "/control", "POST", {
      version: graph.version,
      action,
      ...(nodeId ? { node_id: nodeId } : {}),
      ...(action === "retry" ? { acknowledge_cost: true } : {})
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
        Создайте шаги и зависимости, затем запускайте готовые шаги. Каждый шаг создаёт файлы через
        Manager: до 3 запросов, 32 000 входных и 6 000 выходных токенов. Повторы запускаются
        вручную.
      </p>
      <div className={styles.actions}>
        <button
          disabled={busy || Boolean(editor)}
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
            disabled={busy || Boolean(editor) || graph.mode === "cancelled"}
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
        <label>
          Сохранённые планы
          <select
            value={graph?.id ?? ""}
            disabled={busy || Boolean(editor)}
            onChange={(e) => {
              setSelected(e.target.value);
              setRetry(null);
              setAcknowledged(false);
            }}
          >
            {graphs.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
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
            const started = Boolean(
              graph?.id === editor.graphId &&
              graph.nodes.find((n) => n.id === node.id)?.attempts.length
            );
            return (
              <fieldset key={node.id} disabled={started || busy} className={styles.dagStep}>
                <legend>
                  Шаг {index + 1}
                  {started ? " · уже запущен" : ""}
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
      {graph && (
        <>
          <h4>{graph.title}</h4>
          <p>
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
          <div className={styles.actions}>
            {graph.mode === "active" && (
              <button disabled={busy} onClick={() => act("pause")}>
                Приостановить проект
              </button>
            )}
            {graph.mode === "paused" && (
              <button disabled={busy || gate !== "clear"} onClick={() => act("resume")}>
                Продолжить проект
              </button>
            )}
            {graph.mode !== "cancelled" && (
              <button disabled={busy} onClick={() => act("cancel")}>
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
                  {node.status === "pending" && (
                    <button
                      disabled={busy || graph.mode !== "active" || gate !== "clear"}
                      onClick={() => act("run", node.id)}
                    >
                      Запустить шаг
                    </button>
                  )}
                  {node.status === "blocked" && node.blocked_reason === "AWAITING_APPROVAL" && (
                    <button
                      disabled={busy || graph.mode !== "active" || gate !== "clear"}
                      onClick={() => act("approve_step", node.id)}
                    >
                      Подтвердить план Manager
                    </button>
                  )}
                  {node.status === "blocked" &&
                    ["PAUSED", "DENIED", "WAITING_CONFIRMATION"].includes(
                      node.blocked_reason ?? ""
                    ) && (
                      <button
                        disabled={busy || graph.mode !== "active" || gate !== "clear"}
                        onClick={() => act("resume_step", node.id)}
                      >
                        Продолжить шаг
                      </button>
                    )}
                  {node.status === "failed" && (
                    <button
                      disabled={busy || graph.mode !== "active" || gate !== "clear"}
                      onClick={() => {
                        setRetry(node.id);
                        setAcknowledged(false);
                      }}
                    >
                      Повторить этот шаг…
                    </button>
                  )}
                </div>
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
