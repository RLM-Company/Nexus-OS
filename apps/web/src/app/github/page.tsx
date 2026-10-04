"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isValidChatAttachments } from "@cosmora/contracts/chat-attachments";
import styles from "./github.module.css";

type Tree = {
  sha: string;
  items: Array<{ path: string; type: string; mode: string; sha: string }>;
  truncated: boolean;
};
type Draft = {
  id: string;
  project_id: string;
  status: string;
  pr_url: string | null;
  plan: {
    base_branch: string;
    branch: string;
    review_hash: string;
    title: string;
    files: Array<{ path: string; before: string | null; content: string }>;
  };
};
const messages: Record<string, string> = {
  GITHUB_BASE_CHANGED: "Ветка изменилась. Обновите файлы и подготовьте новый просмотр изменений.",
  GITHUB_CONFLICT: "Этот просмотр уже отправлен или изменился. Обновите список изменений.",
  GITHUB_INVALID_FILE:
    "Нужен текст UTF-8 до 50 КБ. Изменение служебных файлов, секретов и настроек GitHub здесь недоступно.",
  EMERGENCY_STOP_ACTIVE: "Отправка в GitHub остановлена аварийным выключателем.",
  GITHUB_NOT_CONFIGURED: "Подключение GitHub ещё не настроено на сервере."
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { signal: AbortSignal.timeout(65_000) }
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(65_000)
        }
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new Error(
      messages[data?.error?.code ?? ""] ??
        "GitHub временно недоступен. Проверьте подключение и повторите чтение."
    );
  }
  return (await response.json()) as T;
}

