import type { GeneralChatMessage } from "@cosmora/contracts";

export type ExportableChatMessage = Pick<
  GeneralChatMessage,
  "id" | "content" | "created_at" | "updated_at" | "status" | "attachments"
> & { role: string };

export type ChatExportSource = {
  id: string | null;
  projectId: string | null;
  title: string;
  messages: readonly ExportableChatMessage[];
};
export type ChatExportFormat = "markdown" | "json" | "text" | "html";

const statusLabels: Record<ExportableChatMessage["status"], string> = {
  pending: "Ожидает ответа",
  streaming: "Ответ не завершён",
  completed: "Завершено",
  failed: "Ответ прерван ошибкой",
  cancelled: "Ответ остановлен"
};

// Metadata is a single literal Markdown line; the message body remains original Markdown.
function literal(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
}

// HTML is an escaped, readable transcript, not a Markdown renderer. Message
// content stays verbatim inside <pre> so model output cannot inject markup.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createChatExport(
  source: ChatExportSource,
  format: ChatExportFormat,
  exportedAt = new Date().toISOString()
): { content: string; filename: string; mimeType: string } {
  const messages = source.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      created_at: message.created_at,
      updated_at: message.updated_at,
      // Never spread API records: run metadata, embedded images and extracted file text
      // are not part of a transcript export. Names/types describe what was attached.
      attachments: (message.attachments ?? []).map((attachment) =>
        "kind" in attachment && attachment.kind === "image"
          ? { name: attachment.name, kind: "image", media_type: attachment.media_type }
          : {
              name: attachment.name,
              kind: "document",
              source_type: "source_type" in attachment ? (attachment.source_type ?? "text") : "text"
            }
      )
    }));
  if (!messages.length) throw new Error("В этой переписке пока нет сообщений для экспорта.");

  const document = {
    format: "kosmora.chat",
    version: 1,
    exported_at: exportedAt,
    conversation: { id: source.id, project_id: source.projectId, title: source.title },
    attachments_mode: "metadata_only",
    messages
  };
  const title = Array.from(source.title.normalize("NFC").replace(/[^\p{L}\p{N}_-]+/gu, "-"))
    .slice(0, 72)
    .join("")
    .replace(/^-+|-+$/g, "");
  const extension =
    format === "json" ? "json" : format === "text" ? "txt" : format === "html" ? "html" : "md";
  const filename = `kosmora-${title || "chat"}-${exportedAt.replace(/[^0-9]/g, "")}.${extension}`;
  if (format === "text") {
    const content = [
      `${source.title} — экспортировано из Kosmora: ${exportedAt}`,
      source.projectId ? "Переписка проекта" : "Обычный чат",
      "Вложения: только названия и типы; содержимое файлов и фотографии не включены.",
      ...messages.map((message) => {
        const attachments = message.attachments.length
          ? `\nВложения:\n${message.attachments
              .map(
                (attachment) =>
                  `- ${attachment.name} (${attachment.kind === "image" ? "изображение" : (attachment.source_type ?? "text")})`
              )
              .join("\n")}`
          : "";
        return `---\n${message.role === "user" ? "Вы" : "Kosmora"} · ${message.created_at} · ${statusLabels[message.status]}\n\n${message.content}${attachments}`;
      })
    ].join("\n\n");
    return { content: `${content}\n`, filename, mimeType: "text/plain;charset=utf-8" };
  }
  if (format === "html") {
    const content = [
      "<!doctype html>",
      '<html lang="ru"><head><meta charset="utf-8"><title>',
      `${escapeHtml(source.title)}</title></head><body>`,
      `<h1>${escapeHtml(source.title)}</h1>`,
      `<p>Экспортировано из Kosmora: ${escapeHtml(exportedAt)}. ${source.projectId ? "Переписка проекта" : "Обычный чат"}.</p>`,
      "<p>Вложения: только названия и типы; содержимое файлов и фотографии не включены.</p>",
      ...messages.map((message) => {
        const attachments = message.attachments.length
          ? `<ul>${message.attachments
              .map(
                (attachment) =>
                  `<li>${escapeHtml(attachment.name)} (${attachment.kind === "image" ? "изображение" : escapeHtml(attachment.source_type ?? "text")})</li>`
              )
              .join("")}</ul>`
          : "";
        return `<section><h2>${message.role === "user" ? "Вы" : "Kosmora"}</h2><p>${escapeHtml(message.created_at)} · ${escapeHtml(statusLabels[message.status])}</p><pre>${escapeHtml(message.content)}</pre>${attachments}</section>`;
      }),
      "</body></html>"
    ].join("\n");
    return { content: `${content}\n`, filename, mimeType: "text/html;charset=utf-8" };
  }
  if (format === "json") {
    return {
      content: `${JSON.stringify(document, null, 2)}\n`,
      filename,
      mimeType: "application/json;charset=utf-8"
    };
  }
  const content = [
    `# ${literal(source.title)}`,
    `Экспортировано из Kosmora: ${exportedAt}`,
    source.projectId ? "Переписка проекта" : "Обычный чат",
    "Вложения: только названия и типы; содержимое файлов и фотографии не включены.",
    ...messages.map((message) => {
      const attachments = message.attachments.length
        ? `\n\nВложения:\n${message.attachments
            .map(
              (attachment) =>
                `- ${literal(attachment.name)} (${attachment.kind === "image" ? "изображение" : literal(attachment.source_type ?? "text")})`
            )
            .join("\n")}`
        : "";
      return `---\n\n## ${message.role === "user" ? "Вы" : "Kosmora"}\n\n${message.created_at} · ${statusLabels[message.status]}\n\n${message.content}${attachments}`;
    })
  ].join("\n\n");
  return { content: `${content}\n`, filename, mimeType: "text/markdown;charset=utf-8" };
}
