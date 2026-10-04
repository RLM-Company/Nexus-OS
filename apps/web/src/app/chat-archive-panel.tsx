"use client";
import { useState } from "react";
export function ChatArchivePanel({ onRestore }: { onRestore: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; title: string }> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/chats?archived=true");
      if (!response.ok) throw new Error("Не удалось загрузить архив.");
      const value = (await response.json()) as { items: NonNullable<typeof items> };
      setItems(value.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка архива");
    } finally {
      setPending(false);
    }
  };
  const restore = async (id: string) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/chats/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: false })
      });
      if (!response.ok) throw new Error("Не удалось восстановить чат.");
      setItems((current) => current?.filter((item) => item.id !== id) ?? []);
      onRestore();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка восстановления");
    } finally {
      setPending(false);
    }
  };
  return (
    <details
      className="chat-archive-panel"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>Архив чатов</summary>
      {pending && <p>Загрузка…</p>}
      {error && <p role="alert">{error}</p>}
      {items?.map((item) => (
        <div key={item.id}>
          <span>{item.title}</span>
          <button disabled={pending} type="button" onClick={() => void restore(item.id)}>
            Восстановить {item.title}
          </button>
        </div>
      ))}
      {items?.length === 0 && <p>Архив пуст</p>}
    </details>
  );
}
