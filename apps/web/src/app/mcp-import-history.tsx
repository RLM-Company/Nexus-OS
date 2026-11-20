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

const copyStatus = {
  matched: "В материалах есть точная копия.",
  changed: "Файл с этим именем изменён.",
  missing: "Файл убран из материалов."
};

export function McpImportHistory({ path, refresh }: { path: string; refresh: number }) {
  const [shown, setShown] = useState(false);
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const controller = new AbortController();
    void fetch(path + "/document/imports", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as { items: ImportItem[] };
        if (!controller.signal.aborted) {
          setItems(value.items);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [path, refresh, shown]);

  return (
    <section aria-label="История импорта MCP">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => {
          if (!shown) {
            setItems(null);
            setError(false);
          }
          setShown(!shown);
        }}
      >
        {shown ? "Скрыть историю импорта MCP" : "История импорта MCP"}
      </button>
      {shown &&
        (error ? (
          <p role="alert">История импорта недоступна.</p>
        ) : items === null ? (
          <p role="status">Загружаем историю…</p>
        ) : items.length === 0 ? (
          <p>История пока пуста.</p>
        ) : (
          <ul>
            {items.map((item) => (
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
        ))}
    </section>
  );
}
