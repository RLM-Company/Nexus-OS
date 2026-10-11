"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { WorkspaceIcon } from "./workspace-icons";
import { LoadingDots } from "./ui/feedback";
import styles from "./chat-code.module.css";
import { CodeText } from "./ui/code-text";

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
        <span className={styles.language}>
          <WorkspaceIcon name="code" />
          {name}
        </span>
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
                <span className={styles.text}>
                  {diff ? line || "\u00a0" : <CodeText text={line || "\u00a0"} language={name} />}
                </span>
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
  complete = false,
  streaming = false,
  onFollowUp
}: {
  content: string | null;
  assistant: boolean;
  complete?: boolean;
  streaming?: boolean;
  onFollowUp?: (prompt: string) => void;
}) {
  if (!content) return <LoadingDots label="Формирую ответ" />;
  if (!assistant)
    return (
      <div>
        <p>{content}</p>
        {complete && (
          <div className={styles.userActions}>
            <CopyButton content={content} label="Копировать запрос" />
            {onFollowUp && (
              <button type="button" onClick={() => onFollowUp(content)}>
                <WorkspaceIcon name="new-chat" />
                Вставить в сообщение
              </button>
            )}
          </div>
        )}
      </div>
    );
  return (
    <div className="chat-response" data-streaming={streaming || undefined}>
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
      {complete && onFollowUp && (
        <div className="response-followups" aria-label="Продолжить разговор">
          <button
            type="button"
            onClick={() => onFollowUp("Объясни предыдущий ответ проще и приведи пример.")}
          >
            Объяснить проще <span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onFollowUp("Разверни предыдущий ответ: предложи конкретные следующие шаги.")
            }
          >
            Следующие шаги <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}
    </div>
  );
}
