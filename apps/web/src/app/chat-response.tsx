"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { WorkspaceIcon } from "./workspace-icons";
import { LoadingDots } from "./ui/feedback";
import styles from "./chat-code.module.css";

export function downloadText(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CopyButton({ content, label }: { content: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current);
    },
    []
  );
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        if (reset.current) clearTimeout(reset.current);
        if (!navigator.clipboard) {
          setState("failed");
          return;
        }
        void navigator.clipboard.writeText(content).then(
          () => {
            setState("copied");
            reset.current = setTimeout(() => setState("idle"), 2000);
          },
          () => setState("failed")
        );
      }}
    >
      <WorkspaceIcon name={state === "copied" ? "check" : "copy"} />
      <span aria-live="polite">
        {state === "copied" ? "Скопировано" : state === "failed" ? "Копирование недоступно" : label}
      </span>
    </button>
  );
}
function CodeBlock({ children, node }: ComponentProps<"pre"> & ExtraProps) {
  const first = node?.children[0];
  const code = first?.type === "element" ? first : undefined;
  const content = (code?.children ?? [])
    .map((item) => (item.type === "text" ? item.value : ""))
    .join("");
  const classes = code?.properties.className;
  const language = Array.isArray(classes)
    ? classes.find((item: unknown) => typeof item === "string" && item.startsWith("language-"))
    : undefined;
  const name = language?.slice(9).replace(/[^a-z0-9]/gi, "") || "txt";
  const diff = name === "diff" || name === "patch";
  const lines = content.replace(/\n$/, "").split("\n");
  const added = diff
    ? lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length
    : 0;
  const removed = diff
    ? lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length
    : 0;
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.language}>{name}</span>
        {diff && (
          <span className={styles.counts} aria-label={`${added} добавлено, ${removed} удалено`}>
            +{added} / −{removed}
          </span>
        )}
        <CopyButton content={content} label="Копировать код" />
        <button
          type="button"
          onClick={() => downloadText(content, `kosmora-code.${diff ? "patch" : name}`)}
        >
          <WorkspaceIcon name="download" /> Скачать код
        </button>
      </div>
      <pre className={styles.body}>
        {content && lines.length <= 2000 ? (
          <code>
            {lines.map((line, index) => (
              <span
                className={`${styles.line} ${diff && line.startsWith("+") && !line.startsWith("+++") ? styles.added : diff && line.startsWith("-") && !line.startsWith("---") ? styles.removed : ""}`}
                key={index}
              >
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.text}>{line || "\u00a0"}</span>
              </span>
            ))}
          </code>
        ) : (
          children
        )}
      </pre>
    </div>
  );
}
export function ChatResponse({
  content,
  assistant,
  complete = false
}: {
  content: string | null;
  assistant: boolean;
  complete?: boolean;
}) {
  if (!content) return <LoadingDots label="Формирую ответ" />;
  if (!assistant) return <p>{content}</p>;
  return (
    <div className="chat-response">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          pre: CodeBlock,
          a: ({ children, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt ? `[Изображение: ${alt}]` : "[Изображение]"}</span>,
          table: ({ children }) => (
            <div className="response-table">
              <table>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </Markdown>
      {complete && (
        <div className="response-actions">
          <CopyButton content={content} label="Копировать ответ" />
          <button type="button" onClick={() => downloadText(content, "kosmora-answer.md")}>
            Скачать ответ
          </button>
        </div>
      )}
    </div>
  );
}
