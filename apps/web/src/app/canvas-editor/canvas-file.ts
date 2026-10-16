import {
  CANVAS_MAX_CONTENT_BYTES,
  canvasBytes,
  type CanvasFormat
} from "@cosmora/contracts/canvas-artifacts";
import { decodeStudioDocument } from "../decode-chat-attachment";

/** Imports document text only; the original file and its active content remain untouched. */
export async function readCanvasFile(file: File, signal: AbortSignal) {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (
    !["txt", "md", "json", "csv", "html", "js", "ts", "py", "css", "sql", "docx"].includes(
      extension
    )
  )
    throw new Error("Откройте TXT, Markdown, DOCX или текстовый файл с кодом.");
  if (file.size > (extension === "docx" ? 20_000_000 : CANVAS_MAX_CONTENT_BYTES))
    throw new Error("Для Canvas нужен текст до 512 КиБ; исходный DOCX — до 20 МБ.");
  const content = await decodeStudioDocument(file, signal, () => {});
  signal.throwIfAborted();
  if (canvasBytes(content) > CANVAS_MAX_CONTENT_BYTES || content.includes("\0"))
    throw new Error("Текст документа превышает 512 КиБ или содержит двоичные данные.");
  const title =
    Array.from(file.name.replace(/\.[^.]+$/, ""))
      .slice(0, 60)
      .join("")
      .trim() || "Документ";
  const format: CanvasFormat =
    extension === "md"
      ? "markdown"
      : extension === "html"
        ? "html"
        : ["txt", "docx", "csv"].includes(extension)
          ? "text"
          : "code";
  return { title, format, content };
}
