"use client";

import { useMemo } from "react";
import type { CanvasFormat } from "@cosmora/contracts/canvas-artifacts";
import { compareCanvasText, compactCanvasDiff } from "./canvas-diff";
import styles from "./canvas-editor.module.css";

export type CanvasComparisonSide = {
  label: string;
  title: string;
  format: CanvasFormat;
  content: string;
};

export function CanvasComparison({
  before,
  after
}: {
  before: CanvasComparisonSide;
  after: CanvasComparisonSide;
}) {
  const diff = useMemo(
    () => compareCanvasText(before.content, after.content),
    [before.content, after.content]
  );
  const rows = useMemo(() => (diff.limited ? [] : compactCanvasDiff(diff.rows)), [diff]);
  return (
    <section className={styles.comparison} aria-label="Сравнение текста">
      <h4>
        {before.label} → {after.label}
      </h4>
      <dl className={styles.comparisonMeta}>
        <dt>Название до</dt>
        <dd>{before.title}</dd>
        <dt>Название после</dt>
        <dd>{after.title}</dd>
        <dt>Формат</dt>
        <dd>
          {before.format} → {after.format}
        </dd>
      </dl>
      {diff.limited ? (
        <p role="status">
          Тексты различаются. Построчное сравнение превышает лимит размера или сложности. Скачайте
          обе версии для полного сравнения; автоматическое объединение не выполняется.
        </p>
      ) : (
        <>
          <p>
            {diff.added || diff.removed
              ? `Добавлено строк: ${diff.added}; удалено строк: ${diff.removed}.`
              : "Содержимое совпадает побайтно."}
          </p>
          {!!rows.length && (
            <div
              className={styles.diff}
              role="region"
              aria-label="Изменения по строкам"
              tabIndex={0}
            >
              {rows.map((row, index) => {
                if (row.kind === "fold")
                  return (
                    <div key={index} className={styles.diffFold}>
                      … Без изменений: {row.count} строк
                    </div>
                  );
                const ending = row.text.endsWith("\r\n")
                  ? "CRLF"
                  : row.text.endsWith("\n")
                    ? "LF"
                    : row.text.endsWith("\r")
                      ? "CR"
                      : "без перевода строки";
                const text = row.text.replace(/(?:\r\n|\r|\n)$/, "");
                return (
                  <div key={index} className={styles.diffRow} data-kind={row.kind}>
                    <span className={styles.diffNumber}>{row.before ?? ""}</span>
                    <span className={styles.diffNumber}>{row.after ?? ""}</span>
                    <span
                      aria-label={
                        row.kind === "add"
                          ? "Добавлено"
                          : row.kind === "remove"
                            ? "Удалено"
                            : "Без изменений"
                      }
                    >
                      {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
                    </span>
                    <code>
                      {text}
                      <small className={styles.lineEnding}> ⟨{ending}⟩</small>
                    </code>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
