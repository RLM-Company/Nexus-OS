"use client";

import { useEffect, useState } from "react";

type ImportItem = {
  operation_id: string;
  name: string;
  source: string;
  sha256: string;
  version: number;
  copy: "matched" | "changed" | "missing";
};
type ImportPage = { items: ImportItem[]; next_cursor?: string };

const copyStatus = {
  matched: "В материалах есть точная копия.",
  changed: "Файл с этим именем изменён.",
  missing: "Файл убран из материалов."
};

function McpHistoryPages({ path }: { path: string }) {
  const [request, setRequest] = useState<{ before?: string }>({});
  const [page, setPage] = useState<ImportPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const query = request.before ? `?before=${encodeURIComponent(request.before)}` : "";
    void fetch(path + "/document/imports" + query, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as ImportPage;
        if (!controller.signal.aborted)
          setPage((previous) => ({
            ...value,
            items: request.before ? [...(previous?.items ?? []), ...value.items] : value.items
          }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, request]);

  function load(before?: string) {
    setLoading(true);
    setError(false);
    setRequest(before ? { before } : {});
  }

  return (
    <>
      {page?.items.length === 0 && <p>История пока пуста.</p>}
      {page && page.items.length > 0 && (
        <ul>
          {page.items.map((item) => (
            <li key={item.operation_id}>
              <strong>{item.name}</strong>
              <p>
                Источник: <code>{item.source}</code>
              </p>
              <p>
                Версия материалов: {item.version}. {copyStatus[item.copy]}
              </p>
              <p>
                SHA-256: <code style={{ overflowWrap: "anywhere" }}>{item.sha256}</code>
              </p>
              <p>
                Операция: <code>{item.operation_id}</code>
              </p>
            </li>
          ))}
        </ul>
      )}
      {loading && <p role="status">Загружаем историю…</p>}
      {error && (
        <p role="alert">
          {page ? "Более ранние записи недоступны." : "История импорта недоступна."}
        </p>
      )}
      {(page?.next_cursor || error) && (
        <button type="button" disabled={loading} onClick={() => load(page?.next_cursor)}>
          {error ? "Повторить загрузку" : "Показать более ранние импорты"}
        </button>
      )}
    </>
  );
}

export function McpImportHistory({ path, refresh }: { path: string; refresh: number }) {
  const [shown, setShown] = useState(false);
  return (
    <section aria-label="История импорта MCP">
      <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)}>
        {shown ? "Скрыть историю импорта MCP" : "История импорта MCP"}
      </button>
      {shown && <McpHistoryPages key={`${path}:${refresh}`} path={path} />}
    </section>
  );
}
