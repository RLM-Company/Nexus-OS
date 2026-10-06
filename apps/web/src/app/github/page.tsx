"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isValidChatAttachments } from "@cosmora/contracts/chat-attachments";
import styles from "./github.module.css";
import {
  readWorkspace,
  saveWorkspace,
  changeSetError,
  changeBytes,
  type WorkspaceSnapshot,
  type LocalChange,
  type EditorFile
} from "./github-workspace";

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
    repository: string;
    base_sha: string;
    base_branch: string;
    branch: string;
    review_hash: string;
    title: string;
    files: Array<{ path: string; before: string | null; content: string }>;
  };
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  GITHUB_BASE_CHANGED: "Ветка изменилась. Обновите файлы и подготовьте новый просмотр изменений.",
  GITHUB_CONFLICT: "Этот просмотр уже отправлен или изменился. Обновите список изменений.",
  GITHUB_INVALID_FILE:
    "Нужен текст UTF-8 до 50 КБ. Изменение служебных файлов, секретов и настроек GitHub здесь недоступно.",
  EMERGENCY_STOP_ACTIVE: "Отправка в GitHub остановлена аварийным выключателем.",
  GITHUB_NOT_CONFIGURED: "Подключение GitHub ещё не настроено на сервере.",
  GITHUB_ACCESS_DENIED:
    "GitHub отказал в доступе. Проверьте серверное подключение и разрешения репозитория.",
  GITHUB_RATE_LIMITED: "Лимит запросов GitHub исчерпан. Повторите чтение позже.",
  UNAUTHORIZED: "Вход владельца истёк. Войдите в Cosmora и обновите подключение.",
  PROJECT_NOT_FOUND: "Сохранённый проект больше недоступен. Ваши файлы остаются в текущей вкладке.",
  DRAFT_NOT_FOUND:
    "Сохранённый review больше недоступен. Проверьте результат отправки в GitHub вручную."
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
  ).catch(() => {
    throw new Error(
      "Не удалось связаться с сервером Cosmora. Проверьте соединение и повторите чтение."
    );
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw new ApiError(
      messages[data?.error?.code ?? ""] ??
        "GitHub временно недоступен. Проверьте подключение и повторите чтение.",
      data?.error?.code ?? "UNKNOWN"
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(
      "Сервер вернул непонятный ответ. Проверьте результат чтением; повторная отправка не выполняется."
    );
  }
}

export default function GithubPage() {
  const [status, setStatus] = useState<{
    configured: boolean;
    repository: string;
    default_branch: string | null;
    workspace_scope: string | null;
  } | null>(null);
  const [branches, setBranches] = useState<Array<{ name: string; sha: string }>>([]);
  const [branchPage, setBranchPage] = useState(1);
  const [nextBranchPage, setNextBranchPage] = useState<number | null>(null);
  const [branchesLimited, setBranchesLimited] = useState(false);
  const [visibleCount, setVisibleCount] = useState(500);
  const [branch, setBranch] = useState("");
  const [tree, setTree] = useState<Tree | null>(null);
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<EditorFile | null>(null);
  const [changes, setChanges] = useState<LocalChange[]>([]);
  const [baseSha, setBaseSha] = useState("");
  const [baseChanged, setBaseChanged] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [publication, setPublication] = useState<{ id: string; project: string } | null>(null);
  const restoreRequest = useRef<WorkspaceSnapshot | null>(null);
  const savedDraft = useRef<string | null>(null);
  const liveSnapshot = useRef<WorkspaceSnapshot | null>(null);
  const [rebase, setRebase] = useState<{
    tree: Tree;
    files: LocalChange[];
    conflicts: string[];
  } | null>(null);
  const stagedFile = changes.find(
    (item) => item.path === (file?.stagedPath ?? (file?.isNew ? undefined : file?.path))
  );
  const dirty =
    !!file &&
    (file.isNew
      ? !stagedFile || stagedFile.path !== file.path || stagedFile.content !== file.content
      : file.content !== (stagedFile?.content ?? file.original));
  const filteredFiles =
    tree?.items.filter(
      (item) =>
        item.type === "blob" &&
        ["100644", "100755"].includes(item.mode) &&
        item.path.toLowerCase().includes(filter.toLowerCase())
    ) ?? [];
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const reviewMatches =
    !draft ||
    (draft.plan.base_sha === baseSha &&
      draft.plan.base_branch === branch &&
      (!changes.length ||
        (changes.length === draft.plan.files.length &&
          title.trim() === draft.plan.title &&
          changes.every((change) =>
            draft.plan.files.some(
              (item) => item.path === change.path && item.content === change.content
            )
          ))));
  const unreviewed = changes.some(
    (change) =>
      !draft?.plan.files.some(
        (item) => item.path === change.path && item.content === change.content
      )
  );
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
  const snapshot: WorkspaceSnapshot | null =
    status?.workspace_scope && baseSha
      ? {
          version: 1,
          scope: status.workspace_scope,
          repository: status.repository,
          branch,
          base_sha: baseSha,
          changes,
          file,
          title,
          project: publication?.project ?? project,
          draft_id: publication?.id ?? draft?.id ?? savedDraft.current,
          publication: publication ? "uncertain" : null,
          saved_at: Date.now()
        }
      : null;
  if (workspaceReady && snapshot) liveSnapshot.current = snapshot;
  useEffect(() => {
    if (!workspaceReady || !snapshot) return;
    try {
      setStorageNotice(saveWorkspace(sessionStorage, snapshot));
    } catch {
      setStorageNotice("Хранилище вкладки недоступно. Оставьте её открытой или скачайте правки.");
    }
  }, [workspaceReady, status, branch, baseSha, changes, file, title, project, draft, publication]);
  const invalidateReview = () => {
    savedDraft.current = null;
    setDraft(null);
    setApproved(false);
  };
  useEffect(() => {
    if ((!dirty && !unreviewed) || (!storageNotice && workspaceReady && snapshot)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, unreviewed, storageNotice, workspaceReady]);
  const load = async () => {
    const id = ++loadRequest.current;
    const material = liveSnapshot.current;
    ++requestId.current;
    ++projectRequest.current;
    setPending(true);
    setError(null);
    setWorkspaceReady(false);
    try {
      const connected = await api<NonNullable<typeof status>>("/api/v1/github/status");
      if (id !== loadRequest.current) return;
      setStatus(connected);
      if (!connected.configured) {
        setTree(null);
        setFile(null);
        setChanges([]);
        return;
      }
      const [list, workspaces] = await Promise.all([
        api<{ items: typeof branches; page: number; next_page: number | null; limited?: boolean }>(
          "/api/v1/github/branches?page=1"
        ),
        api<{ items: typeof projects }>("/api/v1/projects")
      ]);
      if (id !== loadRequest.current) return;
      setBranches(list.items);
      setBranchesLimited(list.limited ?? false);
      setBranchPage(1);
      setNextBranchPage(list.next_page ?? null);
      setProjects(workspaces.items);
      let recovery: ReturnType<typeof readWorkspace>;
      try {
        recovery =
          material &&
          material.scope === connected.workspace_scope &&
          material.repository === connected.repository
            ? {
                snapshot: material,
                notice: "Правки текущей вкладки сохранены при обновлении подключения."
              }
            : connected.workspace_scope
              ? readWorkspace(sessionStorage, connected.workspace_scope, connected.repository)
              : {
                  snapshot: null,
                  notice: "Сервер не поддерживает привязку восстановления. Обновите сервер GitHub."
                };
      } catch {
        recovery = {
          snapshot: null,
          notice: "Хранилище вкладки недоступно. Восстановление правок после reload не работает."
        };
      }
      restoreRequest.current = recovery.snapshot;
      savedDraft.current = recovery.snapshot?.draft_id ?? null;
      setRecoveryNotice(recovery.notice);
      setPublication(
        recovery.snapshot?.publication && recovery.snapshot.draft_id
          ? { id: recovery.snapshot.draft_id, project: recovery.snapshot.project }
          : null
      );
      setProject(
        workspaces.items.some((item) => item.id === recovery.snapshot?.project)
          ? recovery.snapshot!.project
          : ""
      );
      setTitle(recovery.snapshot?.title ?? "");
      setBranch(recovery.snapshot?.branch ?? connected.default_branch ?? "");
      setRefreshEpoch((epoch) => epoch + 1);
    } catch (cause) {
      if (id !== loadRequest.current) return;
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "Ошибка подключения");
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const checkBinding = async () => {
    if (!status?.configured) return false;
    const generation = loadRequest.current;
    try {
      const current = await api<NonNullable<typeof status>>("/api/v1/github/status");
      if (generation !== loadRequest.current) return false;
      if (
        !current.configured ||
        current.repository !== status.repository ||
        current.workspace_scope !== status.workspace_scope
      )
        throw new Error(
          "Владелец, репозиторий или доступ изменились. Обновите подключение; старый набор не будет смешан с новым."
        );
      return true;
    } catch (cause) {
      if (generation === loadRequest.current) {
        setWorkspaceReady(false);
        setStatus(null);
        ++requestId.current;
        ++projectRequest.current;
        setError(cause instanceof Error ? cause.message : "Не удалось проверить доступ.");
      }
      return false;
    }
  };
  useEffect(() => {
    const verify = () => {
      if (document.visibilityState === "visible") void checkBinding();
    };
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", verify);
    return () => {
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", verify);
    };
  }, [status]);
  const loadBranches = async (page: number) => {
    setPending(true);
    setError(null);
    try {
      if (!(await checkBinding())) return;
      const result = await api<{
        items: typeof branches;
        page: number;
        next_page: number | null;
        limited: boolean;
      }>(`/api/v1/github/branches?page=${page}`);
      setBranches(result.items);
      setBranchPage(page);
      setNextBranchPage(result.next_page);
      setBranchesLimited(result.limited);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось прочитать ветки.");
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (!branch) return;
    const id = ++requestId.current;
    setPending(true);
    setTree(null);
    setVisibleCount(500);
    const restored = restoreRequest.current;
    restoreRequest.current = null;
    setWorkspaceReady(false);
    setFile(restored?.file ?? null);
    setChanges(restored?.changes ?? []);
    setBaseSha(restored?.base_sha ?? "");
    setBaseChanged(false);
    setRebase(null);
    setDraft(null);
    setApproved(false);
    setError(null);
    void api<Tree>(`/api/v1/github/tree?ref=${encodeURIComponent(branch)}`)
      .then((result) => {
        if (id === requestId.current) {
          setTree(result);
          if (!restored) setBaseSha(result.sha);
          setBaseChanged(!!restored && restored.base_sha !== result.sha);
          setWorkspaceReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (id === requestId.current) {
          setError(cause instanceof Error ? cause.message : "Не удалось прочитать ветку.");
          if (restored) setWorkspaceReady(true);
        }
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
    void Promise.all([
      api<{ items: Draft[] }>(`/api/v1/projects/${encodeURIComponent(project)}/github-drafts`),
      savedDraft.current
        ? api<Draft>(
            `/api/v1/projects/${encodeURIComponent(project)}/github-drafts/${encodeURIComponent(savedDraft.current)}`
          ).catch(() => null)
        : Promise.resolve(null)
    ])
      .then(([result, restored]) => {
        if (id === projectRequest.current) {
          const protect = (item: Draft) =>
            publication?.id === item.id && item.status !== "published"
              ? { ...item, status: "uncertain" }
              : item;
          setDrafts(
            (restored
              ? [restored, ...result.items.filter((item) => item.id !== restored.id)]
              : result.items
            ).map(protect)
          );
          if (restored) {
            setDraft(protect(restored));
            if (restored.status === "published") setPublication(null);
          }
        }
      })
      .catch(() => {
        if (id === projectRequest.current) setError("Не удалось прочитать сохранённые изменения.");
      })
      .finally(() => setPending(false));
  }, [project, refreshEpoch]);
  const open = async (entry: Tree["items"][number]) => {
    const id = ++requestId.current;
    setPending(true);
    setError(null);
    setFile(null);
    try {
      if (!(await checkBinding())) return;
      const result = await api<{ content: string }>(`/api/v1/github/file?sha=${entry.sha}`);
      const staged = changes.find((item) => item.path === entry.path);
      if (id === requestId.current)
        setFile({
          path: entry.path,
          original: staged?.before ?? result.content,
          content: staged?.content ?? result.content,
          ...(staged ? { stagedPath: staged.path, isNew: staged.before === null } : {})
        });
    } catch (cause) {
      if (id === requestId.current)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл.");
    } finally {
      setPending(false);
    }
  };
  const prepare = async () => {
    if (!tree || !project || baseChanged || publication) return;
    setPending(true);
    setError(null);
    setApproved(false);
    try {
      if (!(await checkBinding())) return;
      const result = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(project)}/github-drafts`,
        {
          base_branch: branch,
          base_sha: baseSha,
          title,
          files: changes.map(({ path, content }) => ({ path, content })),
          workspace_scope: status?.workspace_scope
        }
      );
      setDraft(result);
      savedDraft.current = result.id;
      setDrafts((current) => [result, ...current]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "GITHUB_BASE_CHANGED") setBaseChanged(true);
      setError(cause instanceof Error ? cause.message : "Не удалось подготовить изменения.");
    } finally {
      setPending(false);
    }
  };
  const publish = async (reconcile = false) => {
    const target =
      reconcile && publication ? publication : draft && { id: draft.id, project: draft.project_id };
    if (
      !target ||
      (!reconcile && (!draft || !approved || publication || baseChanged || !reviewMatches))
    )
      return;
    setPending(true);
    if (!(await checkBinding())) {
      setPending(false);
      return;
    }
    if (!reconcile) {
      if (!snapshot) {
        setError("Привязка восстановления недоступна. Обновите подключение.");
        setPending(false);
        return;
      }
      let issue: string | null;
      try {
        issue = saveWorkspace(sessionStorage, {
          ...snapshot,
          draft_id: target.id,
          project: target.project,
          publication: "uncertain"
        });
      } catch {
        issue = "Хранилище вкладки недоступно. Отправка не начата.";
      }
      if (issue) {
        setStorageNotice(issue);
        setError("Отправка не начата: не удалось сохранить состояние для восстановления.");
        setPending(false);
        return;
      }
      setPublication(target);
    }
    setError(null);
    setApproved(false);
    // The POST can reach the server even if its response never reaches this tab.
    if (!reconcile && draft) {
      const uncertain = { ...draft, status: "uncertain" };
      setDraft(uncertain);
      setDrafts((current) => current.map((item) => (item.id === draft.id ? uncertain : item)));
    }
    try {
      const result = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(target.project)}/github-drafts/${target.id}/${reconcile ? "reconcile" : "publish"}`,
        reconcile ? {} : { review_hash: draft!.plan.review_hash, approve: true }
      );
      const protectedResult =
        result.status === "review" ? { ...result, status: "uncertain" } : result;
      setDraft(protectedResult);
      if (result.status === "published") {
        setPublication(null);
        if (
          result.plan.files.length === changes.length &&
          result.plan.files.every((item) =>
            changes.some((change) => change.path === item.path && change.content === item.content)
          )
        ) {
          setChanges([]);
          setFile(null);
        }
      }
      setDrafts((current) =>
        current.map((item) => (item.id === result.id ? protectedResult : item))
      );
      setApproved(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "GITHUB_BASE_CHANGED") setBaseChanged(true);
      setError(cause instanceof Error ? cause.message : "Не удалось отправить изменения.");
      const refreshed = await api<Draft>(
        `/api/v1/projects/${encodeURIComponent(target.project)}/github-drafts/${target.id}`
      ).catch(() => null);
      if (refreshed) {
        const definite =
          refreshed.status === "published" ||
          (cause instanceof ApiError && refreshed.status === "review" && !reconcile);
        if (definite) setPublication(null);
        const protectedDraft =
          definite || !["review", "publishing"].includes(refreshed.status)
            ? refreshed
            : { ...refreshed, status: "uncertain" };
        setDraft(protectedDraft);
        setDrafts((current) =>
          current.map((item) => (item.id === refreshed.id ? protectedDraft : item))
        );
      }
    } finally {
      setPending(false);
    }
  };
  const candidate = file
    ? [
        ...changes.filter((item) => item.path !== file.stagedPath),
        { path: file.path, content: file.content, before: file.isNew ? null : file.original }
      ]
    : changes;
  const candidateError = file ? changeSetError(candidate) : null;
  const applyBase = (next: NonNullable<typeof rebase>) => {
    setTree(next.tree);
    setBaseSha(next.tree.sha);
    setBaseChanged(false);
    setChanges(next.files.filter((item) => item.before !== item.content));
    setFile(null);
    setRebase(null);
    invalidateReview();
  };
  const checkBase = async () => {
    if (dirty || publication) return;
    setPending(true);
    setError(null);
    try {
      if (!(await checkBinding())) return;
      const latest = await api<Tree>(`/api/v1/github/tree?ref=${encodeURIComponent(branch)}`);
      if (latest.truncated)
        throw new Error(
          "Новая база вернула неполное дерево. Ваш текст сохранён; обновление базы недоступно."
        );
      const next: NonNullable<typeof rebase> = { tree: latest, files: [], conflicts: [] };
      for (const change of changes) {
        const entry = latest.items.find((item) => item.path === change.path);
        if (entry && (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)))
          throw new Error(
            `Путь ${change.path} стал каталогом или ссылкой. Уберите его из набора или измените путь.`
          );
        const before = entry
          ? (await api<{ content: string }>(`/api/v1/github/file?sha=${entry.sha}`)).content
          : null;
        next.files.push({ ...change, before });
        if (change.before !== before) next.conflicts.push(change.path);
      }
      if (next.conflicts.length) {
        setRebase(next);
        setBaseChanged(true);
        invalidateReview();
      } else applyBase(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось проверить новую базу.");
    } finally {
      setPending(false);
    }
  };
  const resolveBase = (path: string, keep: boolean) => {
    if (!rebase) return;
    const next = {
      ...rebase,
      files: keep ? rebase.files : rebase.files.filter((item) => item.path !== path),
      conflicts: rebase.conflicts.filter((item) => item !== path)
    };
    if (next.conflicts.length) setRebase(next);
    else applyBase(next);
  };
  const downloadChanges = () => {
    const material = JSON.stringify(
      {
        repository: status?.repository,
        branch,
        base_sha: baseSha,
        title,
        changes: changes.map(({ path, content }) => ({ path, content })),
        editor: file && { path: file.path, content: file.content }
      },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([material], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cosmora-github-changes.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importToChat = async () => {
    if (!file) return;
    if (!(await checkBinding())) return;
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
        {!status && pending && <p role="status">Проверяю подключение…</p>}
        {status && !status.configured && (
          <section className={styles.card}>
            <div className={styles.empty}>
              <h2>GitHub ещё не подключён</h2>
              <p>Для приватного репозитория нужен серверный ключ с ограничением по репозиторию.</p>
            </div>
          </section>
        )}
        <button type="button" disabled={pending} onClick={() => void load()}>
          Обновить подключение
        </button>
        {status?.configured && (
          <>
            {recoveryNotice && <p role="status">{recoveryNotice}</p>}
            {storageNotice && <p role="alert">{storageNotice}</p>}
            <label className={styles.repository}>
              Разрешённый репозиторий{" "}
              <select aria-label="Разрешённый репозиторий" value={status.repository} disabled>
                <option>{status.repository}</option>
              </select>
            </label>
            <p>
              Правки сохраняются в этой вкладке на 7 дней. Review сохраняется на сервере. До 8
              файлов, 50 КБ на файл и 160 КБ на набор.
            </p>
            {branchesLimited && (
              <p role="status">
                Достигнут предел 100 000 веток. Чтение следующих страниц недоступно.
              </p>
            )}
            <div className={styles.toolbar} aria-label="Страницы веток">
              <button
                disabled={pending || branchPage === 1}
                onClick={() => void loadBranches(branchPage - 1)}
              >
                Предыдущие ветки
              </button>
              <span>Страница веток {branchPage}</span>
              <button
                disabled={pending || nextBranchPage === null}
                onClick={() => nextBranchPage && void loadBranches(nextBranchPage)}
              >
                Следующие ветки
              </button>
            </div>
            <div className={styles.toolbar}>
              <button
                type="button"
                disabled={pending || dirty || !tree || changes.length >= 8 || !!rebase}
                onClick={() => setFile({ path: "", original: "", content: "", isNew: true })}
              >
                Новый файл
              </button>
              <label>
                Ветка{" "}
                <select
                  aria-label="Ветка репозитория"
                  value={branch}
                  disabled={pending || dirty || changes.length > 0 || !!publication}
                  onChange={(event) => {
                    invalidateReview();
                    setBranch(event.target.value);
                  }}
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
                <input
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setVisibleCount(500);
                  }}
                />
              </label>
            </div>
            {tree?.truncated && (
              <p role="alert">
                GitHub вернул неполный список. Подготовка изменений для этой ветки недоступна.
              </p>
            )}
            <div className={styles.explorer}>
              <nav aria-label="Файлы репозитория" className={styles.files}>
                {filteredFiles.slice(0, visibleCount).map((item) => (
                  <button
                    type="button"
                    disabled={pending || dirty || !!rebase}
                    key={item.path}
                    aria-pressed={file?.path === item.path}
                    onClick={() => void open(item)}
                  >
                    {item.path}
                  </button>
                ))}
                {tree && !filteredFiles.length && <p>Файлы не найдены.</p>}
                {filteredFiles.length > visibleCount && (
                  <button onClick={() => setVisibleCount((count) => count + 500)}>
                    Показать ещё файлы ({filteredFiles.length - visibleCount})
                  </button>
                )}
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
                          disabled={pending || !!rebase}
                          placeholder="src/example.ts"
                          onChange={(event) => {
                            setFile({ ...file, path: event.target.value });
                            invalidateReview();
                          }}
                        />
                      </label>
                    )}
                    <textarea
                      aria-label="Содержимое файла"
                      spellCheck={false}
                      value={file.content}
                      disabled={pending || !!rebase}
                      onChange={(event) => {
                        setFile({ ...file, content: event.target.value });
                        invalidateReview();
                      }}
                    />
                    <div className={styles.toolbar}>
                      <button disabled={pending} onClick={() => void importToChat()}>
                        Открыть файл в чате
                      </button>
                      <button
                        disabled={
                          pending ||
                          !!rebase ||
                          !!candidateError ||
                          !file.path.trim() ||
                          (!file.isNew && file.content === file.original) ||
                          (file.isNew && !!tree?.items.some((item) => item.path === file.path)) ||
                          (changes.length >= 8 && !file.stagedPath)
                        }
                        onClick={() => {
                          setChanges(candidate);
                          setFile({ ...file, stagedPath: file.path });
                          invalidateReview();
                        }}
                      >
                        Добавить изменение
                      </button>
                      {dirty && (
                        <button
                          disabled={pending}
                          onClick={() => {
                            if (file.isNew && !stagedFile) setFile(null);
                            else
                              setFile({
                                ...file,
                                path: stagedFile?.path ?? file.path,
                                content: stagedFile?.content ?? file.original
                              });
                          }}
                        >
                          Отменить правки в редакторе
                        </button>
                      )}
                    </div>
                    {file.path && candidateError && <p role="alert">{candidateError}</p>}
                    {dirty && (
                      <p role="status">
                        Добавьте изменение или отмените правки, прежде чем менять файл или ветку.
                      </p>
                    )}
                    {file.isNew && tree?.items.some((item) => item.path === file.path) && (
                      <p role="alert">
                        Этот путь уже существует. Откройте файл из списка для редактирования.
                      </p>
                    )}
                  </>
                ) : (
                  <p>Выберите текстовый файл или исходный код.</p>
                )}
              </section>
            </div>
            <section className={styles.review}>
              <h2>Подготовка изменений</h2>
              <p>
                База: {branch} · <code>{baseSha}</code>. Файлов: {changes.length}/8 ·{" "}
                {changeBytes(changes).toLocaleString("ru-RU")} / 160 000 байт.
              </p>
              <div className={styles.toolbar}>
                <button
                  disabled={pending || dirty || !!publication || !!rebase}
                  onClick={() => void checkBase()}
                >
                  Проверить новую базу
                </button>
                <button disabled={!changes.length && !file} onClick={downloadChanges}>
                  Скачать мои правки
                </button>
                <button
                  disabled={pending || !!publication || (!changes.length && !file)}
                  onClick={() => {
                    setChanges([]);
                    setFile(null);
                    setRebase(null);
                    invalidateReview();
                  }}
                >
                  Очистить набор файлов
                </button>
              </div>
              {baseChanged && (
                <p role="alert">
                  Исходная база изменилась. Ваш текст сохранён. Проверьте новую базу и разрешите
                  конфликты перед новым review.
                </p>
              )}
              {rebase && (
                <section aria-label="Конфликты новой базы">
                  <h3>Нужен ваш выбор для {rebase.conflicts.length} файлов</h3>
                  {rebase.files
                    .filter((item) => rebase.conflicts.includes(item.path))
                    .map((item) => (
                      <details key={item.path} open>
                        <summary>{item.path}</summary>
                        <div className={styles.diff}>
                          <div>
                            <strong>В новой базе</strong>
                            <pre>{item.before ?? "Файл отсутствует"}</pre>
                          </div>
                          <div>
                            <strong>Мой текст</strong>
                            <pre>{item.content}</pre>
                          </div>
                        </div>
                        <button disabled={pending} onClick={() => resolveBase(item.path, true)}>
                          Оставить мой текст: {item.path}
                        </button>
                        <button disabled={pending} onClick={() => resolveBase(item.path, false)}>
                          Убрать изменение: {item.path}
                        </button>
                      </details>
                    ))}
                </section>
              )}
              <label>
                Проект Cosmora{" "}
                <select
                  aria-label="Проект для изменений"
                  disabled={pending}
                  value={project}
                  onChange={(event) => {
                    invalidateReview();
                    setProject(event.target.value);
                  }}
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
                  onChange={(event) => {
                    setTitle(event.target.value);
                    invalidateReview();
                  }}
                />
              </label>
              {changes.map((item) => (
                <div key={item.path}>
                  <button
                    disabled={pending || dirty || !!rebase}
                    onClick={() => {
                      const entry = tree?.items.find((entry) => entry.path === item.path);
                      if (entry) void open(entry);
                      else
                        setFile({
                          ...item,
                          original: item.before ?? "",
                          isNew: item.before === null,
                          stagedPath: item.path
                        });
                    }}
                  >
                    {item.path}
                  </button>{" "}
                  <button
                    disabled={pending || !!rebase}
                    onClick={() => {
                      setChanges((current) => current.filter((file) => file.path !== item.path));
                      if (file?.path === item.path) setFile(null);
                      invalidateReview();
                    }}
                  >
                    Убрать
                  </button>
                </div>
              ))}
              <button
                className={styles.primary}
                disabled={
                  pending ||
                  dirty ||
                  baseChanged ||
                  !!publication ||
                  !!changeSetError(changes) ||
                  !tree ||
                  !changes.length ||
                  !project ||
                  !title.trim() ||
                  tree.truncated
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
                      savedDraft.current = event.target.value || null;
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
                    {draft.plan.repository ?? status.repository} · {draft.plan.base_branch} ·{" "}
                    <code>{draft.plan.base_sha}</code> → {draft.plan.branch}. Файлов:{" "}
                    {draft.plan.files.length}
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
                  {draft.status === "review" && !publication && (
                    <>
                      {!reviewMatches && (
                        <p role="alert">
                          Этот review не соответствует текущему набору или базе. Подготовьте новый
                          просмотр изменений.
                        </p>
                      )}
                      <label>
                        <input
                          type="checkbox"
                          checked={approved}
                          disabled={pending}
                          onChange={(event) => setApproved(event.target.checked)}
                        />{" "}
                        Я просмотрел эти файлы и разрешаю создать отдельную ветку и черновик PR
                      </label>
                      <button
                        className={styles.primary}
                        disabled={pending || dirty || baseChanged || !reviewMatches || !approved}
                        onClick={() => void publish()}
                      >
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
              {publication &&
                (!draft ||
                  draft.id !== publication.id ||
                  !["publishing", "uncertain", "published"].includes(draft.status)) && (
                  <div role="status">
                    Результат прошлой отправки неизвестен. Доступна только сверка чтением.
                    <button disabled={pending} onClick={() => void publish(true)}>
                      Проверить сохранённую отправку
                    </button>
                  </div>
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
