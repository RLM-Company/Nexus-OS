"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatSkillSnapshot } from "@cosmora/contracts/chat-skills";
import styles from "./chat-skill-settings.module.css";

/** Lazy, literal read of the accepted request, independent of today's selection/catalog. */
export function ChatRunSkills({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<{
    selection_version: number;
    items: ChatSkillSnapshot[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load() {
    if (snapshot || active.current) return;
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/v1/chat-runs/${encodeURIComponent(runId)}/skills`, {
        cache: "no-store",
        signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)])
      });
      if (!response.ok) throw new Error("snapshot unavailable");
      const body = (await response.json()) as {
        snapshot: { selection_version: number; items: ChatSkillSnapshot[] };
      };
      if (!c.signal.aborted) setSnapshot(body.snapshot);
    } catch {
      if (!c.signal.aborted) setError(true);
    } finally {
      if (active.current === c) active.current = null;
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return (
    <details
      aria-label="Skills этого ответа"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Skills этого ответа</summary>
      {busy && <p role="status">Загрузка инструкций…</p>}
      {error && (
        <p role="alert">
          Снимок временно недоступен.{" "}
          <button type="button" onClick={() => void load()}>
            Повторить загрузку инструкций
          </button>
        </p>
      )}
      {snapshot && (
        <>
          <p>
            Инструкции, закреплённые при приёме запроса. Изменения и удаление Skills в каталоге не
            меняют этот снимок.
          </p>
          {!snapshot.items.length && <p>Для этого ответа личные Skills не были подключены.</p>}
          {snapshot.items.map((item) => (
            <div key={item.skill_id}>
              <strong>
                {item.name} · v{item.version}
              </strong>
              <pre className={styles.preview}>{item.instructions}</pre>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
