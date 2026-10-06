"use client";

import { useRef, useState } from "react";
import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_TEXT_EXTENSIONS,
  isValidChatAttachments,
  type ChatAttachment
} from "@cosmora/contracts/chat-attachments";
import { decodeChatAttachment } from "./decode-chat-attachment";
import { prepareChatImage } from "./prepare-chat-image";
import { WorkspaceIcon } from "./workspace-icons";

export function useChatAttachments(scope: string) {
  const scopeRef = useRef(scope);
  const operationRef = useRef(0);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    operationRef.current++;
  }
  const [state, setState] = useState<{
    scope: string;
    files: ChatAttachment[];
    reading: boolean;
    error: string | null;
  }>({ scope, files: [], reading: false, error: null });
  const files = state.scope === scope ? state.files : [];
  const reading = state.scope === scope && state.reading;
  const error = state.scope === scope ? state.error : null;
  const replace = (next: ChatAttachment[]): void => {
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
      const added: ChatAttachment[] = [];
      for (const file of selected) {
        if (scopeRef.current !== scope || operationRef.current !== operation) return;
        added.push(
          await (/\.(png|jpe?g)$/i.test(file.name)
            ? prepareChatImage(file)
            : decodeChatAttachment(file))
        );
      }
      const next = [...files, ...added];
      if (!isValidChatAttachments(next)) {
        throw new Error(
          "Нужен непустой текст до 8 000 символов; общий контекст до 24 КБ и не больше 2 изображений."
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
  onRemove,
  textOnly = false
}: {
  files: ChatAttachment[];
  reading: boolean;
  error: string | null;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  textOnly?: boolean;
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
        accept={[
          ...CHAT_TEXT_EXTENSIONS,
          "pdf",
          "docx",
          ...(textOnly ? [] : ["png", "jpg", "jpeg"])
        ]
          .map((extension) => `.${extension}`)
          .join(",")}
        disabled={disabled || reading}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (selected.length) onAdd(selected);
        }}
      />
      <button
        type="button"
        className="attachment-clip"
        aria-label="Прикрепить файл"
        title={textOnly ? "Прикрепить файл" : "Прикрепить файл или фото"}
        aria-busy={reading}
        disabled={disabled || reading || files.length >= CHAT_ATTACHMENT_LIMITS.files}
        onClick={() => inputRef.current?.click()}
      >
        <WorkspaceIcon name="paperclip" />
      </button>
      {reading && (
        <span role="status" aria-live="polite">
          Читаю файлы…
        </span>
      )}
      {files.length > 0 && (
        <ul aria-label="Прикреплённые файлы">
          {files.map((file, index) => (
            <li key={`${index}:${file.name}`}>
              {"kind" in file && file.kind === "image" && (
                <img
                  src={`data:${file.media_type};base64,${file.data_base64}`}
                  alt={`${file.name} миниатюра`}
                  className="attachment-thumbnail"
                />
              )}
              <span>
                {file.name} ·{" "}
                {"content" in file ? `${file.content.length} символов` : "изображение"}
              </span>
              <button
                type="button"
                disabled={disabled || reading}
                aria-label={`Удалить ${file.name}`}
                title={`Удалить ${file.name}`}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" aria-live="assertive">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChatMessageAttachments({ files }: { files?: ChatAttachment[] }) {
  if (!files?.length) return null;
  return (
    <div className="chat-message-attachments" aria-label="Файлы сообщения">
      {files.map((file, index) => (
        <details key={`${index}:${file.name}`}>
          <summary>
            {file.name} · {"content" in file ? `${file.content.length} символов` : "изображение"}
          </summary>
          {"content" in file ? (
            <pre>{file.content}</pre>
          ) : (
            <img
              src={`data:${file.media_type};base64,${file.data_base64}`}
              alt={file.name}
              style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                "content" in file
                  ? new Blob([file.content], { type: "text/plain;charset=utf-8" })
                  : new Blob(
                      [
                        Uint8Array.from(atob(file.data_base64), (character) =>
                          character.charCodeAt(0)
                        )
                      ],
                      { type: file.media_type }
                    )
              );
              const link = document.createElement("a");
              link.href = url;
              link.download =
                "content" in file && file.source_type ? `${file.name}.txt` : file.name;
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
