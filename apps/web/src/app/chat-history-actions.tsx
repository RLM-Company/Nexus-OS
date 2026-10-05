"use client";
import { useEffect, useRef, useState } from "react";
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
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    []
  );
  const update = async (archived: boolean) => {
    if (disabled || request.current || (!archived && !name.trim())) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(archived ? { archived: true } : { title: name.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
      });
      if (request.current !== controller) return;
      if (!response.ok) throw new Error("Chat update rejected");
      const value = (await response.json()) as { chat?: { id?: unknown; title?: unknown } } | null;
      if (
        value?.chat?.id !== id ||
        typeof value.chat.title !== "string" ||
        !value.chat.title.trim() ||
        value.chat.title.length > 160 ||
        (!archived && value.chat.title !== name.trim())
      )
        throw new Error("Chat update unconfirmed");
      if (request.current !== controller) return;
      if (archived) onArchive();
      else onChange(value.chat.title);
    } catch {
      if (request.current === controller)
        setError(
          "Не удалось подтвердить изменение чата. Проверьте список чатов и архив перед повторной попыткой."
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };
  return (
    <details className="chat-history-actions" aria-busy={pending}>
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
      {pending && <p role="status">Сохраняю изменения чата…</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
