"use client";

import { useState } from "react";
import styles from "./research-workspace.module.css";

type ResearchSourceStatus =
  "read" | "duplicate" | "robots_denied" | "network_denied" | "unavailable";

export type ResearchSourceSnapshot = {
  title: string;
  url: string;
  status: ResearchSourceStatus;
  passages: string[];
  content_digest?: string;
};

type SavedResearch = {
  id: string;
  question: string;
  updated_at: string;
  sources: ResearchSourceSnapshot[];
};

function compareSources(before: ResearchSourceSnapshot[], after: ResearchSourceSnapshot[]) {
  const previous = new Map(before.map((source) => [source.url, source]));
  const current = new Map(after.map((source) => [source.url, source]));
  return [...new Set([...current.keys(), ...previous.keys()])].flatMap((url) => {
    const oldSource = previous.get(url);
    const newSource = current.get(url);
    const excerptsChanged =
      oldSource &&
      newSource &&
      (oldSource.passages.length !== newSource.passages.length ||
        oldSource.passages.some((passage, index) => passage !== newSource.passages[index]));
    const reasons = [
      !oldSource ? "Добавлен" : null,
      !newSource ? "Отсутствует в текущем отчёте" : null,
      oldSource && newSource && oldSource.status !== newSource.status
        ? "Изменился статус чтения"
        : null,
      oldSource?.content_digest &&
      newSource?.content_digest &&
      oldSource.content_digest !== newSource.content_digest
        ? "Изменился прочитанный текст"
        : null,
      excerptsChanged ? "Изменились выдержки" : null
    ].filter((reason) => reason !== null);
    return reasons.length ? [{ url, oldSource, newSource, reasons, excerptsChanged }] : [];
  });
}

export function ResearchComparison({
  current,
  candidates,
  statusLabels
}: {
  current: SavedResearch;
  candidates: SavedResearch[];
  statusLabels: Record<ResearchSourceStatus, string>;
}) {
  const [baselineId, setBaselineId] = useState("");
  const baseline = candidates.find((candidate) => candidate.id === baselineId);
  if (!candidates.length) return null;
  const changes = baseline ? compareSources(baseline.sources, current.sources) : [];
  return (
    <details className={styles.comparison}>
      <summary>Сравнить источники</summary>
      <label>
        Отчёт для сравнения
        <select value={baseline?.id ?? ""} onChange={(event) => setBaselineId(event.target.value)}>
          <option value="">Выберите отчёт</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.question} · {new Date(candidate.updated_at).toLocaleString("ru")}
            </option>
          ))}
        </select>
      </label>
      {baseline && (
        <>
          <p className={styles.muted}>
            Сравниваются сохранённые данные. В старых отчётах доступны статусы и выдержки.
          </p>
          {changes.length ? (
            <ul>
              {changes.map(({ url, oldSource, newSource, reasons, excerptsChanged }) => (
                <li key={url}>
                  <a href={url} rel="noopener noreferrer" target="_blank">
                    {newSource?.title ?? oldSource?.title}
                  </a>
                  <p>{reasons.join(" · ")}</p>
                  {oldSource && newSource && oldSource.status !== newSource.status && (
                    <p>
                      {statusLabels[oldSource.status]} → {statusLabels[newSource.status]}
                    </p>
                  )}
                  {excerptsChanged && oldSource && newSource && (
                    <details>
                      <summary>Сохранённые выдержки</summary>
                      <p>В отчёте для сравнения</p>
                      {oldSource.passages.length ? (
                        oldSource.passages.map((passage, index) => (
                          <blockquote key={index}>{passage}</blockquote>
                        ))
                      ) : (
                        <p>Выдержек нет.</p>
                      )}
                      <p>В текущем отчёте</p>
                      {newSource.passages.length ? (
                        newSource.passages.map((passage, index) => (
                          <blockquote key={index}>{passage}</blockquote>
                        ))
                      ) : (
                        <p>Выдержек нет.</p>
                      )}
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>В сохранённых данных различий не найдено.</p>
          )}
        </>
      )}
    </details>
  );
}
