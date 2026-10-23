"use client";
import { useEffect, useState } from "react";
import {
  isIntelligenceGraphSavedContextStatus,
  type IntelligenceGraphSavedContextStatus
} from "@cosmora/contracts";

export function SavedContextStatus({
  url,
  busy,
  onPrepare
}: {
  url: string;
  busy: boolean;
  onPrepare: (query: string, revision: number) => void;
}) {
  const [status, setStatus] = useState<IntelligenceGraphSavedContextStatus | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${url}/status`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось проверить сохранённый снимок.");
        const result: unknown = await response.json();
        if (!isIntelligenceGraphSavedContextStatus(result)) throw new Error("Invalid status");
        if (!controller.signal.aborted) setStatus(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Не удалось проверить сохранённый снимок.");
      });
    return () => controller.abort();
  }, [url, refresh]);
  return (
    <section
      aria-label="Актуальность сохранённого контекста"
      style={{ background: "#f5f5f5", padding: 12, borderRadius: 8, marginBlock: 12 }}
    >
      <h3 style={{ marginTop: 0 }}>Снимок в материалах проекта</h3>
      <div role="status">
        {error ? (
          <p>{error}</p>
        ) : !status ? (
          <p>Проверяем сохранённый снимок…</p>
        ) : status.status === "missing" ? (
          <p>Снимок этого графа ещё не добавлен в материалы проекта.</p>
        ) : status.status === "unrecognized" ? (
          <p>
            Файл с именем снимка есть, но его содержимое не удалось подтвердить по истории графа.
            Его актуальность неизвестна. Подготовьте и просмотрите новый контекст перед заменой.
          </p>
        ) : (
          <>
            <p>
              {status.status === "stale"
                ? `Снимок устарел: сохранена ревизия ${status.saved.revision}, текущая — ${status.graph_revision}.`
                : `Сохранена текущая ревизия ${status.saved.revision}.`}
            </p>
            <p>Сохранённый запрос: {status.saved.query}</p>
            <p>
              Совпадение ревизии не подтверждает истинность утверждений. Правки графа не обновляют
              материалы проекта автоматически.
            </p>
          </>
        )}
      </div>
      {!error && status?.saved && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 8 }}>
          <button
            disabled={busy}
            type="button"
            onClick={() => onPrepare(status.saved.query, status.saved.revision)}
          >
            Просмотреть сохранённый снимок
          </button>
          {status.status === "stale" && (
            <button
              disabled={busy}
              type="button"
              onClick={() => onPrepare(status.saved.query, status.graph_revision)}
            >
              Подготовить актуальную версию
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setStatus(null);
          setError("");
          setRefresh((value) => value + 1);
        }}
      >
        Проверить актуальность
      </button>
    </section>
  );
}
