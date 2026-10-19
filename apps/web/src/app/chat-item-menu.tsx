"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GeneralChatDetailResponse } from "@cosmora/contracts";
import { WorkspaceIcon, type IconName } from "./workspace-icons";
import { createChatExport, type ChatExportFormat } from "./chat-export";
import { downloadText } from "./chat-response";
import styles from "./chat-item-menu.module.css";

export function ChatItemMenu({
  id,
  title,
  pinned,
  disabled,
  onPin,
  onOpen,
  onRename,
  onDelete
}: {
  id: string;
  title: string;
  pinned: boolean;
  disabled: boolean;
  onPin: () => void;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [action, setAction] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function close() {
    if (menu.current) menu.current.open = false;
  }
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const box = menu.current!.getBoundingClientRect();
      const width = Math.min(248, window.innerWidth - 24);
      const height = panel.current?.offsetHeight ?? 420;
      const x =
        box.right + 10 + width <= window.innerWidth - 12 ? box.right + 10 : box.left - width - 10;
      setPosition({
        left: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(box.top, window.innerHeight - height - 12)),
        width,
        maxHeight: window.innerHeight - 24
      });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (panel.current) observer.observe(panel.current);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        menu.current?.querySelector("summary")?.focus();
      }
    };
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)"
        )
      ];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      }
      if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    document.addEventListener("keydown", trap);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("keydown", trap);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);
  async function perform(task: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(kind: "rename" | "archive" | "delete") {
    await perform(async () => {
      const response = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        method: kind === "delete" ? "DELETE" : "PATCH",
        ...(kind !== "delete"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(kind === "archive" ? { archived: true } : { title: name.trim() })
            }
          : {})
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "Сначала остановите ответ в этом чате."
            : "Не удалось сохранить. Повторите действие."
        );
      if (kind === "rename")
        onRename(((await response.json()) as GeneralChatDetailResponse).chat.title);
      else onDelete();
      close();
    });
  }
  async function exportChat(format: ChatExportFormat) {
    await perform(async () => {
      const response = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Не удалось загрузить переписку.");
      const detail = (await response.json()) as GeneralChatDetailResponse;
      const file = createChatExport(
        { id, projectId: null, title: detail.chat.title, messages: detail.messages },
        format
      );
      downloadText(file.content, file.filename, file.mimeType);
      setNotice("Переписка скачана.");
    });
  }
  function item(label: string, icon: IconName, click: () => void, destructive = false) {
    return (
      <button
        type="button"
        className={destructive ? styles.destructive : undefined}
        disabled={disabled || busy}
        onClick={click}
      >
        <WorkspaceIcon name={icon} />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <details
      className={styles.menu}
      ref={menu}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          setAction("menu");
          setName(title);
          setError("");
          setNotice("");
        }
      }}
    >
      <summary
        aria-label={`Действия с чатом «${title}»`}
        title="Действия с чатом"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <WorkspaceIcon name="more" />
      </summary>
      {open &&
        createPortal(
          <div
            ref={panel}
            className={styles.panel}
            style={position}
            role="dialog"
            aria-label={`Меню чата «${title}»`}
          >
            <div className={styles.heading}>
              <strong title={title}>{title}</strong>
              <button type="button" aria-label="Закрыть меню чата" onClick={close}>
                <WorkspaceIcon name="close" />
              </button>
            </div>
            {action === "menu" ? (
              <>
                {item("Открыть чат", "chats", () => {
                  onOpen();
                  close();
                })}
                {item(pinned ? "Открепить" : "Закрепить", "pin", () => {
                  onPin();
                  close();
                })}
                {item("Переименовать", "edit", () => setAction("rename"))}
                {item(
                  "Копировать ссылку",
                  "link",
                  () =>
                    void perform(async () => {
                      const url = new URL(window.location.href);
                      url.search = "";
                      url.hash = "";
                      url.searchParams.set("chat", id);
                      url.searchParams.set(
                        "space",
                        document.querySelector('.sidebar[data-space="coscode"]')
                          ? "coscode"
                          : "kosmora"
                      );
                      await navigator.clipboard.writeText(url.href);
                      setNotice("Ссылка скопирована. Доступ остаётся только у владельца.");
                    })
                )}
                <hr />
                {item("Скачать Markdown", "download", () => void exportChat("markdown"))}
                {item("Скачать JSON", "files", () => void exportChat("json"))}
                <hr />
                {item("В архив", "archive", () => void save("archive"))}
                {item("Удалить чат", "trash", () => setAction("delete"), true)}
              </>
            ) : action === "rename" ? (
              <>
                <label>
                  Название чата
                  <input
                    autoFocus
                    value={name}
                    maxLength={160}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && name.trim()) {
                        event.preventDefault();
                        void save("rename");
                      }
                    }}
                  />
                </label>
                {item("Сохранить", "check", () => {
                  if (name.trim()) void save("rename");
                })}
                {item("Отмена", "close", () => setAction("menu"))}
              </>
            ) : (
              <>
                <p>Удалить «{title}» вместе с сообщениями? Это действие нельзя отменить.</p>
                {item("Подтвердить удаление", "trash", () => void save("delete"), true)}
                {item("Отмена", "close", () => setAction("menu"))}
              </>
            )}
            {busy && <p role="status">Выполняем…</p>}
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
          </div>,
          document.body
        )}
    </details>
  );
}
