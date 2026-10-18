"use client";

import Link from "next/link";
import { TerminalOutput } from "../ui/terminal-output";
import { CodePatchEditor } from "./patch-editor";
import { codePatchMessages, type CodePatchPreview } from "./patch-client";
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
  context_files?: Array<{ path: string; size_bytes: number }>;
  proposal_diff?: string;
  proposal_snapshot_digest?: string;
  proposal_normalizations?: Array<{ path: string; line: number; before: string; after: string }>;
  proposal_check?: {
    status: string;
    snapshotDigest: string;
    stdout: string;
    stderr: string;
    truncated: boolean;
    cleanupVerified?: boolean;
  };
  patch_diagnostic?: { code: string; path?: string; line?: number };
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
  ...codePatchMessages,
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
  const projectAttempt = useRef<string | null>(null);
  const [paths, setPaths] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkType, setCheckType] = useState("syntax");
  const [autoCheck, setAutoCheck] = useState(false);
  const [proofDirty, setProofDirty] = useState(false);
  const invalidation = useRef<Promise<void> | null>(null);
  const editingInvalidated = useRef(false);
  const linkedRun = useRef<string | null>(null);
  const [checkApproved, setCheckApproved] = useState(false);
  const [publishApproved, setPublishApproved] = useState(false);
  const [unknownPublish, setUnknownPublish] = useState(false);
  const proposalIdentity = useRef("");
  const approvalIdentity = useRef("");
  const epoch = useRef(0);
  const activeRun = useRef<string | null>(null);
  const requestBusy = useRef(false);
  const createAttempt = useRef<{ signature: string; id: string } | null>(null);
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
      editingInvalidated.current = false;
      setProofDirty(false);
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
        const query = new URLSearchParams(window.location.search);
        linkedRun.current = query.get("run");
        setProject(
          list.items.find((item) => item.id === query.get("project"))?.id ?? list.items[0]?.id ?? ""
        );
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
        const desired = list.items.find((item) => item.id === linkedRun.current) ?? list.items[0];
        if (desired) accept(desired, true);
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

  async function createProject() {
    if (requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setError(null);
    projectAttempt.current ??= crypto.randomUUID();
    try {
      const result = await api<{ project: { id: string; title: string } }>(
        "/api/v1/code-projects",
        {
          client_project_id: projectAttempt.current,
          title: "Code-проект",
          approve_local_execution: true
        }
      );
      setProjects((current) => [
        ...current.filter((p) => p.id !== result.project.id),
        result.project
      ]);
      setProject(result.project.id);
      projectAttempt.current = null;
    } catch (reason) {
      setError(failureMessage(reason));
    } finally {
      requestBusy.current = false;
      setBusy(false);
    }
  }

  async function action(operation: () => Promise<Run>, reconcile = false) {
    if (requestBusy.current) return;
    requestBusy.current = true;
    const actionEpoch = epoch.current;
    setBusy(true);
    setError(null);
    try {
      const value = await operation();
      if (epoch.current !== actionEpoch) return;
      accept(value);
      if (reconcile && !["uncertain", "publishing"].includes(value.status)) {
        markPublication(project, value.id, false);
        setUnknownPublish(false);
      }
      setCheckApproved(false);
      setPublishApproved(false);
    } catch (reason) {
      if (epoch.current === actionEpoch)
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
    !proofDirty &&
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
  function invalidateProof(): Promise<void> {
    setProofDirty(true);
    setCheckApproved(false);
    setPublishApproved(false);
    if (editingInvalidated.current) return invalidation.current ?? Promise.resolve();
    if (!run?.proposal_hash) return Promise.resolve();
    editingInvalidated.current = true;
    const id = run.id,
      requestEpoch = epoch.current;
    const pending = api<Run>(`${root}/${encodeURIComponent(id)}/invalidate-review`, {
      proposal_hash: run.proposal_hash
    })
      .then((value) => {
        if (epoch.current === requestEpoch && activeRun.current === id) accept(value);
      })
      .catch((e: unknown) => {
        editingInvalidated.current = false;
        setError(e instanceof Error ? e.message : "Не удалось отменить старую проверку.");
        throw e;
      })
      .finally(() => {
        if (invalidation.current === pending) invalidation.current = null;
      });
    invalidation.current = pending;
    return pending;
  }
  function applyPreview(preview: CodePatchPreview) {
    setEdits((current) =>
      current.map((file) => {
        const changed = preview.files.find((f) => f.path === file.path);
        return changed
          ? { ...file, content: changed.content, selected: true }
          : { ...file, selected: false };
      })
    );
    setProofDirty(true);
    setCheckApproved(false);
    setPublishApproved(false);
  }
  function edit(index: number, update: Partial<Edit>) {
    void invalidateProof().catch(() => undefined);
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
        <button disabled={busy || !connection?.configured} onClick={() => void createProject()}>
          Новый Code-проект
        </button>
        <p className={styles.muted}>
          Новый Code-проект разрешает локальную работу уровня A2. Создание ветки и PR подтверждается
          отдельно.
        </p>
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
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={autoCheck}
            disabled={busy}
            onChange={(event) => setAutoCheck(event.target.checked)}
          />{" "}
          Разрешаю после предложения автоматически выполнить выбранную ниже проверку для точного
          снимка без сети
        </label>
        {autoCheck && (
          <label>
            Автоматическая проверка
            <select
              value={checkType}
              disabled={busy}
              onChange={(event) => setCheckType(event.target.value)}
            >
              <option value="syntax">Синтаксис Node.js</option>
              <option value="node-test">Тесты Node.js</option>
            </select>
          </label>
        )}
        <button
          className={styles.primary}
          disabled={busy || !project || !connection?.configured || !task.trim() || !branch.trim()}
          onClick={() =>
            void action(async () => {
              const input = {
                task: task.trim(),
                base_branch: branch.trim(),
                ...(autoCheck ? { auto_check: { check: checkType, approve: true } } : {}),
                ...(paths.trim()
                  ? {
                      files: paths
                        .split(/\r?\n/)
                        .map((p) => p.trim())
                        .filter(Boolean)
                    }
                  : {})
              };
              const signature = JSON.stringify([project, input]);
              if (createAttempt.current?.signature !== signature)
                createAttempt.current = { signature, id: crypto.randomUUID() };
              const id = createAttempt.current.id;
              let value: Run;
              try {
                value = await api<Run>(root, { ...input, client_request_id: id });
              } catch (cause) {
                try {
                  value = await api<Run>(root + "/by-request/" + encodeURIComponent(id));
                } catch {
                  throw cause;
                }
              }
              createAttempt.current = null;
              return value;
            })
          }
        >
          {autoCheck ? "Предложить и проверить исправление" : "Предложить исправление"}
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
            {!!run.context_files?.length && (
              <details>
                <summary>Прочитанный контекст: {run.context_files.length} файлов</summary>
                <ul>
                  {run.context_files.map((file) => (
                    <li key={file.path}>
                      <code>{file.path}</code> · {file.size_bytes} байт
                    </li>
                  ))}
                </ul>
              </details>
            )}
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
            {run.error && (
              <p role="alert">
                {errors[run.error] ?? run.error}
                {run.patch_diagnostic?.path
                  ? ` Файл: ${run.patch_diagnostic.path}, строка diff: ${run.patch_diagnostic.line ?? "—"}.`
                  : ""}
              </p>
            )}
            {run.proposal_snapshot_digest && (
              <p className={styles.muted}>
                Исходный снимок: <code>{run.proposal_snapshot_digest}</code>
              </p>
            )}
            {!!run.proposal_normalizations?.length && (
              <details>
                <summary>
                  Безопасно исправлены счётчики hunk: {run.proposal_normalizations.length}
                </summary>
                <pre>
                  {run.proposal_normalizations
                    .map((n) => `${n.path}:${n.line}\n${n.before}\n${n.after}`)
                    .join("\n")}
                </pre>
                <p>Пути, позиции и строки файлов не изменялись при нормализации.</p>
              </details>
            )}
            {run.proposal_check && (
              <div aria-label="Автоматическая проверка предложения">
                <p role="status">
                  {run.proposal_check.status === "passed"
                    ? "Автоматическая проверка успешна; публикация ожидает review владельца."
                    : run.proposal_check.status === "unavailable"
                      ? "Executor недоступен. Можно повторить выбранную проверку без модели."
                      : run.proposal_check.status === "timed_out"
                        ? "Превышен лимит времени. Можно повторить проверку."
                        : run.proposal_check.status === "cancelled"
                          ? "Проверка отменена."
                          : "Проверка не подтвердила исправление."}
                </p>
                <p>
                  Проверенный снимок: <code>{run.proposal_check.snapshotDigest}</code>
                </p>
                <TerminalOutput
                  stdout={run.proposal_check.stdout}
                  stderr={run.proposal_check.stderr}
                  status={run.proposal_check.status}
                  truncated={run.proposal_check.truncated}
                />
              </div>
            )}
            {run.proposal && !run.draft && editable && (
              <div>
                <label>
                  Проверка предложения
                  <select
                    value={checkType}
                    disabled={busy || proofDirty}
                    onChange={(event) => {
                      setCheckType(event.target.value);
                      setCheckApproved(false);
                    }}
                  >
                    <option value="syntax">Синтаксис Node.js</option>
                    <option value="node-test">Тесты Node.js</option>
                  </select>
                </label>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={checkApproved}
                    disabled={busy || proofDirty}
                    onChange={(event) => setCheckApproved(event.target.checked)}
                  />
                  Разрешаю проверку исходного предложения на точном снимке
                </label>
                <button
                  disabled={busy || proofDirty || !checkApproved}
                  onClick={() =>
                    void action(() =>
                      api<Run>(`${root}/${encodeURIComponent(run.id)}/proposal-check`, {
                        proposal_hash: run.proposal_hash,
                        check: checkType,
                        approve: true
                      })
                    )
                  }
                >
                  {run.proposal_check
                    ? "Повторить выбранную проверку без модели"
                    : "Проверить предложение без модели"}
                </button>
                {proofDirty && (
                  <p>Правки изменены. Сохраните просмотр, затем проверьте выбранные изменения.</p>
                )}
              </div>
            )}
          </section>

          {edits.length > 0 && (
            <section className={styles.panel} aria-label="Просмотр изменений">
              <h2>1. Выберите изменения</h2>
              <p className={styles.muted}>
                Снимите выбор с ненужных файлов. Можно изменить итоговый текст, чтобы принять
                отдельные изменения. Затем сохраните просмотр.
              </p>
              {run.proposal_diff && run.proposal_snapshot_digest && run.proposal_hash && (
                <CodePatchEditor
                  key={`${run.id}:${run.proposal_hash}`}
                  project={project}
                  id={run.id}
                  baseSha={run.base_sha}
                  snapshotDigest={run.proposal_snapshot_digest}
                  proposalHash={run.proposal_hash}
                  initialDiff={run.proposal_diff}
                  disabled={!editable}
                  onDirty={invalidateProof}
                  onApply={applyPreview}
                />
              )}
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
                  Точные изменения с ограниченным контекстом; предпросмотр учитывает текущий текст
                  редактора.
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
                disabled={!editable || !selected.length || (matchesReview && !proofDirty)}
                onClick={() =>
                  void action(async () => {
                    if (invalidation.current) await invalidation.current;
                    const reviewed = await api<Run>(
                      `${root}/${encodeURIComponent(run.id)}/review`,
                      {
                        proposal_hash: run.proposal_hash,
                        files: selected.map(({ path, content }) => ({ path, content }))
                      }
                    );
                    editingInvalidated.current = false;
                    setProofDirty(false);
                    return reviewed;
                  })
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
                  <p>
                    Проверенный снимок: <code>{run.check.snapshotDigest}</code>
                  </p>
                  <TerminalOutput
                    stdout={run.check.stdout}
                    stderr={run.check.stderr}
                    status={run.check.status}
                    truncated={run.check.truncated}
                  />
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
