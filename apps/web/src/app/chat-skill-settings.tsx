"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatSkillReference, ChatSkillSelection } from "@cosmora/contracts/chat-skills";
import styles from "./chat-skill-settings.module.css";

type CatalogSkill = { id: string; name: string; summary: string; current_version: number };
const refs = (s: ChatSkillSelection) =>
  s.items.map(({ skill_id, version }) => ({ skill_id, version }));
const same = (a: ChatSkillReference[], b: ChatSkillReference[]) =>
  JSON.stringify(a) === JSON.stringify(b);
async function read<T>(url: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? "Не удалось загрузить Skills.");
  }
  return response.json() as Promise<T>;
}
export function ChatSkillSettings({ chatId, disabled }: { chatId: string; disabled: boolean }) {
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [stored, setStored] = useState<ChatSkillSelection | null>(null);
  const [chosen, setChosen] = useState<ChatSkillReference[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/skills`;
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void Promise.all([
      read<{ items: CatalogSkill[] }>("/api/v1/owner-skills", c.signal),
      read<{ selection: ChatSkillSelection }>(path, c.signal)
    ])
      .then(([a, b]) => {
        if (!c.signal.aborted) {
          setCatalog(a.items);
          setStored(b.selection);
          setChosen(refs(b.selection));
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError("Не удалось загрузить Skills. Повторите загрузку.");
      });
    return () => c.abort();
  }, [path]);
  const reload = async () => {
    const c = controller.current;
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const [a, b] = await Promise.all([
        read<{ items: CatalogSkill[] }>("/api/v1/owner-skills", c.signal),
        read<{ selection: ChatSkillSelection }>(path, c.signal)
      ]);
      if (!c.signal.aborted) {
        setCatalog(a.items);
        setStored(b.selection);
        setChosen(refs(b.selection));
      }
    } catch {
      if (!c.signal.aborted) setError("Не удалось загрузить Skills.");
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  const save = async (items: ChatSkillReference[]) => {
    const c = controller.current;
    if (!stored || !c || busy || disabled) return;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      let selection: ChatSkillSelection;
      try {
        selection = (
          await read<{ selection: ChatSkillSelection }>(path, c.signal, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expected_version: stored.version, items })
          })
        ).selection;
      } catch (cause) {
        if (c.signal.aborted) return;
        // Read-only recovery: never repeat a write after an uncertain response.
        const latest = (await read<{ selection: ChatSkillSelection }>(path, c.signal)).selection;
        if (latest.version !== stored.version + 1 || !same(refs(latest), items)) throw cause;
        selection = latest;
      }
      if (!c.signal.aborted) {
        setStored(selection);
        setChosen(refs(selection));
        setStatus(items.length ? "Skills сохранены." : "Skills отключены.");
      }
    } catch (cause) {
      if (!c.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось сохранить Skills.");
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  return (
    <fieldset className={styles.skills} aria-label="Skills чата">
      <legend>Skills чата</legend>
      <p>
        До трёх личных инструкций для следующих ответов. Новые версии подключаются по вашему выбору.
      </p>
      <a href="/skills">Управлять личными Skills</a>
      {stored && catalog.length === 0 && <p>Создайте Skill, чтобы подключить его к чату.</p>}
      {catalog.map((skill) => {
        const selected = chosen.find((x) => x.skill_id === skill.id);
        return (
          <div key={skill.id} className={styles.item}>
            <label className={styles.choice}>
              <input
                type="checkbox"
                checked={!!selected}
                disabled={busy || disabled || !stored || (!selected && chosen.length >= 3)}
                onChange={(e) => {
                  setStatus("");
                  setChosen(
                    e.target.checked
                      ? [...chosen, { skill_id: skill.id, version: skill.current_version }]
                      : chosen.filter((x) => x.skill_id !== skill.id)
                  );
                }}
              />
              <span>
                {skill.name}
                <small>{skill.summary}</small>
              </span>
            </label>
            {selected && (
              <p>
                Выбрана v{selected.version}
                {selected.version !== skill.current_version
                  ? ` · доступна v${skill.current_version}`
                  : ""}
              </p>
            )}
            {selected && selected.version !== skill.current_version && (
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() =>
                  setChosen(
                    chosen.map((x) =>
                      x.skill_id === skill.id ? { ...x, version: skill.current_version } : x
                    )
                  )
                }
              >
                Обновить {skill.name} до v{skill.current_version}
              </button>
            )}
          </div>
        );
      })}
      {!!stored?.items.length && (
        <details>
          <summary>Подключённые инструкции</summary>
          {stored.items.map((item) => (
            <div key={item.skill_id}>
              <strong>
                {item.name} · v{item.version}
              </strong>
              <pre className={styles.preview}>{item.instructions}</pre>
            </div>
          ))}
        </details>
      )}
      {stored && (
        <small>
          {stored.items.length} подключено{!same(chosen, refs(stored)) ? " · Не сохранено" : ""}
        </small>
      )}
      <button
        type="button"
        disabled={!stored || busy || disabled || same(chosen, refs(stored))}
        onClick={() => void save(chosen)}
      >
        Сохранить Skills
      </button>
      <button
        type="button"
        disabled={!stored?.items.length || busy || disabled}
        onClick={() => void save([])}
      >
        Отключить все Skills
      </button>
      <button type="button" disabled={busy || disabled} onClick={() => void reload()}>
        Загрузить сохранённый выбор
      </button>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
