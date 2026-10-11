"use client";

import { useId, useState } from "react";
import { createChatExport, type ChatExportFormat, type ChatExportSource } from "./chat-export";
import { downloadText } from "./chat-response";

export function ChatExportControls({
  source,
  disabled
}: {
  source: ChatExportSource;
  disabled: boolean;
}) {
  const [format, setFormat] = useState<ChatExportFormat>("markdown");
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
        onChange={(event) => setFormat(event.target.value as ChatExportFormat)}
      >
        <option value="markdown">Markdown (.md)</option>
        <option value="json">JSON (.json)</option>
      </select>
      <p id={description}>
        Текст, код, даты и названия вложений. Сами файлы и фотографии не включены.
      </p>
      <button
        type="button"
        disabled={disabled || !available}
        aria-describedby={description}
        onClick={() => {
          setError(null);
          try {
            const result = createChatExport(source, format);
            downloadText(result.content, result.filename, result.mimeType);
          } catch {
            setError("Не удалось подготовить файл. Повторите скачивание.");
          }
        }}
      >
        Скачать переписку
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
