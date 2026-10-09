"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./code-agent.module.css";
import { codeAgentUnifiedDiff } from "./unified-diff";

type FileChange = { path: string; before: string | null; content: string };
type Run = {
  id: string;
  status: string;
  task: string;
  base_branch: string;
  base_sha: string;
  proposal_hash?: string;
  publication_token?: string;
  proposal?: FileChange[];
  summary?: string;
  error?: string;
  draft?: {
    id: string;
    status: string;
    pr_url?: string | null;
    plan: {
      review_hash: string;
      branch: string;
      title: string;
      files: FileChange[];
    };
  };
  check?: {
    status: string;
    review_hash: string;
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    journal?: unknown;
    snapshotDigest?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
    unknown_attempts: number;
    known_costs: Array<{ currency: string; amount: number }>;
    owner_budget_connected: boolean;
  };
  log: Array<{ at: string; event: string }>;
};
type Edit = FileChange & { selected: boolean };
const labels: Record<string, string> = {
  running: "Чтение репозитория и подготовка изменений",
  proposed: "Изменения предложены",
  review: "Просмотр сохранён",
  checking: "Проверка выполняется",
  checked: "Проверка завершена",
  publishing: "Создание черновика PR",
  published: "Черновик PR создан",
  uncertain: "Результат отправки требует сверки",
  failed: "Операция завершилась ошибкой",
  cancelled: "Отменено"
};
const errors: Record<string, string> = {
  OWNER_BUDGET_LIMIT:
    "Общий бюджет владельца не разрешает новый запрос. Проверьте расходы и удержанные резервы.",
  EXECUTION_CANCELLING: "Останавливаем проверку. Дождитесь подтверждения остановки контейнера.",
  POLICY_DENIED: "Политика проекта запрещает это действие на текущем уровне автономии.",
  UNAUTHORIZED: "Вход истёк. Войдите в Kosmora и обновите страницу.",
  GITHUB_NOT_CONFIGURED: "GitHub ещё не подключён на сервере.",
  GITHUB_BASE_CHANGED: "Базовая ветка изменилась. Создайте новую задачу на актуальной версии.",
  EMERGENCY_STOP_ACTIVE: "Действие остановлено аварийным выключателем.",
  CODE_AGENT_EXECUTOR_UNAVAILABLE:
    "Изолированный исполнитель недоступен на сервере. Проверка не запускалась."
};
class ApiFailure extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(65_000)
  }).catch(() => {
    throw new Error(
      "Нет ответа сервера. Обновите состояние операции; повторная отправка автоматически не выполняется."
    );
  });
  const data: unknown = await response.json().catch(() => {
    throw new Error("Ответ сервера не удалось прочитать. Обновите состояние операции.");
  });
  if (!response.ok) {
    const failure = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiFailure(
      errors[failure?.error?.code ?? ""] ??
        failure?.error?.message ??
        "Операция отклонена сервером.",
      failure?.error?.code ?? "UNKNOWN"
    );
  }
  return data as T;
}
function publicationKey(project: string, run: string) {
  return `kosmora-code-publish:${project}:${run}`;
}
function failureMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Операция не завершена.";
}
const pendingPublications = new Set<string>();
function storedUncertainty(project: string, run: string): boolean {
  const key = publicationKey(project, run);
  if (pendingPublications.has(key)) return true;
  try {
    return localStorage.getItem(key) === "pending";
  } catch {
    return false;
  }
}
function markPublication(project: string, run: string, pending: boolean) {
  const key = publicationKey(project, run);
  if (pending) pendingPublications.add(key);
  else pendingPublications.delete(key);
  try {
    if (pending) localStorage.setItem(key, "pending");
    else localStorage.removeItem(key);
  } catch {
    /* In-memory guard remains active. */
  }
}

