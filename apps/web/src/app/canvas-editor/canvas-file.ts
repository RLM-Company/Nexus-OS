import { CANVAS_MAX_CONTENT_BYTES } from "@cosmora/contracts/canvas-artifacts";
import { decodeStudioDocument } from "../decode-chat-attachment";
import { canvasFileDraft } from "./canvas-file-import";

/** Documents become local text drafts. No write or active-content evaluation. */
export async function readCanvasFile(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  if (file.name.toLowerCase().endsWith(".docx")) {
    if (file.size > 20000000) throw new Error("Исходный DOCX должен быть до 20 МБ.");
    const content = await decodeStudioDocument(file, signal, () => {});
    signal.throwIfAborted();
    const draft = canvasFileDraft(
      file.name.slice(0, -5) + ".txt",
      new TextEncoder().encode(content)
    );
    return {
      title: draft.title.replace(/\.txt$/, ""),
      format: "text" as const,
      content: draft.content
    };
  }
  if (file.size > CANVAS_MAX_CONTENT_BYTES) throw new Error("Файл превышает лимит 512 КиБ.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const { title, format, content } = canvasFileDraft(file.name, bytes);
  return { title, format, content };
}
