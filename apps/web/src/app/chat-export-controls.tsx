"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createChatExport, type ChatExportFormat, type ChatExportSource } from "./chat-export";
import { downloadBlob, downloadText } from "./chat-response";

export function ChatExportControls({
  source,
  disabled
}: {
  source: ChatExportSource;
  disabled: boolean;
}) {
  const [format, setFormat] = useState<ChatExportFormat | "zip">("markdown");
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const [error, setError] = useState<string | null>(null);
  const description = useId();
  const formatId = useId();
  const available = source.messages.some(
    (message) => message.role === "user" || message.role === "assistant"
  );
  return (
    <fieldset>
      <legend>Экспорт переписки</legend>
      <label htmlFor={formatId}>Формат файла</label>
      <select
        id={formatId}
        value={format}
        disabled={busy}
        onChange={(event) => {
          setError(null);
          setFormat(event.target.value as ChatExportFormat | "zip");
        }}
      >
        <option value="markdown">Markdown (.md)</option>
        <option value="json">JSON (.json)</option>
        <option value="zip">Архив с вложениями (.zip)</option>
      </select>
      <p id={description}>
        {format === "zip"
          ? "Переписка и сохранённые вложения. PDF и DOCX — извлечённый текст, фотографии — версия из чата. До 25 МБ."
          : "Текст, код, даты и названия вложений. Сами файлы и фотографии не включены."}
      </p>
      <button
        type="button"
        disabled={disabled || busy || !available}
        aria-describedby={description}
        onClick={() => {
          void (async () => {
            setError(null);
            const controller = new AbortController();
            operation.current = controller;
            setBusy(true);
            try {
              if (format === "zip") {
                const { createChatArchive } = await import("./chat-archive-export");
                controller.signal.throwIfAborted();
                const result = await createChatArchive(source, undefined, controller.signal);
                controller.signal.throwIfAborted();
                downloadBlob(
                  new Blob([result.bytes], { type: "application/zip" }),
                  result.filename
                );
              } else {
                const result = createChatExport(source, format);
                downloadText(result.content, result.filename, result.mimeType);
              }
            } catch (cause) {
              if (!controller.signal.aborted)
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Не удалось подготовить файл. Повторите скачивание."
                );
            } finally {
              if (operation.current === controller && !controller.signal.aborted) {
                operation.current = null;
                setBusy(false);
              }
            }
          })();
        }}
      >
        {busy ? "Подготовка архива…" : "Скачать переписку"}
      </button>
      {busy && <p role="status">Подготавливаем файл на этом устройстве…</p>}
      {busy && (
        <button
          type="button"
          onClick={() => {
            operation.current?.abort();
            operation.current = null;
            setBusy(false);
          }}
        >
          Отменить подготовку
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
