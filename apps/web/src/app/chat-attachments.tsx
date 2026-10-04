"use client";

import { useRef, useState } from "react";
import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_TEXT_EXTENSIONS,
  isChatTextFilename,
  isValidChatAttachments,
  type ChatTextAttachment
} from "@cosmora/contracts/chat-attachments";

export function useChatAttachments(scope: string) {
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const operationRef = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    files: ChatTextAttachment[];
    reading: boolean;
    error: string | null;
  }>({ scope, files: [], reading: false, error: null });
  const files = state.scope === scope ? state.files : [];
  const reading = state.scope === scope && state.reading;
  const error = state.scope === scope ? state.error : null;
  const replace = (next: ChatTextAttachment[]): void => {
    operationRef.current += 1;
    setState({ scope, files: next, reading: false, error: null });
  };
  const add = async (selected: File[]): Promise<void> => {
    const operation = ++operationRef.current;
    setState({ scope, files, reading: true, error: null });
    try {
      if (files.length + selected.length > CHAT_ATTACHMENT_LIMITS.files) {
        throw new Error("Можно прикрепить до 4 файлов.");
      }
      const added = await Promise.all(
        selected.map(async (file) => {
          if (!isChatTextFilename(file.name)) {
            throw new Error(
              "Выберите текстовый файл или исходный код. PDF и изображения пока не поддерживаются."
            );
          }
          if (file.size > CHAT_ATTACHMENT_LIMITS.bytesPerFile) {
            throw new Error("Файл слишком большой: до 32 КБ и 8 000 символов на файл.");
          }
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          } catch {
            throw new Error("Не удалось прочитать файл. Используйте текст в кодировке UTF-8.");
          }
          return { name: file.name, content };
        })
      );
      const next = [...files, ...added];
      if (!isValidChatAttachments(next)) {
        throw new Error(
          "Нужен непустой текст без двоичных данных: до 8 000 символов на файл и 24 КБ всего."
        );
      }
      if (scopeRef.current === scope && operationRef.current === operation) {
        setState({ scope, files: next, reading: false, error: null });
      }
    } catch (cause) {
      if (scopeRef.current === scope && operationRef.current === operation) {
        setState({
          scope,
          files,
          reading: false,
          error: cause instanceof Error ? cause.message : "Не удалось прочитать файл."
        });
      }
    }
  };
  return { files, reading, error, add, replace };
}

export function ChatAttachmentPicker({
  files,
  reading,
  error,
  disabled,
  onAdd,
  onRemove
}: {
  files: ChatTextAttachment[];
  reading: boolean;
  error: string | null;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="chat-attachment-picker">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Текстовые файлы и код"
        accept={CHAT_TEXT_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
        disabled={disabled || reading}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (selected.length) onAdd(selected);
        }}
      />
      <button
        type="button"
        disabled={disabled || reading || files.length >= CHAT_ATTACHMENT_LIMITS.files}
        onClick={() => inputRef.current?.click()}
      >
        {reading ? "Читаю файлы…" : "Прикрепить файл"}
      </button>
      <small>Текст и код · до 4 файлов, 8 000 символов на файл, 24 КБ всего</small>
      {files.length > 0 && (
        <ul aria-label="Прикреплённые файлы">
          {files.map((file, index) => (
            <li key={`${index}:${file.name}`}>
              <span>
                {file.name} · {file.content.length} символов
              </span>
              <button
                type="button"
                disabled={disabled || reading}
                aria-label={`Удалить ${file.name}`}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function ChatMessageAttachments({ files }: { files?: ChatTextAttachment[] }) {
  if (!files?.length) return null;
  return (
    <div className="chat-message-attachments" aria-label="Файлы сообщения">
      {files.map((file, index) => (
        <details key={`${index}:${file.name}`}>
          <summary>
            {file.name} · {file.content.length} символов
          </summary>
          <pre>{file.content}</pre>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([file.content], { type: "text/plain;charset=utf-8" })
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = file.name;
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
            }}
          >
            Скачать {file.name}
          </button>
        </details>
      ))}
    </div>
  );
}
