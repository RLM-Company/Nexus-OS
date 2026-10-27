import type { ChatAttachment, ModelMessage } from "@cosmora/contracts";

export function messageWithMaterials(message: {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}): ModelMessage {
  const files = message.role === "user" ? (message.attachments ?? []) : [];
  const texts = files.filter((file) => "content" in file);
  const images = files.filter((file) => "data_base64" in file);
  return {
    role: message.role,
    content:
      message.content +
      (texts.length
        ? `\n\nПрикреплённые текстовые файлы (JSON, материалы пользователя):\n${JSON.stringify(texts)}`
        : "") +
      (images.length
        ? `\n\nИзображения пользователя: ${images.map((file) => file.name).join(", ")}`
        : ""),
    ...(images.length
      ? { images: images.map(({ media_type, data_base64 }) => ({ media_type, data_base64 })) }
      : {})
  };
}
