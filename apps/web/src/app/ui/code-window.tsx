"use client";

import { useState, type ReactNode } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import { CodeText } from "./code-text";
import { InlineDiff } from "./inline-diff";
import styles from "./code-window.module.css";

/** Escaped text only. Large files remain available without creating thousands of highlighted nodes. */
export function CodeViewer({
  content,
  language = "txt",
  wrap = false,
  label = "Код",
  id,
  labelledBy,
  tabPanel = false
}: {
  content: string;
  language?: string;
  wrap?: boolean;
  label?: string;
  id?: string;
  labelledBy?: string;
  tabPanel?: boolean;
}) {
  const lines = content.replace(/\n$/, "").split("\n");
  const numbered = lines.length <= 2000 && content.length <= 100_000;
  return (
    <pre
      id={id}
      role={tabPanel ? "tabpanel" : undefined}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={styles.code}
      data-wrap={wrap || undefined}
    >
      <code>
        {numbered
          ? lines.map((line, index) => (
              <span key={index} className={styles.line}>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.text}>
                  <CodeText text={line || "\u00a0"} language={language} />
                </span>
              </span>
            ))
          : content}
      </code>
    </pre>
  );
}

export function WindowDots() {
  return (
    <span className={styles.dots} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function WrapButton({ wrap, onChange }: { wrap: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={styles.action}
      aria-label="Переносить строки"
      aria-pressed={wrap}
      onClick={onChange}
      title="Переносить строки"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <path d="M3 5h14M3 9h10a3 3 0 0 1 0 6H9m0 0 2.5-2.5M9 15l2.5 2.5M3 13h3" />
      </svg>
    </button>
  );
}

export function CodeWindow({
  content,
  language = "txt",
  title,
  actions
}: {
  content: string;
  language?: string;
  title?: string;
  actions?: ReactNode;
}) {
  const [wrap, setWrap] = useState(false);
  const diff = /^(diff|patch)$/i.test(language);
  return (
    <section className={styles.window} aria-label={title ?? `Код ${language}`}>
      <div className={styles.toolbar}>
        <WindowDots />
        <span className={styles.title}>
          <WorkspaceIcon name="code" />
          {title ?? language}
        </span>
        <div className={styles.actions}>
          <WrapButton wrap={wrap} onChange={() => setWrap(!wrap)} />
          {actions}
        </div>
      </div>
      {diff ? (
        <InlineDiff text={content} wrap={wrap} bare />
      ) : (
        <CodeViewer content={content} language={language} wrap={wrap} />
      )}
    </section>
  );
}
