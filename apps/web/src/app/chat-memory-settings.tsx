"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHAT_MEMORY_MAX_LENGTH, type ChatMemory } from "@cosmora/contracts/chat-memory";
import { ContextMemorySettings } from "./context-memory-settings";

const readMemory = async (response: Response): Promise<ChatMemory> => {
  if (!response.ok) throw new Error("Не удалось загрузить память чата.");
  const data = (await response.json()) as { memory?: ChatMemory };
  const memory = data.memory;
  if (
    !memory ||
    typeof memory.memory_notes !== "string" ||
    !Number.isSafeInteger(memory.version) ||
    memory.version < 0
  )
    throw new Error("Не удалось прочитать память чата.");
  return memory;
};

export function ChatMemorySettings({ chatId, disabled }: { chatId: string; disabled: boolean }) {
  const fieldId = useId();
  const [stored, setStored] = useState<ChatMemory | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const path = `/api/v1/chats/${encodeURIComponent(chatId)}/memory`;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void fetch(path, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    })
      .then(readMemory)
      .then((memory) => {
        if (controller.signal.aborted) return;
        setStored(memory);
        setText(memory.memory_notes);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Не удалось загрузить память чата. Попробуйте ещё раз.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [path]);

  const reload = async () => {
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const memory = await readMemory(
        await fetch(path, {
          cache: "no-store",
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)])
        })
      );
      if (scope.signal.aborted) return;
      setStored(memory);
      setText(memory.memory_notes);
      setNotice("Загружена сохранённая версия.");
    } catch {
      if (!scope.signal.aborted)
        setError("Не удалось загрузить память чата. Текст в поле сохранён.");
    } finally {
      if (!scope.signal.aborted) setBusy(false);
    }
  };

  const save = async (notes: string) => {
    const scope = lifetime.current;
    if (!stored || !scope || scope.signal.aborted) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      let response: Response;
      try {
        response = await fetch(path, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memory_notes: notes, expected_version: stored.version }),
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)])
        });
      } catch {
        // A lost response may follow a committed write. Reconcile by reading; never retry a write blindly.
        const memory = await readMemory(
          await fetch(path, {
            cache: "no-store",
            signal: AbortSignal.any([scope.signal, AbortSignal.timeout(15_000)])
          })
        );
        if (memory.version !== stored.version + 1 || memory.memory_notes !== notes)
          throw new Error(
            "Не удалось подтвердить сохранение. Текст остался в поле; загрузите сохранённую версию перед повтором."
          );
        if (!scope.signal.aborted) {
          setStored(memory);
          setText(memory.memory_notes);
          setNotice(notes ? "Память сохранена." : "Память очищена.");
        }
        return;
      }
      if (response.status === 409) {
        const data = (await response.json()) as { error?: { message?: string } };
        throw new Error(
          data.error?.message ?? "Память изменена в другой вкладке. Загрузите сохранённую версию."
        );
      }
      if (!response.ok) throw new Error("Не удалось сохранить память. Текст остался в поле.");
      const memory = await readMemory(response);
      if (scope.signal.aborted) return;
      setStored(memory);
      setText(memory.memory_notes);
      setNotice(notes ? "Память сохранена." : "Память очищена.");
    } catch (cause) {
      if (!scope.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось подтвердить сохранение.");
    } finally {
      if (!scope.signal.aborted) setBusy(false);
    }
  };

  return (
    <>
      <fieldset>
        <legend>Память чата</legend>
        <p>
          Сохраните важные факты и пожелания. Они будут учитываться в следующих ответах только этого
          чата.
        </p>
        <label htmlFor={fieldId}>Заметки для следующих ответов</label>
        <textarea
          id={fieldId}
          rows={5}
          maxLength={CHAT_MEMORY_MAX_LENGTH}
          value={text}
          disabled={busy || disabled || !stored}
          onChange={(event) => {
            setText(event.target.value);
            setNotice("");
          }}
          placeholder="Например: проект на TypeScript, отвечать кратко и по-русски"
        />
        <p>
          {text.length} / {CHAT_MEMORY_MAX_LENGTH}
          {stored && text !== stored.memory_notes ? " · Не сохранено" : ""}
        </p>
        <button
          type="button"
          disabled={busy || disabled || !stored || text === stored.memory_notes}
          onClick={() => void save(text)}
        >
          Сохранить память
        </button>
        <button
          type="button"
          disabled={busy || disabled || !stored?.memory_notes}
          onClick={() => void save("")}
        >
          Очистить память
        </button>
        {busy && <p role="status">Обновление памяти…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button type="button" disabled={busy} onClick={() => void reload()}>
              Загрузить сохранённую версию
            </button>
          </>
        )}
      </fieldset>
      <ContextMemorySettings target={{ kind: "chat", id: chatId }} disabled={disabled} />
    </>
  );
}
