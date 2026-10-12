"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ToolSurface } from "./workspace-sections";
import styles from "./quick-switcher.module.css";

type Destination = { id: string; title: string };
type Result = { key: string; label: string; group: string; run: () => void };

export function QuickSwitcher({
  chats,
  projects,
  onNewChat,
  onOpenChat,
  onOpenProject,
  onNavigate
}: {
  chats: Destination[];
  projects: Destination[];
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onOpenProject: (id: string) => void;
  onNavigate: (surface: "manager" | ToolSurface) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        if (event.isComposing) return;
        event.preventDefault();
        if (document.querySelector("dialog[open]") && !dialog.current?.open) return;
        if (!dialog.current?.open)
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (open) {
      if (!dialog.current?.open) dialog.current?.showModal();
      input.current?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      const target = previousFocus.current;
      if (target?.isConnected) target.focus();
      else trigger.current?.focus();
    }
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (run: () => void) => {
    close();
    run();
  };
  const actions: Result[] = [
    { key: "new-chat", label: "Новый чат", group: "Действия", run: onNewChat },
    { key: "work", label: "Work", group: "Разделы", run: () => onNavigate("work") },
    { key: "code", label: "Code", group: "Разделы", run: () => onNavigate("code") },
    { key: "studio", label: "Kosmora Studio", group: "Разделы", run: () => onNavigate("studio") }
  ];
  const options: Result[] = [
    ...actions,
    ...chats.map((chat) => ({
      key: `chat:${chat.id}`,
      label: chat.title,
      group: "Чаты",
      run: () => onOpenChat(chat.id)
    })),
    ...projects.map((project) => ({
      key: `project:${project.id}`,
      label: project.title,
      group: "Проекты",
      run: () => onOpenProject(project.id)
    }))
  ];
  const search = query.trim().toLocaleLowerCase("ru");
  const results = options
    .filter((option) => !search || option.label.toLocaleLowerCase("ru").includes(search))
    .slice(0, 50);
  const move = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>("[data-quick-result]") ?? []
    );
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % buttons.length
        : current <= 0
          ? buttons.length - 1
          : current - 1;
    buttons[next]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label="Быстрый переход"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => {
          previousFocus.current = trigger.current;
          setOpen(true);
        }}
      >
        <span aria-hidden="true">⌕</span>
        <kbd>Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label="Быстрый переход"
        onClose={close}
        onKeyDown={move}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.content}>
          <div className={styles.search}>
            <input
              ref={input}
              type="search"
              aria-label="Найти чат, проект или раздел"
              placeholder="Чат, проект или раздел…"
              maxLength={120}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results.length) {
                  event.preventDefault();
                  choose(results[0]!.run);
                }
              }}
            />
            <button type="button" onClick={close} aria-label="Закрыть быстрый переход">
              Esc
            </button>
          </div>
          <div className={styles.results}>
            {results.map((result) => (
              <button
                data-quick-result
                type="button"
                key={result.key}
                onClick={() => choose(result.run)}
              >
                <span>{result.label}</span>
                <small>{result.group}</small>
              </button>
            ))}
            {!results.length && <p>Совпадений нет</p>}
          </div>
          <p className={styles.hint}>↑ ↓ — выбор · Enter — открыть · Esc — закрыть</p>
        </div>
      </dialog>
    </>
  );
}
