"use client";

import { useState, type ComponentProps } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

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
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(content).then(
          () => setState("copied"),
          () => setState("failed")
        );
      }}
    >
      {state === "copied" ? "Скопировано" : state === "failed" ? "Копирование недоступно" : label}
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
  return (
    <div className="response-code">
      <div className="response-actions">
        <span>{name}</span>
        <CopyButton content={content} label="Копировать код" />
        <button type="button" onClick={() => downloadText(content, `cosmora-code.${name}`)}>
          Скачать код
        </button>
      </div>
      <pre>{children}</pre>
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
  if (!content)
    return (
      <span className="typing">
        Формирую ответ<span>…</span>
      </span>
    );
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
          <button type="button" onClick={() => downloadText(content, "cosmora-answer.md")}>
            Скачать ответ
          </button>
        </div>
      )}
    </div>
  );
}