export default function GithubPage() {
  const [status, setStatus] = useState<{
    configured: boolean;
    repository: string;
    default_branch: string | null;
  } | null>(null);
  const [branches, setBranches] = useState<Array<{ name: string; sha: string }>>([]);
  const [branch, setBranch] = useState("");
  const [tree, setTree] = useState<Tree | null>(null);
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<{
    path: string;
    original: string;
    content: string;
    isNew?: boolean;
  } | null>(null);
  const [changes, setChanges] = useState<Array<{ path: string; content: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [approved, setApproved] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pending = pendingCount > 0;
  const setPending = (value: boolean) =>
    setPendingCount((count) => Math.max(0, count + (value ? 1 : -1)));
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const loadRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const projectRequest = useRef(0);
  const load = async () => {
    const id = ++loadRequest.current;
    setPending(true);
    setError(null);
    try {
      const connected = await api<NonNullable<typeof status>>("/api/v1/github/status");
      if (id !== loadRequest.current) return;
      setStatus(connected);
      if (!connected.configured) return;
      const [list, workspaces] = await Promise.all([
        api<{ items: typeof branches }>("/api/v1/github/branches"),
        api<{ items: typeof projects }>("/api/v1/projects")
      ]);
      if (id !== loadRequest.current) return;
      setBranches(list.items);
      setProjects(workspaces.items);
      setBranch(connected.default_branch ?? "");
      setRefreshEpoch((epoch) => epoch + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка подключения");
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!branch) return;
    const id = ++requestId.current;
    setPending(true);
    setTree(null);
    setFile(null);
    setChanges([]);
    setDraft(null);
    setApproved(false);
    setError(null);
    void api<Tree>(`/api/v1/github/tree?ref=${encodeURIComponent(branch)}`)
      .then((result) => {
        if (id === requestId.current) setTree(result);
      })
      .catch(() => {
        if (id === requestId.current) setError("Не удалось прочитать ветку.");
      })
      .finally(() => {
        setPending(false);
      });
  }, [branch, refreshEpoch]);
  useEffect(() => {
    const id = ++projectRequest.current;
    setDrafts([]);
    setDraft(null);
    setApproved(false);
    if (!project) return;
    setPending(true);
    void api<{ items: Draft[] }>(`/api/v1/projects/${encodeURIComponent(project)}/github-drafts`)
      .then((result) => {
        if (id === projectRequest.current) setDrafts(result.items);
      })
      .catch(() => {
        if (id === projectRequest.current) setError("Не удалось прочитать сохранённые изменения.");
      })
      .finally(() => setPending(false));
  }, [project]);
  const open = async (entry: Tree["items"][number]) => {
    const id = ++requestId.current;
    setPending(true);
    setError(null);
    setFile(null);
    try {
      const result = await api<{ content: string }>(`/api/v1/github/file?sha=${entry.sha}`);
      if (id === requestId.current)
        setFile({
          path: entry.path,
          original: result.content,
          content: changes.find((item) => item.path === entry.path)?.content ?? result.content
        });
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл.");
    } finally {
      setPending(false);
    }
  };
  const prepare = async () => {
    if (!tree || !project) return;
    setPending(true);
    setError(null);
    setApproved(false);
    try {
      const result = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(project)}/github-drafts`,
        { base_branch: branch, base_sha: tree.sha, title, files: changes }
      );
      setDraft(result);
      setDrafts((current) => [result, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось подготовить изменения.");
    } finally {
      setPending(false);
    }
  };
  const publish = async (reconcile = false) => {
    if (!draft || (!reconcile && !approved)) return;
    setPending(true);
    setError(null);
    try {
      const result = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(project)}/github-drafts/${draft.id}/${reconcile ? "reconcile" : "publish"}`,
        reconcile ? {} : { review_hash: draft.plan.review_hash, approve: true }
      );
      setDraft(result);
      setDrafts((current) => current.map((item) => (item.id === result.id ? result : item)));
      setApproved(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить изменения.");
      const refreshed = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(project)}/github-drafts/${draft.id}`
      ).catch(() => null);
      if (refreshed) setDraft(refreshed);
    } finally {
      setPending(false);
    }
  };
  const importToChat = () => {
    if (!file) return;
    const attachment = { name: file.path.split("/").at(-1)!, content: file.content };
    if (!isValidChatAttachments([attachment])) {
      setError("Для чата выберите текст или код до 8 000 символов.");
      return;
    }
    try {
      const id = crypto.randomUUID();
      sessionStorage.setItem(
        `cosmora:github-import:${id}`,
        JSON.stringify({
          attachment,
          prompt: `Помоги с файлом ${file.path} из ${status?.repository} (ветка ${branch}).`
        })
      );
      window.location.assign(`/?github_import=${id}`);
    } catch {
      setError("Не удалось подготовить файл для чата.");
    }
  };
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/">← Назад в Cosmora</Link>
          <h1>GitHub</h1>
          <p className={styles.lead}>
            Код проекта, редактирование файлов и отправка проверенных изменений в отдельный черновик
            PR.
          </p>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!status && <p role="status">Проверяю подключение…</p>}
        {status && !status.configured && (
          <section className={styles.card}>
            <div className={styles.empty}>
              <h2>GitHub ещё не подключён</h2>
              <p>Для приватного репозитория нужен серверный ключ с ограничением по репозиторию.</p>
            </div>
          </section>
        )}
        <button type="button" disabled={pending || changes.length > 0} onClick={() => void load()}>
          Обновить подключение
        </button>
        {status?.configured && (
          <>
            <p>Подключён {status.repository}</p>
            <div className={styles.toolbar}>
              <button
                type="button"
                disabled={pending || !tree || changes.length >= 8}
                onClick={() => setFile({ path: "", original: "", content: "", isNew: true })}
              >
                Новый файл
              </button>
              <label>
                Ветка{" "}
                <select
                  aria-label="Ветка репозитория"
                  value={branch}
                  disabled={pending || changes.length > 0}
                  onChange={(event) => setBranch(event.target.value)}
                >
                  {!branches.some((item) => item.name === branch) && (
                    <option value={branch}>{branch}</option>
                  )}
                  {branches.map((item) => (
                    <option key={item.name}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Найти файл{" "}
                <input value={filter} onChange={(event) => setFilter(event.target.value)} />
              </label>
            </div>
            {tree?.truncated && (
              <p role="alert">
                GitHub вернул неполный список. Подготовка изменений для этой ветки недоступна.
              </p>
            )}
            <div className={styles.explorer}>
              <nav aria-label="Файлы репозитория" className={styles.files}>
                {tree?.items
                  .filter(
                    (item) =>
                      item.type === "blob" &&
                      ["100644", "100755"].includes(item.mode) &&
                      item.path.toLowerCase().includes(filter.toLowerCase())
                  )
                  .slice(0, 500)
                  .map((item) => (
                    <button
                      type="button"
                      disabled={pending}
                      key={item.path}
                      onClick={() => void open(item)}
                    >
                      {item.path}
                    </button>
                  ))}
              </nav>
              <section className={styles.editor} aria-label="Редактор файла">
                {file ? (
                  <>
                    <h2>{file.path}</h2>
                    {file.isNew && (
                      <label>
                        Путь нового файла
                        <input
                          aria-label="Путь нового файла"
                          value={file.path}
                          maxLength={240}
                          disabled={pending}
                          placeholder="src/example.ts"
                          onChange={(event) => setFile({ ...file, path: event.target.value })}
                        />
                      </label>
                    )}
                    <textarea
                      aria-label="Содержимое файла"
                      spellCheck={false}
                      value={file.content}
                      disabled={pending}
                      onChange={(event) => setFile({ ...file, content: event.target.value })}
                    />
                    <div className={styles.toolbar}>
                      <button disabled={pending} onClick={importToChat}>
                        Открыть файл в чате
                      </button>
                      <button
                        disabled={
                          pending ||
                          !file.path.trim() ||
                          file.content === file.original ||
                          (changes.length >= 8 && !changes.some((item) => item.path === file.path))
                        }
                        onClick={() => {
                          setChanges((current) => [
                            ...current.filter((item) => item.path !== file.path),
                            { path: file.path, content: file.content }
                          ]);
                          setDraft(null);
                          setApproved(false);
                        }}
                      >
                        Добавить изменение
                      </button>
                    </div>
                  </>
                ) : (
                  <p>Выберите текстовый файл или исходный код.</p>
                )}
              </section>
            </div>
            <section className={styles.review}>
              <h2>Подготовка изменений</h2>
              <label>
                Проект Cosmora{" "}
                <select
                  aria-label="Проект для изменений"
                  disabled={pending}
                  value={project}
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
              {projects.length === 0 && <p>Сначала создайте проект в чате Cosmora.</p>}
              <label>
                Описание изменения{" "}
                <input
                  value={title}
                  maxLength={160}
                  disabled={pending}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              {changes.map((item) => (
                <div key={item.path}>
                  {item.path}{" "}
                  <button
                    disabled={pending}
                    onClick={() => {
                      setChanges((current) => current.filter((file) => file.path !== item.path));
                      setDraft(null);
                      setApproved(false);
                    }}
                  >
                    Убрать
                  </button>
                </div>
              ))}
              <button
                disabled={
                  pending || !changes.length || !project || !title.trim() || tree?.truncated
                }
                onClick={() => void prepare()}
              >
                Просмотреть перед отправкой
              </button>
              {drafts.length > 0 && (
                <label>
                  Сохранённые изменения{" "}
                  <select
                    aria-label="Сохранённые изменения"
                    disabled={pending}
                    value={draft?.id ?? ""}
                    onChange={(event) => {
                      setDraft(drafts.find((item) => item.id === event.target.value) ?? null);
                      setApproved(false);
                    }}
                  >
                    <option value="">Выберите просмотр</option>
                    {drafts.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.plan.title} · {item.status}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft && (
                <section aria-label="Проверка изменений">
                  <h3>{draft.plan.title}</h3>
                  <p>
                    {draft.plan.base_branch} → {draft.plan.branch}
                  </p>
                  {draft.plan.files.map((item) => (
                    <details key={item.path} open>
                      <summary>{item.path}</summary>
                      <div className={styles.diff}>
                        <div>
                          <strong>Было</strong>
                          <pre>{item.before ?? "Новый файл"}</pre>
                        </div>
                        <div>
                          <strong>Будет</strong>
                          <pre>{item.content}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                  {draft.status === "review" && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={approved}
                          disabled={pending}
                          onChange={(event) => setApproved(event.target.checked)}
                        />{" "}
                        Я просмотрел эти файлы и разрешаю создать отдельную ветку и черновик PR
                      </label>
                      <button disabled={pending || !approved} onClick={() => void publish()}>
                        Создать черновик PR в GitHub
                      </button>
                    </>
                  )}
                  {draft.pr_url && (
                    <p>
                      <a href={draft.pr_url} target="_blank" rel="noreferrer">
                        Открыть созданный PR
                      </a>
                    </p>
                  )}
                  {["publishing", "uncertain"].includes(draft.status) && (
                    <>
                      <p role="status">
                        Результат отправки требует проверки. Повторная запись автоматически не
                        запускается.
                      </p>
                      <button disabled={pending} onClick={() => void publish(true)}>
                        Проверить результат в GitHub
                      </button>
                    </>
                  )}
                </section>
              )}
            </section>
          </>
        )}
        <p>
          <Link href="/github/preview">Посмотреть демонстрацию интерфейса</Link>
        </p>
      </div>
    </main>
  );
}
