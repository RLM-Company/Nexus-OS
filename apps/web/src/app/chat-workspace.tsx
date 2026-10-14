"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./chat-workspace.module.css";
import { pinnedNavigationKey, readPinnedNavigation } from "./pinned-navigation";

type Navigation = {
  folders: Array<{ id: string; title: string }>;
  assignments: Array<{ chat_id: string; folder_id: string }>;
  chats: string[];
  projects: string[];
};
type Context = {
  excluded_ids: string[];
  summary: string;
  summary_through: string | null;
  version: number;
  updated_at: string | null;
};
type Message = { id: string; role: string; content: string; status: string };
const empty: Navigation = { folders: [], assignments: [], chats: [], projects: [] };
async function request<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "PUT",
  signal?: AbortSignal
): Promise<T> {
  const r = await fetch(path, {
    method,
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  });
  const data = (await r.json()) as T & { error?: { message?: string } };
  if (!r.ok)
    throw new Error(
      data.error?.message ?? "Не удалось сохранить изменение. Обновите состояние перед повтором."
    );
  return data;
}
export function useChatNavigation() {
  const [navigation, setNavigation] = useState<Navigation>(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    const load = () => {
      if (pending.current) return;
      const observed = revision.current;
      void request<Navigation>("/api/v1/chat-navigation", undefined, "GET", controller.signal)
        .then((n) => {
          if (!controller.signal.aborted && observed === revision.current) {
            setNavigation(n);
            setReady(true);
            setNotice(null);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setNotice("Не удалось загрузить папки и закрепления с сервера.");
        });
    };
    void request<{ owner_id: string }>(
      "/api/v1/navigation-context",
      undefined,
      "GET",
      controller.signal
    )
      .then(async ({ owner_id }) => {
        const legacy = readPinnedNavigation(window.localStorage, pinnedNavigationKey(owner_id));
        const next = await request<Navigation>(
          "/api/v1/chat-navigation/import-pins",
          legacy,
          "POST",
          controller.signal
        );
        if (!controller.signal.aborted) {
          setNavigation(next);
          setReady(true);
        }
      })
      .catch(() => load());
    window.addEventListener("focus", load);
    return () => {
      live.current = false;
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, []);
  async function mutate(path: string, body?: unknown, method?: string) {
    if (pending.current) return false;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setNotice(null);
    try {
      const next = await request<Navigation>(path, body, method);
      if (live.current) setNavigation(next);
      return true;
    } catch (cause) {
      if (live.current) {
        setNotice(cause instanceof Error ? cause.message : "Не удалось сохранить.");
        // Reconcile an uncertain write once with a read, never resend it automatically.
        try {
          setNavigation(await request<Navigation>("/api/v1/chat-navigation"));
        } catch {
          /* Keep last known state. */
        }
      }
      return false;
    } finally {
      pending.current = false;
      revision.current++;
      if (live.current) setBusy(false);
    }
  }
  return { navigation, ready: ready && !busy, notice, mutate };
}
export function ChatFolders({
  navigation,
  ready,
  chatId,
  onChange,
  onFilter,
  filter
}: {
  navigation: Navigation;
  ready: boolean;
  chatId: string | null;
  onChange: (path: string, body?: unknown, method?: string) => Promise<boolean>;
  onFilter: (id: string) => void;
  filter: string;
}) {
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <details className={styles.folders}>
      <summary>Папки чатов</summary>
      <label>
        Показать папку
        <select
          aria-label="Фильтр папки чатов"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        >
          <option value="">Все чаты</option>
          <option value="unfiled">Без папки</option>
          {navigation.folders.map((f) => (
            <option value={f.id} key={f.id}>
              {f.title}
            </option>
          ))}
        </select>
      </label>
      {chatId && (
        <label>
          Текущий чат
          <select
            aria-label="Папка текущего чата"
            disabled={!ready}
            value={navigation.assignments.find((a) => a.chat_id === chatId)?.folder_id ?? ""}
            onChange={(e) =>
              void onChange(`/api/v1/chats/${encodeURIComponent(chatId)}/folder`, {
                folder_id: e.target.value || null
              })
            }
          >
            <option value="">Без папки</option>
            {navigation.folders.map((f) => (
              <option value={f.id} key={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !ready) return;
          const id = editing ?? crypto.randomUUID();
          void onChange(`/api/v1/chat-navigation/folders/${id}`, { title: title.trim() }).then(
            (saved) => {
              if (!saved) return;
              setTitle("");
              setEditing(null);
            }
          );
        }}
      >
        <label>
          {editing ? "Название папки" : "Новая папка"}
          <input
            aria-label="Название папки"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button disabled={!ready || !title.trim()}>
          {editing ? "Сохранить название" : "Создать папку"}
        </button>
      </form>
      {navigation.folders.map((f) => (
        <div className={styles.folderRow} key={f.id}>
          <span>{f.title}</span>
          <button
            disabled={!ready}
            onClick={() => {
              setEditing(f.id);
              setTitle(f.title);
            }}
          >
            Переименовать
          </button>
          <button
            disabled={!ready}
            onClick={() =>
              void onChange(`/api/v1/chat-navigation/folders/${f.id}`, undefined, "DELETE").then(
                (saved) => {
                  if (!saved) return;
                  if (filter === f.id) onFilter("");
                }
              )
            }
          >
            Убрать папку
          </button>
        </div>
      ))}
      <small>При удалении папки переписки сохраняются.</small>
    </details>
  );
}

export function ChatContextPanel({
  chatId,
  messages,
  disabled,
  onClose
}: {
  chatId: string;
  messages: Message[];
  disabled: boolean;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<Context | null>(null),
    [excluded, setExcluded] = useState<string[]>([]),
    [summary, setSummary] = useState(""),
    [through, setThrough] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/context`;
  const accept = (c: Context) => {
    setSaved(c);
    setExcluded(c.excluded_ids);
    setSummary(c.summary);
    setThrough(c.summary_through);
  };
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void request<{ context: Context }>(path, undefined, "GET", c.signal)
      .then((d) => {
        if (!c.signal.aborted) accept(d.context);
      })
      .catch(() => {
        if (!c.signal.aborted) setNotice("Не удалось загрузить контекст.");
      });
    return () => c.abort();
  }, [path]);
  async function load() {
    try {
      const d = await request<{ context: Context }>(
        path,
        undefined,
        "GET",
        controller.current?.signal
      );
      if (!controller.current?.signal.aborted) {
        accept(d.context);
        setNotice("Загружена сохранённая версия.");
      }
    } catch {
      setNotice("Не удалось обновить контекст.");
    }
  }
  async function save() {
    if (!saved || locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice("");
    const input = {
      expected_version: saved.version,
      excluded_ids: excluded,
      summary,
      summary_through: through
    };
    try {
      let c: Context;
      try {
        c = (await request<{ context: Context }>(path, input, "PUT", controller.current?.signal))
          .context;
      } catch (cause) {
        const actual = (
          await request<{ context: Context }>(path, undefined, "GET", controller.current?.signal)
        ).context;
        if (
          actual.version !== saved.version + 1 ||
          actual.summary !== summary ||
          actual.summary_through !== through ||
          JSON.stringify(actual.excluded_ids) !== JSON.stringify(excluded)
        )
          throw cause;
        c = actual;
      }
      if (!controller.current?.signal.aborted) {
        accept(c);
        setNotice("Контекст сохранён. История переписки осталась целой.");
      }
    } catch (cause) {
      if (!controller.current?.signal.aborted)
        setNotice(
          cause instanceof Error ? cause.message : "Не удалось сохранить. Черновик сохранён в окне."
        );
    } finally {
      locked.current = false;
      if (!controller.current?.signal.aborted) setBusy(false);
    }
  }
  async function draft() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const d = await request<{ summary: string; summary_through: string }>(
        path + "/draft",
        { excluded_ids: excluded },
        "POST",
        controller.current?.signal
      );
      if (!controller.current?.signal.aborted) {
        setSummary(d.summary);
        setThrough(d.summary_through);
        setNotice(
          "Подготовлена сокращённая выдержка без AI-запроса. Проверьте и отредактируйте её перед сохранением."
        );
      }
    } catch (cause) {
      if (!controller.current?.signal.aborted)
        setNotice(cause instanceof Error ? cause.message : "Не удалось подготовить выдержку.");
    } finally {
      locked.current = false;
      if (!controller.current?.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Контекст переписки">
      <header>
        <h2>Контекст переписки</h2>
        <button disabled={busy} onClick={onClose}>
          Закрыть контекст
        </button>
      </header>
      <p>
        Выберите, что учитывать в следующих ответах. Сами сообщения не удаляются. Последний
        отправляемый запрос учитывается всегда. Если факт повторён в другом ответе или заметках
        памяти, исключите его там тоже.
      </p>
      <fieldset disabled={busy || disabled || !saved}>
        <legend>Сообщения в контексте</legend>
        <div className={styles.messageList}>
          {messages
            .filter((m) => m.status === "completed")
            .map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  aria-label={`Учитывать: ${m.content.slice(0, 60)}`}
                  checked={!excluded.includes(m.id)}
                  onChange={(e) => {
                    setExcluded((current) =>
                      e.target.checked ? current.filter((id) => id !== m.id) : [...current, m.id]
                    );
                    setSummary("");
                    setThrough(null);
                    setNotice(
                      "Изменения не сохранены. Старая сводка очищена, чтобы исключённый текст в ней не остался."
                    );
                  }}
                />
                <span>
                  <strong>{m.role === "user" ? "Вы" : "Kosmora"}</strong> {m.content.slice(0, 240)}
                </span>
              </label>
            ))}
        </div>
        <label>
          Сводка ранней истории
          <textarea
            aria-label="Сводка ранней истории"
            rows={5}
            maxLength={8000}
            value={summary}
            disabled={!through}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <p>
          Сохранённая сводка заменяет раннюю историю в новых запросах. Восемь последних сообщений на
          момент подготовки остаются целиком. Это сокращённая выдержка: перед сохранением проверьте
          важные факты.
        </p>
        <button onClick={() => void draft()} type="button">
          Подготовить выдержку
        </button>
        <button
          onClick={() => {
            setSummary("");
            setThrough(null);
          }}
          type="button"
        >
          Убрать сводку
        </button>
        <button onClick={() => void save()} type="button">
          Сохранить контекст
        </button>
      </fieldset>
      <button disabled={busy} onClick={() => void load()}>
        Загрузить сохранённый контекст
      </button>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function ChatToCanvas({
  chatId,
  message,
  projects
}: {
  chatId: string;
  message: Message;
  projects: Array<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false),
    [project, setProject] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [link, setLink] = useState("");
  const locked = useRef(false);
  async function transfer() {
    if (!project || locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice("");
    try {
      await request(
        `/api/v1/projects/${encodeURIComponent(project)}/canvas/import`,
        {
          title: message.content.replace(/\s+/g, " ").slice(0, 80) || "Ответ Kosmora",
          format: "markdown",
          source: { kind: "chat", chat_id: chatId, message_id: message.id }
        },
        "POST"
      );
      setLink(`/?project=${encodeURIComponent(project)}`);
      setNotice("Ответ сохранён в Canvas проекта.");
    } catch {
      setNotice("Не удалось подтвердить перенос. Проверьте Canvas проекта перед повтором.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <span className={styles.transfer}>
      {!open ? (
        <button onClick={() => setOpen(true)}>В Canvas</button>
      ) : (
        <>
          <label>
            Проект для Canvas
            <select
              aria-label="Проект для Canvas"
              disabled={busy || !!link}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">Выберите проект</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !project || !!link} onClick={() => void transfer()}>
            Сохранить ответ в Canvas
          </button>
          <button disabled={busy} onClick={() => setOpen(false)}>
            Свернуть
          </button>
          {projects.length === 0 && <small>Сначала создайте проект для артефакта.</small>}
          {notice && <span role="status">{notice}</span>}
          {link && <Link href={link}>Открыть проект</Link>}
        </>
      )}
    </span>
  );
}
