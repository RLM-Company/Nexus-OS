"use client";
import { useState } from "react";
import { downloadText } from "./chat-response";
export function ChatHistoryActions({
  id,
  title,
  messages,
  disabled,
  onChange,
  onArchive
}: {
  id: string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  disabled: boolean;
  onChange: (title: string) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (archived: boolean) => {
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
    <details className="chat-history-actions">
      <summary>Управление чатом</summary>
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
            `# ${title}\n\n${messages.map((message) => `## ${message.role === "user" ? "Вы" : "Cosmora"}\n\n${message.content}`).join("\n\n")}`,
            "cosmora-chat.md"
          )
        }
      >
        Скачать переписку
      </button>
      <p>
        Архив убирает чат из списка. История остаётся на сервере; чат можно вернуть из архива в
        боковой панели.
      </p>
      <button type="button" disabled={disabled || pending} onClick={() => void update(true)}>
        Убрать чат в архив
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
