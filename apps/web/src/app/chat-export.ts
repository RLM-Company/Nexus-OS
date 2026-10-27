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
export type ChatExportFormat = "markdown" | "json";

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
  const filename = `kosmora-${title || "chat"}-${exportedAt.replace(/[^0-9]/g, "")}.${format === "json" ? "json" : "md"}`;
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
