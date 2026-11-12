"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./research-workspace.module.css";

const resultLabels = {
  unchanged: "Прочитанный текст совпадает с сохранённым.",
  changed: "Прочитанный текст изменился после сохранения отчёта.",
  no_baseline: "Страница прочитана. Для этого отчёта нет сохранённого отпечатка текста.",
  unavailable: "Прочитать страницу сейчас не удалось."
};

export type SourceRecheckResult = {
  status: keyof typeof resultLabels;
  checked_at: string;
};

export function ResearchSourceRecheck({
  sources,
  check
}: {
  sources: { title: string; url: string }[];
  check: (index: number, signal: AbortSignal) => Promise<SourceRecheckResult>;
}) {
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SourceRecheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (request.current || !sources[index]) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult(null);
    setError(null);
    try {
      const response = await check(index, controller.signal);
      if (!controller.signal.aborted) setResult(response);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Не удалось проверить источник.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  return (
    <details className={styles.comparison}>
      <summary>Перепроверить источник</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Источник для перепроверки
          <select
            value={index}
            disabled={pending}
            onChange={(event) => {
              setIndex(Number(event.target.value));
              setResult(null);
              setError(null);
            }}
          >
            {sources.map((source, position) => (
              <option key={source.url} value={position}>
                S{position + 1}. {source.title}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <button type="submit" disabled={pending}>
            Проверить сейчас
          </button>
        </div>
      </form>
      {pending && <p role="status">Читаем страницу…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <p role="status">
          {resultLabels[result.status]} {new Date(result.checked_at).toLocaleString("ru")}
        </p>
      )}
    </details>
  );
}
