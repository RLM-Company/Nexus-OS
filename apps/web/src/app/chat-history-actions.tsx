"use client";
import { useEffect, useRef, useState } from "react";
import { downloadText } from "./chat-response";
import { WorkspaceIcon } from "./workspace-icons";
import { RelaySwitch } from "./personal-settings/relay-switch";
import styles from "./chat-history-actions.module.css";
import { ChatSearch, type SearchableChatMessage } from "./chat-search";
export function ChatHistoryActions({
  id,
  title,
  messages,
  disabled,
  onChange,
  onArchive,
  showRelay = true,
  onRecover,
  onVoice,
  runError = null
}: {
  id: string | null;
  title: string;
  messages: SearchableChatMessage[];
  disabled: boolean;
  onChange: (title: string) => void;
  onArchive: () => void;
  showRelay?: boolean;
  onRecover?: () => void;
  onVoice?: () => void;
  runError?: string | null;
}) {
  const [name, setName] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
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
  const update = async (archived: boolean) => {
    if (!id) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(archived ? { archived: true } : { title: name.trim() })
      });
      if (!response.ok)
        throw new Error("Не удалось изменить чат. Остановите текущий ответ и повторите.");
      const value = (await response.json()) as { chat: { title: string } };
      if (archived) onArchive();
      else onChange(value.chat.title);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <details className={styles.menu} ref={menu}>
        <summary aria-label="Настройки чата" title="Настройки чата">
          <WorkspaceIcon name="settings" />
        </summary>
        <div className={styles.panel}>
          <strong>Настройки чата</strong>
          <button
            type="button"
            disabled={!messages.length}
            onClick={() => {
              if (menu.current) menu.current.open = false;
              setSearchOpen(true);
            }}
          >
            Найти в переписке
          </button>
          {showRelay ? (
            <RelaySwitch
              chatId={id}
              error={runError ?? error}
              {...(onRecover ? { onRecover } : {})}
            />
          ) : (
            <a href="/personal-settings">Личные настройки</a>
          )}
          {onVoice && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (menu.current) menu.current.open = false;
                onVoice();
              }}
            >
              Голосовой помощник
            </button>
          )}
          {id && (
            <>
              <label>
                Название чата
                <input
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={disabled || pending}
                />
              </label>
              <button
                type="button"
                disabled={disabled || pending || !name.trim()}
                onClick={() => void update(false)}
              >
                Сохранить название
              </button>
              <button
                type="button"
                disabled={disabled || pending}
                onClick={() =>
                  downloadText(
                    `# ${title}\n\n${messages.map((message) => `## ${message.role === "user" ? "Вы" : "Kosmora"}\n\n${message.content}`).join("\n\n")}`,
                    "kosmora-chat.md"
                  )
                }
              >
                Скачать переписку
              </button>
              <p>
                Архив убирает чат из списка. История остаётся на сервере; чат можно вернуть из
                архива в боковой панели.
              </p>
              <button
                type="button"
                disabled={disabled || pending}
                onClick={() => void update(true)}
              >
                Убрать чат в архив
              </button>
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </div>
      </details>
      <ChatSearch
        open={searchOpen}
        title={title}
        messages={messages}
        onClose={(selectedMessage) => {
          setSearchOpen(false);
          if (!selectedMessage) menu.current?.querySelector("summary")?.focus();
        }}
      />
    </>
  );
}
