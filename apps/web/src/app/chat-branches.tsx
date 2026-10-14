"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ChatBranchList,
  CreateChatBranch,
  GeneralChatMessage,
  GeneralChatMessageAcceptedResponse
} from "@cosmora/contracts";
import styles from "./chat-branches.module.css";

export function ChatBranchButton({
  assistant,
  disabled,
  onClick
}: {
  assistant: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.action} disabled={disabled} onClick={onClick}>
      {assistant ? "Повторить ответ" : "Изменить запрос"}
    </button>
  );
}

function BranchDialog({
  chatId,
  message,
  onClose,
  onCreated
}: {
  chatId: string;
  message: GeneralChatMessage;
  onClose: () => void;
  onCreated: (accepted: GeneralChatMessageAcceptedResponse) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const attempt = useRef<CreateChatBranch | null>(null);
  const id = useId();
  const editing = message.role === "user";
  const [text, setText] = useState(message.content);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    dialog.current?.showModal();
    if (editing) input.current?.focus();
    return () => controller.abort();
  }, [editing]);

  const submit = async () => {
    const scope = lifetime.current;
    if (!scope || scope.signal.aborted || pending) return;
    const request =
      attempt.current ??
      (editing
        ? {
            kind: "edit" as const,
            message_id: message.id,
            client_branch_id: crypto.randomUUID(),
            content: text.trim()
          }
        : {
            kind: "regenerate" as const,
            message_id: message.id,
            client_branch_id: crypto.randomUUID()
          });
    attempt.current = request;
    setPending(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/branches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(20_000)])
        });
      } catch {
        // A committed branch can already be running. Recover its known identity; never create another ID.
        const recovered = await fetch(`/api/v1/chats/${request.client_branch_id}`, {
          cache: "no-store",
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(8_000)])
        });
        if (!recovered.ok)
          throw new Error(
            "Не удалось подтвердить создание. Повтор использует тот же идентификатор и не создаст второй вариант."
          );
        const detail = (await recovered.json()) as {
          chat: GeneralChatMessageAcceptedResponse["chat"];
          messages: GeneralChatMessage[];
        };
        const user = detail.messages.findLast((item) => item.role === "user");
        if (!user?.run_id || detail.chat.id !== request.client_branch_id)
          throw new Error("Не удалось подтвердить вариант. Проверьте историю чатов.");
        if (!scope.signal.aborted)
          onCreated({
            chat: detail.chat,
            user_message: user,
            run_id: user.run_id,
            stream_url: `/api/v1/chat-runs/${user.run_id}/events`
          });
        return;
      }
      if (!response.ok) {
        if ([400, 404, 409].includes(response.status)) {
          attempt.current = null;
          setUncertain(false);
        }
        const detail = (await response.json()) as { error?: { message?: string } };
        throw new Error(detail.error?.message ?? "Не удалось создать вариант.");
      }
      const accepted = (await response.json()) as GeneralChatMessageAcceptedResponse;
      if (accepted.chat.id !== request.client_branch_id || !accepted.run_id)
        throw new Error("Не удалось подтвердить вариант.");
      if (!scope.signal.aborted) onCreated(accepted);
    } catch (cause) {
      if (!scope.signal.aborted) {
        setUncertain(attempt.current !== null);
        setError(cause instanceof Error ? cause.message : "Не удалось создать вариант.");
      }
    } finally {
      if (!scope.signal.aborted) setPending(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id={id}>{editing ? "Изменить запрос" : "Повторить ответ"}</h2>
      <p>
        Создадим отдельный вариант с историей до этого запроса. Исходная переписка сохранится. Новый
        ответ использует выбранную модель.
      </p>
      {editing && (
        <>
          <label htmlFor={`${id}-text`}>Новый текст запроса</label>
          <textarea
            id={`${id}-text`}
            ref={input}
            value={text}
            maxLength={100_000}
            rows={7}
            disabled={pending || uncertain}
            onChange={(event) => setText(event.target.value)}
          />
          {Boolean(message.attachments?.length) && (
            <p>Вложения этого запроса сохранятся в варианте.</p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={styles.buttons}>
        <button type="button" disabled={pending} onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          disabled={pending || (editing && !text.trim())}
          onClick={() => void submit()}
        >
          {pending
            ? "Создаём вариант…"
            : uncertain
              ? "Повторить создание"
              : "Создать вариант и получить ответ"}
        </button>
      </div>
    </dialog>
  );
}

export function ChatBranches({
  chatId,
  message,
  disabled,
  onClose,
  onOpen,
  onCreated
}: {
  chatId: string;
  message: GeneralChatMessage | null;
  disabled: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
  onCreated: (accepted: GeneralChatMessageAcceptedResponse) => void;
}) {
  const [family, setFamily] = useState<ChatBranchList | null>(null);
  const selectorId = useId();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/branches`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)])
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as ChatBranchList;
        if (!controller.signal.aborted) setFamily(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [chatId]);
  return (
    <>
      {family && family.items.length > 1 && (
        <div className={styles.selector}>
          <label htmlFor={selectorId}>Варианты переписки</label>
          <select
            id={selectorId}
            value={chatId}
            disabled={disabled}
            onChange={(event) => onOpen(event.target.value)}
          >
            {family.items.map((item) => (
              <option key={item.chat_id} value={item.chat_id}>
                {item.chat_id === family.root_chat_id ? "Исходный чат" : item.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {message && (
        <BranchDialog
          key={message.id}
          chatId={chatId}
          message={message}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
