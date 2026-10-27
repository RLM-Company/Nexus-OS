"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkspaceIcon } from "./workspace-icons";
import styles from "./chat-search.module.css";

export type SearchableChatMessage = { id: string; role: string; content: string };

const PAGE_SIZE = 20;
const FOUND_MESSAGE_CLASS = styles.foundMessage ?? "kosmora-search-target";

function SearchSnippet({ content, query }: { content: string; query: string }) {
  const match = content.toLocaleLowerCase("ru").indexOf(query.toLocaleLowerCase("ru"));
  const start = Math.max(0, match - 65);
  const end = Math.min(content.length, Math.max(start + 220, match + query.length));
  return (
    <span className={styles.snippet}>
      {start > 0 && "…"}
      {content.slice(start, match)}
      <mark>{content.slice(match, match + query.length)}</mark>
      {content.slice(match + query.length, end)}
      {end < content.length && "…"}
    </span>
  );
}

export function ChatSearch({
  open,
  title,
  messages,
  onClose
}: {
  open: boolean;
  title: string;
  messages: SearchableChatMessage[];
  onClose: (selectedMessage?: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const jumped = useRef(false);
  const results = useRef<HTMLUListElement>(null);
  const highlight = useRef<{ element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const needle = query.trim();
  const matches = useMemo(
    () =>
      open && needle
        ? messages.filter(
            (message) =>
              (message.role === "user" || message.role === "assistant") &&
              message.content.toLocaleLowerCase("ru").includes(needle.toLocaleLowerCase("ru"))
          )
        : [],
    [messages, needle, open]
  );
  const current = Math.min(selected, Math.max(0, matches.length - 1));
  const pageStart = Math.floor(current / PAGE_SIZE) * PAGE_SIZE;

  useEffect(() => {
    if (open) {
      jumped.current = false;
      if (!dialog.current?.open) dialog.current?.showModal();
      input.current?.focus();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    results.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, needle]);

  useEffect(
    () => () => {
      if (highlight.current) {
        clearTimeout(highlight.current.timer);
        highlight.current.element.classList.remove(FOUND_MESSAGE_CLASS);
      }
    },
    []
  );

  const move = (direction: number) => {
    if (matches.length) setSelected((current + direction + matches.length) % matches.length);
  };
  const jump = (message: SearchableChatMessage) => {
    const target = document.getElementById(`chat-message-${message.id}`);
    if (!target) return;
    jumped.current = true;
    dialog.current?.close();
    onClose(true);
    if (highlight.current) {
      clearTimeout(highlight.current.timer);
      highlight.current.element.classList.remove(FOUND_MESSAGE_CLASS);
    }
    target.classList.add(FOUND_MESSAGE_CLASS);
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
    target.focus({ preventScroll: true });
    highlight.current = {
      element: target,
      timer: setTimeout(() => {
        target.classList.remove(FOUND_MESSAGE_CLASS);
        highlight.current = null;
      }, 4000)
    };
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={() => onClose(false)}
      onClose={() => onClose(jumped.current)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 id={id}>Поиск в переписке</h2>
          <p>{title}</p>
        </div>
        <button type="button" aria-label="Закрыть поиск" onClick={() => onClose(false)}>
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <div className={styles.controls}>
        <label className={styles.field}>
          <WorkspaceIcon name="search" />
          <input
            ref={input}
            aria-label="Найти в этой переписке"
            placeholder="Слово или фраза…"
            value={query}
            maxLength={2000}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                const message = matches[current];
                if (message) jump(message);
              }
            }}
          />
        </label>
        <div className={styles.navigation}>
          <span aria-live="polite">
            {matches.length ? `${current + 1} / ${matches.length}` : "0 / 0"}
          </span>
          <button
            type="button"
            aria-label="Предыдущее найденное сообщение"
            disabled={!matches.length}
            onClick={() => move(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Следующее найденное сообщение"
            disabled={!matches.length}
            onClick={() => move(1)}
          >
            ↓
          </button>
        </div>
      </div>
      {matches.length ? (
        <ul className={styles.results} ref={results}>
          {matches.slice(pageStart, pageStart + PAGE_SIZE).map((message, index) => (
            <li key={message.id}>
              <button
                type="button"
                data-active={pageStart + index === current}
                onClick={() => jump(message)}
              >
                <strong>{message.role === "user" ? "Вы" : "Kosmora"}</strong>
                <SearchSnippet content={message.content} query={needle} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          {needle ? "Совпадений нет. Попробуйте другую фразу." : "Найдите сообщение по его тексту."}
        </p>
      )}
      <footer className={styles.footer}>
        <span>
          {needle ? `Найдено сообщений: ${matches.length}` : "Поиск по запросам и ответам"}
        </span>
        <span>↑ ↓ выбор · Enter перейти</span>
      </footer>
    </dialog>
  );
}
