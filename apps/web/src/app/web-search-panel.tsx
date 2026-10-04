"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatTextAttachment } from "@cosmora/contracts/chat-attachments";

type Results = {
  query: string;
  searched_at: string;
  items: Array<{ title: string; url: string; snippet: string }>;
};
export function WebSearchPanel({
  scope,
  disabled,
  onAttach
}: {
  scope: string;
  disabled: boolean;
  onAttach: (file: ChatTextAttachment) => boolean;
}) {
  const [configured, setConfigured] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    void fetch("/api/v1/web-search/status")
      .then(async (response) =>
        response.ok ? (response.json() as Promise<{ configured: boolean }>) : null
      )
      .then((value) => setConfigured(value?.configured === true))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    epoch.current++;
    setResults(null);
    setQuery("");
    setError(null);
    setPending(false);
  }, [scope]);
  if (!configured) return null;
  const runSearch = async () => {
    const id = ++epoch.current;
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/v1/web-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: query }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error("Поиск сейчас недоступен. Попробуйте позже.");
      const data = (await response.json()) as Results;
      if (id === epoch.current) setResults(data);
    } catch (cause) {
      if (id === epoch.current) setError(cause instanceof Error ? cause.message : "Ошибка поиска");
    } finally {
      if (id === epoch.current) setPending(false);
    }
  };
  return (
    <details className="web-search-panel">
      <summary>Поиск в интернете</summary>
      <p>
        Поисковым системам отправляется только введённый запрос. Выбранные ссылки и краткие выдержки
        можно приложить к сообщению. Полные страницы не загружаются.
      </p>
      <label>
        Поисковый запрос
        <input
          value={query}
          maxLength={240}
          disabled={disabled || pending}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (query.trim() && !pending && !disabled) void runSearch();
            }
          }}
        />
      </label>
      <button
        type="button"
        disabled={disabled || pending || !query.trim()}
        onClick={() => void runSearch()}
      >
        {pending ? "Ищу…" : "Найти источники"}
      </button>
      {error && <p role="alert">{error}</p>}
      {results && (
        <>
          <ul>
            {results.items.map((item) => (
              <li key={item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
                <p>{item.snippet}</p>
              </li>
            ))}
          </ul>
          {results.items.length ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const content = `Результаты поиска: ${results.query}\nДата: ${results.searched_at}\nЭто краткие выдержки поисковой системы, не проверенный полный текст страниц.\n\n${results.items.map((item, index) => `[${index + 1}] ${item.title}\n${item.url}\n${item.snippet}`).join("\n\n")}`;
                if (onAttach({ name: "web-sources.md", content })) setResults(null);
                else
                  setError(
                    "Источники не поместились. Уберите один из файлов или уменьшите контекст."
                  );
              }}
            >
              Приложить источники к сообщению
            </button>
          ) : (
            <p>Источники не найдены. Попробуйте другой запрос.</p>
          )}
        </>
      )}
    </details>
  );
}
