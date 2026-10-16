"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./search.module.css";
import { splitHighlights } from "./highlight";

type Scope = "all" | "general" | "project";
type Archive = "active" | "archived" | "all";
type Hit = {
  scope: "general" | "project";
  chat_id: string;
  project_id: string | null;
  message_id: string | null;
  title: string;
  snippet: string;
  created_at: string;
  archived: boolean;
};
type Page = { items: Hit[]; next_offset: number | null };
type Project = { id: string; title: string };
const PAGE_SIZE = 20;

const getInitial = () => {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
};
const safeScope = (value: string | null): Scope =>
  value === "general" || value === "project" ? value : "all";
const safeArchive = (value: string | null): Archive =>
  value === "archived" || value === "all" ? value : "active";
const offsetOf = (value: string | null): number => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 1000 ? number : 0;
};
const normalizedDate = (value: string | null): string =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
/** Render the returned plain-text tokens without injecting HTML from the corpus. */
function highlightPlainText(content: string, query: string): ReactNode[] {
  return splitHighlights(content, query).map((part, index) =>
    part.matched ? <mark key={index}>{part.text}</mark> : part.text
  );
}

export default function SearchHistoryPage() {
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [archive, setArchive] = useState<Archive>("active");
  const [project, setProject] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialScroll = useRef(true);
  const previousOffset = useRef(0);

  useEffect(() => {
    const initial = getInitial();
    setDraft(initial.get("q") ?? "");
    setQuery(initial.get("q") ?? "");
    setScope(safeScope(initial.get("scope")));
    setArchive(safeArchive(initial.get("archive")));
    setProject(initial.get("project") ?? "");
    setAfter(normalizedDate(initial.get("after")));
    setBefore(normalizedDate(initial.get("before")));
    setOffset(offsetOf(initial.get("offset")));
    previousOffset.current = offsetOf(initial.get("offset"));
    setReady(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        setDraft("");
      }
    };
    window.addEventListener("keydown", onKey);
    fetch("/api/v1/projects", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { items?: Project[] } | null) => setProjects(data?.items ?? []))
      .catch(() => undefined);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reload = useCallback(() => setRevision((current) => current + 1), []);
  const apply = (next: {
    q?: string;
    scope?: Scope;
    archive?: Archive;
    project?: string;
    after?: string;
    before?: string;
    offset?: number;
  }) => {
    if (next.q !== undefined) setQuery(next.q.trim());
    if (next.scope !== undefined) setScope(next.scope);
    if (next.archive !== undefined) setArchive(next.archive);
    if (next.project !== undefined) setProject(next.project);
    if (next.after !== undefined) setAfter(next.after);
    if (next.before !== undefined) setBefore(next.before);
    setOffset(next.offset ?? 0);
  };

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (scope !== "all") params.set("scope", scope);
    if (archive !== "active") params.set("archive", archive);
    if (project) params.set("project", project);
    if (after) params.set("after", after);
    if (before) params.set("before", before);
    if (offset) params.set("offset", String(offset));
    const route = `/search${params.size ? `?${params}` : ""}`;
    window.history.replaceState(window.history.state, "", route);
    abortRef.current?.abort();
    setError("");
    if (!query.trim()) {
      setPage(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const request = new URLSearchParams({
      q: query,
      scope,
      archive,
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
    if (project) request.set("project", project);
    if (after) request.set("after", after);
    if (before) request.set("before", before);
    setLoading(true);
    fetch(`/api/v1/chat-history/search?${request}`, {
      signal: controller.signal,
      credentials: "same-origin"
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401 || response.status === 403
              ? "Необходим вход с правами владельца."
              : "Не удалось выполнить поиск. Попробуйте ещё раз."
          );
        return response.json() as Promise<Page>;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage(result);
        if (initialScroll.current) {
          initialScroll.current = false;
          const saved = window.sessionStorage.getItem(`kosmora:history-search-scroll:${route}`);
          if (saved) window.requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
        } else if (previousOffset.current !== offset) {
          previousOffset.current = offset;
          listRef.current?.scrollIntoView({ block: "start" });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Ошибка поиска");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ready, query, scope, archive, project, after, before, offset, revision]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply({ q: draft.slice(0, 160) });
    if (query === draft.trim()) reload();
  };
  const hrefFor = (hit: Hit): string => {
    const params = new URLSearchParams(
      hit.scope === "project"
        ? { project: hit.project_id ?? "", view: "chat" }
        : { chat: hit.chat_id }
    );
    if (hit.message_id) params.set("message", hit.message_id);
    return `/?${params}`;
  };
  const rememberScroll = () => {
    window.sessionStorage.setItem(
      `kosmora:history-search-scroll:${window.location.pathname}${window.location.search}`,
      String(window.scrollY)
    );
  };

  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <a href="/" className={styles.back}>
          ← К чатам
        </a>
        <h1>Поиск по истории</h1>
        <p>Только ваши чаты и сообщения. Архив исключён, пока вы его не выберете.</p>
      </header>
      <form onSubmit={submit} role="search" className={styles.form}>
        <label htmlFor="history-q">Поиск в названиях и сообщениях</label>
        <div className={styles.searchRow}>
          <input
            id="history-q"
            ref={inputRef}
            value={draft}
            maxLength={160}
            placeholder="Слова из чата…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit">Искать</button>
        </div>
        <div className={styles.filters}>
          <label>
            Где
            <select
              value={scope}
              onChange={(event) => apply({ scope: event.target.value as Scope })}
            >
              <option value="all">Везде</option>
              <option value="general">Обычные чаты</option>
              <option value="project">Проекты</option>
            </select>
          </label>
          <label>
            Проект
            <select
              value={project}
              onChange={(event) =>
                apply({
                  project: event.target.value,
                  scope: event.target.value ? "project" : scope
                })
              }
            >
              <option value="">Все проекты</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Архив
            <select
              value={archive}
              onChange={(event) => apply({ archive: event.target.value as Archive })}
            >
              <option value="active">Без архива</option>
              <option value="archived">Только архив</option>
              <option value="all">Включая архив</option>
            </select>
          </label>
          <label>
            С даты
            <input
              type="date"
              value={after}
              max={before || undefined}
              onChange={(event) => apply({ after: event.target.value })}
            />
          </label>
          <label>
            По дату
            <input
              type="date"
              value={before}
              min={after || undefined}
              onChange={(event) => apply({ before: event.target.value })}
            />
          </label>
        </div>
      </form>
      <div className={styles.results} ref={listRef} aria-live="polite" aria-busy={loading}>
        <div className={styles.resultsHeader}>
          <h2>Результаты</h2>
          {query && (
            <button type="button" onClick={reload} disabled={loading}>
              Обновить
            </button>
          )}
        </div>
        {!query.trim() && (
          <p className={styles.muted}>Введите запрос, чтобы найти прежний диалог.</p>
        )}
        {loading && <p role="status">Поиск…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        )}
        {!loading && !error && query && page?.items.length === 0 && (
          <p className={styles.muted}>
            Ничего не найдено. Попробуйте другие слова или фильтр архива.
          </p>
        )}
        {!loading && !error && page && page.items.length > 0 && (
          <>
            <p className={styles.muted}>
              Показаны {offset + 1}–{offset + page.items.length} результатов.
            </p>
            <ol start={offset + 1} className={styles.list}>
              {page.items.map((hit, index) => (
                <li key={`${hit.scope}-${hit.message_id ?? hit.chat_id}-${index}`}>
                  <a
                    href={hrefFor(hit)}
                    onClick={rememberScroll}
                    className={styles.hit}
                    aria-label={`Открыть ${hit.scope === "project" ? "проект" : "чат"}: ${hit.title}`}
                  >
                    <span className={styles.meta}>
                      {hit.scope === "project" ? "Проект" : "Чат"}
                      {hit.archived ? " · Архив" : ""} ·{" "}
                      {new Date(hit.created_at).toLocaleDateString("ru")}
                    </span>
                    <strong>{highlightPlainText(hit.title, query)}</strong>
                    <span className={styles.snippet}>{highlightPlainText(hit.snippet, query)}</span>
                    <span className={styles.open}>
                      Перейти к {hit.message_id ? "сообщению" : "чату"} →
                    </span>
                  </a>
                </li>
              ))}
            </ol>
            <nav className={styles.paging} aria-label="Страницы поиска">
              <button
                type="button"
                disabled={loading || offset === 0}
                onClick={() => apply({ offset: Math.max(0, offset - PAGE_SIZE) })}
              >
                ← Назад
              </button>
              <button
                type="button"
                disabled={loading || page.next_offset === null}
                onClick={() => apply({ offset: page.next_offset ?? offset })}
              >
                Далее →
              </button>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
