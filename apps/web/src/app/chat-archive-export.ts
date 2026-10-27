import { zip, type Zippable } from "fflate";
import { isValidChatAttachments } from "@cosmora/contracts/chat-attachments";
import { createChatExport, type ChatExportSource } from "./chat-export";

export const CHAT_ARCHIVE_LIMITS = { bytes: 25 * 1024 * 1024, attachments: 300 } as const;
type ArchivedAttachment = {
  message_id: string;
  original_name: string;
  path: string;
  representation: "saved_image" | "saved_text" | "extracted_text";
  bytes: number;
  sha256: string;
};

function attachmentName(name: string, extension: string): string {
  const stem = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-");
  return `${
    Array.from(stem)
      .slice(0, 72)
      .join("")
      .replace(/^-+|-+$/g, "") || "file"
  }.${extension}`;
}

export async function createChatArchive(
  source: ChatExportSource,
  exportedAt = new Date().toISOString(),
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  signal?.throwIfAborted();
  const markdown = createChatExport(source, "markdown", exportedAt);
  const json = createChatExport(source, "json", exportedAt);
  const files: Zippable = Object.create(null) as Zippable;
  const encoder = new TextEncoder();
  let size = 0;
  let count = 0;
  const attachments: ArchivedAttachment[] = [];
  const add = (path: string, bytes: Uint8Array) => {
    size += bytes.byteLength;
    if (size > CHAT_ARCHIVE_LIMITS.bytes)
      throw new Error(
        "Архив превышает 25 МБ. Скачайте переписку без вложений и нужные файлы отдельно."
      );
    files[path] = bytes;
  };
  add("conversation.md", encoder.encode(markdown.content));
  add("conversation.json", encoder.encode(json.content));
  for (const message of source.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.attachments?.length) continue;
    if (!isValidChatAttachments(message.attachments))
      throw new Error("Одно из сохранённых вложений повреждено. Скачайте переписку без вложений.");
    for (const attachment of message.attachments) {
      signal?.throwIfAborted();
      if (++count > CHAT_ARCHIVE_LIMITS.attachments)
        throw new Error("В архиве может быть до 300 вложений. Скачайте переписку без вложений.");
      const text = "content" in attachment;
      const bytes = text
        ? encoder.encode(attachment.content)
        : Uint8Array.from(atob(attachment.data_base64), (character) => character.charCodeAt(0));
      const extension = text ? "txt" : attachment.media_type === "image/png" ? "png" : "jpg";
      const path = `attachments/${String(count).padStart(4, "0")}-${attachmentName(attachment.name, extension)}`;
      add(path, bytes);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      attachments.push({
        message_id: message.id,
        original_name: attachment.name,
        path,
        representation: text
          ? attachment.source_type
            ? "extracted_text"
            : "saved_text"
          : "saved_image",
        bytes: bytes.byteLength,
        sha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")
      });
    }
  }
  add(
    "manifest.json",
    encoder.encode(
      JSON.stringify(
        {
          format: "kosmora.chat.archive",
          version: 1,
          exported_at: exportedAt,
          conversation: { id: source.id, project_id: source.projectId, title: source.title },
          attachments
        },
        null,
        2
      ) + "\n"
    )
  );
  add(
    "README.txt",
    encoder.encode(
      "Kosmora — архив переписки\n\nconversation.md — читаемая переписка с кодом и датами.\nconversation.json — структура сообщений и статусы.\nmanifest.json — соответствие вложений сообщениям, размеры и SHA-256.\nattachments/ — сохранённые изображения и тексты.\n\nPDF и DOCX представлены извлечённым текстом (.txt), а не исходным документом.\nИзображения соответствуют версии, сохранённой в чате, которая могла быть уменьшена при загрузке.\nДля всех текстовых вложений используется .txt. Оригинальные имена указаны в manifest.json.\nЭто архив для скачивания, автоматический импорт в Kosmora не предусмотрен.\n"
    )
  );
  signal?.throwIfAborted();
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    let terminate = () => {};
    const abort = () => {
      terminate();
      reject(new DOMException("Отменено", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    terminate = zip(files, { level: 1 }, (error, result) => {
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(new Uint8Array(result));
    });
    if (signal?.aborted) abort();
  });
  signal?.throwIfAborted();
  return { bytes, filename: json.filename.replace(/\.json$/, ".zip") };
}
