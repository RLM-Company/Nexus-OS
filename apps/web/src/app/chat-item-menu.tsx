"use client";
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "./workspace-icons";
import styles from "./chat-item-menu.module.css";

export function ChatItemMenu({
  id,
  title,
  pinned,
  disabled,
  onPin,
  onRename,
  onDelete
}: {
  id: string;
  title: string;
  pinned: boolean;
  disabled: boolean;
  onPin: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [action, setAction] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !menu.current?.contains(e.target) && menu.current)
        menu.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  async function save(remove: boolean) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        method: remove ? "DELETE" : "PATCH",
        ...(!remove
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: name.trim() })
            }
          : {})
      });
      if (!r.ok)
        throw new Error(
          r.status === 409
            ? "Сначала остановите ответ в этом чате."
            : "Не удалось сохранить. Повторите действие."
        );
      if (remove) onDelete();
      else onRename(((await r.json()) as { chat: { title: string } }).chat.title);
      if (menu.current) menu.current.open = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className={styles.menu}
      ref={menu}
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setAction("menu");
          setName(title);
          setError("");
        }
      }}
    >
      <summary aria-label={`Действия с чатом «${title}»`} title="Действия с чатом">
        <WorkspaceIcon name="more" />
      </summary>
      <div className={styles.panel} aria-label={`Меню чата «${title}»`}>
        {action === "menu" ? (
          <>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                onPin();
                if (menu.current) menu.current.open = false;
              }}
            >
              {pinned ? "Открепить" : "Закрепить"}
            </button>
            <button type="button" disabled={disabled || busy} onClick={() => setAction("rename")}>
              Переименовать
            </button>
            <button type="button" disabled={disabled || busy} onClick={() => setAction("delete")}>
              Удалить чат
            </button>
          </>
        ) : action === "rename" ? (
          <>
            <label>
              Название чата
              <input
                autoFocus
                value={name}
                maxLength={160}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    e.preventDefault();
                    void save(false);
                  }
                }}
              />
            </label>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void save(false)}>
              Сохранить
            </button>
            <button type="button" disabled={busy} onClick={() => setAction("menu")}>
              Отмена
            </button>
          </>
        ) : (
          <>
            <p>Удалить «{title}» вместе с сообщениями? Это действие нельзя отменить.</p>
            <button type="button" disabled={busy} onClick={() => void save(true)}>
              Подтвердить удаление
            </button>
            <button type="button" disabled={busy} onClick={() => setAction("menu")}>
              Отмена
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