export default function CodeAgentPage() {
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [connection, setConnection] = useState<{
    configured: boolean;
    repository: string;
    default_branch: string;
  } | null>(null);
  const [project, setProject] = useState("");
  const [branch, setBranch] = useState("");
  const [task, setTask] = useState("");
  const [paths, setPaths] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkType, setCheckType] = useState("syntax");
  const [checkApproved, setCheckApproved] = useState(false);
  const [publishApproved, setPublishApproved] = useState(false);
  const [unknownPublish, setUnknownPublish] = useState(false);
  const proposalIdentity = useRef("");
  const approvalIdentity = useRef("");
  const epoch = useRef(0);
  const activeRun = useRef<string | null>(null);
  const requestBusy = useRef(false);
  const root = `/api/v1/projects/${encodeURIComponent(project)}/code-agent`;

  function accept(value: Run, restore = false) {
    setRun(value);
    activeRun.current = value.id;
    setRuns((current) => [value, ...current.filter((item) => item.id !== value.id)]);
    const approvalVersion = `${value.id}:${value.draft?.plan.review_hash ?? ""}:${value.publication_token ?? ""}`;
    if (approvalIdentity.current !== approvalVersion) {
      approvalIdentity.current = approvalVersion;
      setCheckApproved(false);
      setPublishApproved(false);
    }
    const identity = `${value.id}:${value.proposal_hash ?? ""}`;
    if (restore || proposalIdentity.current !== identity) {
      proposalIdentity.current = identity;
      const selected = value.draft?.plan.files;
      setEdits(
        (value.proposal ?? []).map((file) => ({
          ...file,
          content: selected?.find((item) => item.path === file.path)?.content ?? file.content,
          selected: !selected || selected.some((item) => item.path === file.path)
        }))
      );
      setCheckApproved(false);
      setPublishApproved(false);
      setUnknownPublish(storedUncertainty(project, value.id));
    }
    if (value.status === "published") {
      markPublication(project, value.id, false);
      setUnknownPublish(false);
    }
  }

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<{ items: typeof projects }>("/api/v1/projects"),
      api<NonNullable<typeof connection>>("/api/v1/github/status")
    ])
      .then(([list, status]) => {
        if (!alive) return;
        setProjects(list.items);
        setConnection(status);
        setBranch(status.default_branch ?? "main");
        setProject(list.items[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (alive) setError(failureMessage(reason));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const requestEpoch = ++epoch.current;
    activeRun.current = null;
    proposalIdentity.current = "";
    approvalIdentity.current = "";
    setRun(null);
    setRuns([]);
    setEdits([]);
    setError(null);
    setUnknownPublish(false);
    setCheckApproved(false);
    setPublishApproved(false);
    if (!project) return;
    void api<{ items: Run[] }>(root)
      .then((list) => {
        if (epoch.current !== requestEpoch) return;
        setRuns(list.items);
        if (list.items[0]) accept(list.items[0], true);
      })
      .catch((reason: unknown) => {
        if (epoch.current === requestEpoch) setError(failureMessage(reason));
      });
  }, [project]); // Project scope changes invalidate all outstanding reads.

  useEffect(() => {
    if (!run || !["running", "checking", "publishing"].includes(run.status)) return;
    let alive = true;
    const requestEpoch = epoch.current;
    const id = run.id;
    const timer = setInterval(() => {
      if (requestBusy.current) return;
      void api<Run>(`${root}/${encodeURIComponent(id)}`)
        .then((value) => {
          if (alive && epoch.current === requestEpoch && activeRun.current === id) accept(value);
        })
        .catch((reason: unknown) => {
          if (alive) setError(failureMessage(reason));
        });
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project, run?.id, run?.status]);

  async function action(operation: () => Promise<Run>, reconcile = false) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await operation();
      accept(value);
      if (reconcile && !["uncertain", "publishing"].includes(value.status)) {
        markPublication(project, value.id, false);
        setUnknownPublish(false);
      }
      setCheckApproved(false);
      setPublishApproved(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Операция не завершена.");
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
  }

  const selected = edits.filter((file) => file.selected);
  const diffPreview = useMemo(
    () => codeAgentUnifiedDiff(edits.filter((file) => file.selected)),
    [edits]
  );
  const review = run?.draft?.plan;
  const matchesReview =
    !!review &&
    selected.length === review.files.length &&
    selected.every((file) =>
      review.files.some((item) => item.path === file.path && item.content === file.content)
    );
  const checkingPassed =
    run?.status === "checked" &&
    !!run.publication_token &&
    run.check?.status === "passed" &&
    run.check.review_hash === review?.review_hash &&
    matchesReview;
  const editable =
    !!run &&
    ["proposed", "review", "checked", "failed"].includes(run.status) &&
    !unknownPublish &&
    !busy;
  const needsReconciliation =
    !!run && (unknownPublish || ["uncertain", "publishing"].includes(run.status));
  function edit(index: number, update: Partial<Edit>) {
    setEdits((current) => current.map((file, i) => (i === index ? { ...file, ...update } : file)));
    setCheckApproved(false);
    setPublishApproved(false);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Kosmora / инструменты</p>
          <h1>Code-агент</h1>
          <p>Задача → просмотр изменений → разрешённая проверка → черновик PR</p>
        </div>
        <Link href="/github">GitHub</Link>
      </header>
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
      <section className={styles.panel} aria-label="Новая задача">
        <div className={styles.fields}>
          <label>
            Проект
            <select
              value={project}
              disabled={busy}
              onChange={(event) => setProject(event.target.value)}
            >
              <option value="">Выберите проект</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Разрешённый репозиторий
            <input readOnly value={connection?.repository ?? ""} />
          </label>
          <label>
            Базовая ветка
            <input value={branch} onChange={(event) => setBranch(event.target.value)} />
          </label>
        </div>
        {connection && !connection.configured && (
          <p role="status">Для этой задачи нужно серверное подключение GitHub.</p>
        )}
        <label>
          Задача
          <textarea
            rows={3}
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Исправь баг: опиши ожидаемое поведение и как воспроизвести ошибку"
          />
        </label>
        <label>
          Файлы для чтения (необязательно, один путь на строку)
          <textarea
            rows={2}
            value={paths}
            onChange={(event) => setPaths(event.target.value)}
            placeholder="src/example.js"
          />
        </label>
        <p className={styles.muted}>
          Агент читает только подключённый репозиторий. Публикация и запуск проверки требуют
          отдельного подтверждения.
        </p>
        <button
          className={styles.primary}
          disabled={busy || !project || !connection?.configured || !task.trim() || !branch.trim()}
          onClick={() =>
            void action(() =>
              api<Run>(root, {
                task: task.trim(),
                base_branch: branch.trim(),
                ...(paths.trim()
                  ? {
                      files: paths
                        .split(/\r?\n/)
                        .map((path) => path.trim())
                        .filter(Boolean)
                    }
                  : {})
              })
            )
          }
        >
          Предложить исправление
        </button>
      </section>

      {runs.length > 0 && (
        <label className={styles.history}>
          Сохранённые задачи
          <select
            value={run?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              const value = runs.find((item) => item.id === event.target.value);
              if (value) accept(value, true);
            }}
          >
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.task.slice(0, 90)} — {labels[item.status] ?? item.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {run && (
        <>
          <section className={styles.panel} aria-label="Состояние задачи">
            <div className={styles.row}>
              <div>
                <h2>{run.task}</h2>
                <p role="status">{labels[run.status] ?? run.status}</p>
              </div>
              <button
                disabled={busy}
                onClick={() => void action(() => api<Run>(`${root}/${encodeURIComponent(run.id)}`))}
              >
                Обновить состояние
              </button>
              {["running", "checking"].includes(run.status) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(() => api<Run>(`${root}/${encodeURIComponent(run.id)}/cancel`, {}))
                  }
                >
                  Отменить операцию
                </button>
              )}
            </div>
            <p className={styles.muted}>
              Основа: {run.base_branch} · {run.base_sha || "ожидает чтения"}
            </p>
            {run.summary && <p>{run.summary}</p>}
            {run.usage && (
              <p className={styles.muted}>
                Учтённые токены: {run.usage.input_tokens} входящих / {run.usage.output_tokens}{" "}
                исходящих.
                {run.usage.known_costs.map((cost) => ` Расход: ${cost.amount} ${cost.currency}.`)}
                {run.usage.unknown_attempts > 0 &&
                  ` Расход не подтверждён для ${run.usage.unknown_attempts} запросов; резерв сохраняется при подключённом общем бюджете.`}
                {!run.usage.owner_budget_connected && " Общий бюджет владельца пока не подключён."}
              </p>
            )}
            {run.error && <p role="alert">{errors[run.error] ?? run.error}</p>}
          </section>

          {edits.length > 0 && (
            <section className={styles.panel} aria-label="Просмотр изменений">
              <h2>1. Выберите изменения</h2>
              <p className={styles.muted}>
                Снимите выбор с ненужных файлов. Можно изменить итоговый текст, чтобы принять
                отдельные изменения. Затем сохраните просмотр.
              </p>
              {edits.map((file, index) => (
                <article className={styles.file} key={file.path}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={file.selected}
                      disabled={!editable}
                      onChange={(event) => edit(index, { selected: event.target.checked })}
                    />
                    {file.path}
                  </label>
                  <div className={styles.diff}>
                    <div>
                      <h3>− До изменения{file.before === null ? " (новый файл)" : ""}</h3>
                      <pre>{file.before ?? "Файл отсутствует"}</pre>
                    </div>
                    <label>
                      + Итоговое содержимое: {file.path}
                      <textarea
                        rows={Math.min(18, Math.max(4, file.content.split("\n").length))}
                        spellCheck={false}
                        value={file.content}
                        disabled={!editable || !file.selected}
                        onChange={(event) => edit(index, { content: event.target.value })}
                      />
                    </label>
                  </div>
                </article>
              ))}
              <details aria-label="Unified diff">
                <summary>Unified diff</summary>
                <p className={styles.muted}>
                  Полные замены выбранных файлов; предпросмотр учитывает текущий текст редактора.
                </p>
                {diffPreview.limited ? (
                  <p role="status">
                    Объём изменений превышает лимит предпросмотра diff. Выберите меньше файлов.
                  </p>
                ) : (
                  <pre>{diffPreview.text || "Нет выбранных изменений."}</pre>
                )}
              </details>
              <button
                disabled={!editable || !selected.length || matchesReview}
                onClick={() =>
                  void action(() =>
                    api<Run>(`${root}/${encodeURIComponent(run.id)}/review`, {
                      proposal_hash: run.proposal_hash,
                      files: selected.map(({ path, content }) => ({ path, content }))
                    })
                  )
                }
              >
                Сохранить выбранные изменения
              </button>
              {review && (
                <p className={styles.muted}>
                  {matchesReview
                    ? "Просмотр соответствует выбранным изменениям."
                    : "Правки изменены. Сохраните новый просмотр и повторите проверку."}
                </p>
              )}
            </section>
          )}

          {review && (
            <section className={styles.panel} aria-label="Проверка и публикация">
              <h2>2. Запустите разрешённую проверку</h2>
              <label>
                Проверка
                <select
                  value={checkType}
                  disabled={busy || !editable}
                  onChange={(event) => {
                    setCheckType(event.target.value);
                    setCheckApproved(false);
                  }}
                >
                  <option value="syntax">Синтаксис JavaScript (node --check)</option>
                  <option value="node-test">Тесты Node.js (node --test)</option>
                </select>
              </label>
              <p className={styles.muted}>
                Исполнитель использует отдельный ограниченный workspace без сети. Лимиты времени и
                вывода применяются сервером.
              </p>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={checkApproved}
                  disabled={!editable || !matchesReview}
                  onChange={(event) => setCheckApproved(event.target.checked)}
                />
                Разрешаю запуск выбранной проверки для этих изменений
              </label>
              <button
                disabled={!editable || !matchesReview || !checkApproved}
                onClick={() =>
                  void action(() =>
                    api<Run>(`${root}/${encodeURIComponent(run.id)}/check`, {
                      review_hash: review.review_hash,
                      check: checkType,
                      approve: true
                    })
                  )
                }
              >
                {run.check && run.check.status !== "passed"
                  ? "Повторить проверку"
                  : "Запустить проверку"}
              </button>
              {run.check && (
                <div aria-label="Результат проверки">
                  <p>
                    Результат:{" "}
                    {run.check.status === "passed"
                      ? "Успешно"
                      : run.check.status === "failed"
                        ? "Ошибка"
                        : run.check.status === "unavailable"
                          ? "Исполнитель недоступен. Проверьте подключение и повторите проверку."
                          : run.check.status === "timed_out"
                            ? "Превышен лимит времени. Можно повторить проверку с новым подтверждением."
                            : run.check.status === "cancelled"
                              ? "Проверка отменена. Можно повторить её с новым подтверждением."
                              : run.check.status}
                  </p>
                  <pre>{run.check.stdout || "Нет стандартного вывода"}</pre>
                  {run.check.stderr && <pre>{run.check.stderr}</pre>}
                  {run.check.truncated && <p>Вывод ограничен серверным лимитом.</p>}
                  {run.check.journal !== undefined && (
                    <details>
                      <summary>Журнал исполнителя</summary>
                      <pre>{JSON.stringify(run.check.journal, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
              <hr />
              <h2>3. Создайте черновик PR</h2>
              <p>
                Ветка: <code>{review.branch}</code>
              </p>
              <p>Заголовок: {review.title}</p>
              <ul>
                {review.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                  </li>
                ))}
              </ul>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={publishApproved}
                  disabled={busy || !checkingPassed || needsReconciliation}
                  onChange={(event) => setPublishApproved(event.target.checked)}
                />
                Подтверждаю создание этой ветки и черновика PR с перечисленными проверенными файлами
              </label>
              <button
                className={styles.primary}
                disabled={busy || !checkingPassed || !publishApproved || needsReconciliation}
                onClick={() => {
                  markPublication(project, run.id, true);
                  setUnknownPublish(true);
                  void action(() =>
                    api<Run>(`${root}/${encodeURIComponent(run.id)}/publish`, {
                      review_hash: review.review_hash,
                      publication_token: run.publication_token,
                      approve: true
                    }).catch((reason: unknown) => {
                      if (reason instanceof ApiFailure && reason.code === "UNAUTHORIZED") {
                        markPublication(project, run.id, false);
                        setUnknownPublish(false);
                      }
                      throw reason;
                    })
                  );
                }}
              >
                Создать черновик PR в GitHub
              </button>
              {needsReconciliation && (
                <div className={styles.notice}>
                  <p>
                    Исход отправки неизвестен. Сверьте состояние с GitHub перед дальнейшими
                    действиями.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () => api<Run>(`${root}/${encodeURIComponent(run.id)}/reconcile`, {}),
                        true
                      )
                    }
                  >
                    Сверить результат с GitHub
                  </button>
                </div>
              )}
              {run.status === "published" &&
                run.draft?.pr_url &&
                /^https:\/\/github\.com\//.test(run.draft.pr_url) && (
                  <p>
                    <a href={run.draft.pr_url} target="_blank" rel="noopener noreferrer">
                      Открыть созданный PR
                    </a>
                  </p>
                )}
            </section>
          )}
          <section className={styles.panel}>
            <details>
              <summary>Журнал задачи</summary>
              <ol>
                {(run.log ?? []).map((item, index) => (
                  <li key={`${item.at}:${index}`}>
                    <time>{item.at}</time> · {item.event}
                  </li>
                ))}
              </ol>
            </details>
          </section>
        </>
      )}
    </main>
  );
}
