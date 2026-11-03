"use client";
import type { ProjectMemoryEntry, ProjectMemoryInput } from "@cosmora/contracts";
import { useEffect, useRef, useState } from "react";
import styles from "./work-manager.module.css";
import { ContextMemorySettings } from "./context-memory-settings";

const empty: ProjectMemoryInput = {
  title: "",
  content: "",
  pinned: false,
  source: { kind: "owner", reference: "Запись владельца" }
};
const sourceLabels = { owner: "Владелец", reference: "Источник", artifact: "Артефакт" };

export function WorkManagerMemory({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProjectMemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<ProjectMemoryInput>(empty);
  const [editing, setEditing] = useState<ProjectMemoryEntry | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const epoch = useRef(0);
  const base = "/api/v1/projects/" + encodeURIComponent(projectId) + "/memory";
  useEffect(() => {
    setDraft(empty);
    setEditing(null);
    setItems([]);
    setQuery("");
    setError("");
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController();
    const current = epoch.current;
    const timer = setTimeout(() => {
      void fetch(base + "?q=" + encodeURIComponent(query), {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)])
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("MEMORY_UNAVAILABLE");
          const result = (await response.json()) as { items: ProjectMemoryEntry[] };
          if (!controller.signal.aborted && current === epoch.current) {
            setItems(result.items);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Не удалось загрузить память проекта");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, query, revision]);
  const mutate = async (entry?: ProjectMemoryEntry, action?: "pin" | "unpin" | "forget") => {
    if (lock.current) return;
    lock.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      const url =
        action && entry
          ? base + "/" + encodeURIComponent(entry.id) + "/control"
          : editing
            ? base + "/" + encodeURIComponent(editing.id)
            : base;
      const response = await fetch(url, {
        method: action || !editing ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify(
          action && entry
            ? { version: entry.version, action }
            : editing
              ? { ...draft, version: editing.version }
              : draft
        )
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "Запись изменилась или достигнут лимит. Обновите список и повторите действие."
            : "Не удалось сохранить память"
        );
      if (!action || (entry?.id === editing?.id && action === "forget")) {
        setDraft(empty);
        setEditing(null);
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "TimeoutError"
          ? "Ответ задерживается. Проверьте список памяти перед повторным сохранением."
          : cause instanceof Error
            ? cause.message
            : "Ошибка памяти"
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setRevision((r) => r + 1);
    }
  };
  return (
    <section className={styles.panel} aria-label="Память проекта">
      <h3>Память проекта</h3>
      <p>
        Сохраните требования и факты с источником. Закреплённые записи получают приоритет. Контекст
        ограничен 12 записями и 8 000 символами.
      </p>
      <label>
        Поиск в памяти
        <input
          aria-label="Поиск в памяти"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button disabled={busy} onClick={() => setRevision((r) => r + 1)}>
        Обновить память
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ul className={styles.entries}>
        {items.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <strong>
              {entry.pinned ? "Закреплено · " : ""}
              {entry.title}
            </strong>
            <p>{entry.content}</p>
            <small>
              {sourceLabels[entry.source.kind]}: {entry.source.reference} · версия {entry.version}
            </small>
            <div className={styles.actions}>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(entry);
                  setDraft({
                    title: entry.title,
                    content: entry.content,
                    source: entry.source,
                    pinned: entry.pinned
                  });
                }}
              >
                Изменить
              </button>
              <button
                disabled={busy}
                onClick={() => void mutate(entry, entry.pinned ? "unpin" : "pin")}
              >
                {entry.pinned ? "Открепить" : "Закрепить"}
              </button>
              <button disabled={busy} onClick={() => void mutate(entry, "forget")}>
                Забыть
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p>Записей по запросу нет.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate();
        }}
      >
        <h3>{editing ? "Изменить запись" : "Добавить запись"}</h3>
        <label>
          Название
          <input
            aria-label="Название записи"
            required
            maxLength={160}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            disabled={busy}
          />
        </label>
        <label>
          Содержание
          <textarea
            aria-label="Содержание записи"
            required
            rows={4}
            maxLength={4000}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            disabled={busy}
          />
        </label>
        <label>
          Тип источника
          <select
            value={draft.source.kind}
            onChange={(e) =>
              setDraft({
                ...draft,
                source: {
                  ...draft.source,
                  kind: e.target.value as ProjectMemoryInput["source"]["kind"]
                }
              })
            }
            disabled={busy}
          >
            <option value="owner">Владелец</option>
            <option value="reference">Источник</option>
            <option value="artifact">Артефакт проекта (ID)</option>
          </select>
        </label>
        <label>
          Источник
          <input
            aria-label="Источник записи"
            required
            maxLength={500}
            value={draft.source.reference}
            onChange={(e) =>
              setDraft({ ...draft, source: { ...draft.source, reference: e.target.value } })
            }
            disabled={busy}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            disabled={busy}
          />
          Закрепить
        </label>
        <div className={styles.actions}>
          <button
            type="submit"
            disabled={
              busy || !draft.title.trim() || !draft.content.trim() || !draft.source.reference.trim()
            }
          >
            {editing ? "Сохранить запись" : "Добавить в память"}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDraft(empty);
              }}
            >
              Отменить изменение
            </button>
          )}
        </div>
      </form>
      <small>
        «Забыть» удаляет запись из памяти и следующих обращений. История уже принятых задач и
        созданные файлы сохраняются.
      </small>
      <ContextMemorySettings target={{ kind: "project", id: projectId }} disabled={busy} />
    </section>
  );
}
