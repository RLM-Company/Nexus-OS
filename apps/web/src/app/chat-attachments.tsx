"use client";

import { useCallback, useRef, useState } from "react";
import {
  CHAT_ATTACHMENT_LIMITS,
  CHAT_TEXT_EXTENSIONS,
  isValidChatAttachments,
  type ChatAttachment
} from "@cosmora/contracts/chat-attachments";
import { decodeChatAttachment } from "./decode-chat-attachment";
import { prepareChatImage } from "./prepare-chat-image";
import { WorkspaceIcon } from "./workspace-icons";
import { droppedComposerFiles } from "./chat-drop-policy";

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
  const latest = useRef(state);
  const publish = (next: typeof state) => {
    latest.current = next;
    setState(next);
  };
  const snapshotFiles = useCallback(
    () => (latest.current.scope === scopeRef.current ? latest.current.files : []),
    []
  );
  const snapshotReading = useCallback(
    () => latest.current.scope === scopeRef.current && latest.current.reading,
    []
  );
  const files = state.scope === scope ? state.files : [];
  const reading = state.scope === scope && state.reading;
  const error = state.scope === scope ? state.error : null;
  const replace = (next: ChatAttachment[]): void => {
    operationRef.current += 1;
    publish({ scope, files: next, reading: false, error: null });
  };
  const add = async (selected: File[]): Promise<void> => {
    const operation = ++operationRef.current;
    publish({ scope, files, reading: true, error: null });
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
        publish({ scope, files: next, reading: false, error: null });
      }
    } catch (cause) {
      if (scopeRef.current === scope && operationRef.current === operation) {
        publish({
          scope,
          files,
          reading: false,
          error: cause instanceof Error ? cause.message : "Не удалось прочитать файл."
        });
      }
    }
  };
  return { files, reading, error, add, replace, snapshotFiles, snapshotReading };
}

export function ChatAttachmentPicker({
  files,
  reading,
  error,
  disabled,
  onAdd,
  onRemove,
  textOnly = false,
  onOpenTool
}: {
  files: ChatAttachment[];
  reading: boolean;
  error: string | null;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  textOnly?: boolean;
  onOpenTool?: (tool: "research" | "images" | "video") => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const documents = [...CHAT_TEXT_EXTENSIONS, "pdf", "docx"].map((ext) => "." + ext).join(",");
  const canAttach = !disabled && !reading && files.length < CHAT_ATTACHMENT_LIMITS.files;

  function pick(accept: string) {
    if (!canAttach || !inputRef.current) return;
    inputRef.current.accept = accept;
    inputRef.current.click();
    setOpen(false);
  }
  return (
    <div
      className="chat-attachment-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpen(false);
        triggerRef.current?.focus();
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault(); // Never treat dropped file URLs as navigation.
        event.dataTransfer.dropEffect = disabled || reading ? "none" : "copy";
      }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        const files = droppedComposerFiles(event.dataTransfer, { disabled, reading, textOnly });
        if (files.length) onAdd(files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-label="Текстовые файлы и код"
        accept={documents}
        disabled={disabled || reading}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (selected.length) onAdd(selected);
        }}
      />
      <button
        type="button"
        ref={triggerRef}
        className="attachment-clip"
        aria-label="Добавить в чат"
        aria-expanded={open}
        title={textOnly ? "Прикрепить файл" : "Прикрепить файл или фото"}
        aria-busy={reading}
        disabled={disabled || reading}
        onClick={() => setOpen(!open)}
      >
        <WorkspaceIcon name="plus" />
      </button>
      {open && (
        <div className="attachment-actions">
          <button type="button" disabled={!canAttach} onClick={() => pick(documents)}>
            Прикрепить файл
          </button>
          {!textOnly && (
            <button type="button" disabled={!canAttach} onClick={() => pick(".png,.jpg,.jpeg")}>
              Прикрепить фото
            </button>
          )}
          {onOpenTool &&
            (
              [
                ["research", "Deep Research"],
                ["images", "Создать изображение"],
                ["video", "Создать видео"]
              ] as const
            ).map(([tool, label]) => (
              <button
                key={tool}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenTool(tool);
                }}
              >
                {label}
              </button>
            ))}
        </div>
      )}
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
