"use client";
import { useEffect, useState } from "react";
import type { AcceptedWorkSkills } from "@cosmora/contracts";
import styles from "./chat-skill-settings.module.css";

/** Read-only provenance. Opening this never dispatches a model request. */
export function AcceptedSkillView({ path, label }: { path: string; label: string }) {
  const [snapshot, setSnapshot] = useState<AcceptedWorkSkills | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void fetch(path, {
      cache: "no-store",
      signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)])
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("snapshot unavailable");
        const value = (await r.json()) as { snapshot: AcceptedWorkSkills };
        if (!c.signal.aborted) {
          setSnapshot(value.snapshot);
          setError(false);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [path, attempt]);
  return (
    <details aria-label={label}>
      <summary>
        {label}
        {snapshot ? ` · ${snapshot.items.length}` : ""}
      </summary>
      {error ? (
        <p role="alert">
          Не удалось загрузить снимок.{" "}
          <button type="button" onClick={() => setAttempt((x) => x + 1)}>
            Повторить загрузку
          </button>
        </p>
      ) : !snapshot ? (
        <p>Загрузка снимка…</p>
      ) : (
        <>
          <p>
            {snapshot.source === "legacy"
              ? "Эта работа принята до подключения Skills и не использует их."
              : snapshot.source === "plan"
                ? "Инструкции закреплены при сохранении плана. Изменения каталога и выбора проекта не меняют эту попытку."
                : "Сохранённый снимок инструкций на момент приёма. Изменения каталога и выбора проекта не меняют его."}
          </p>
          {!snapshot.items.length && <p>Без личных Skills.</p>}
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
