import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  canvasBytes,
  validateCanvasContent,
  type CanvasFormat
} from "@cosmora/contracts/canvas-artifacts";
import type { CanvasDraft } from "./canvas-draft-storage";

const formats: Record<string, CanvasFormat> = {
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  csv: "text",
  tsv: "text",
  html: "html",
  htm: "html",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  css: "code",
  json: "code",
  yaml: "code",
  yml: "code",
  sql: "code",
  sh: "code",
  xml: "code"
};
export const CANVAS_FILE_ACCEPT = Object.keys(formats)
  .map((extension) => "." + extension)
  .join(",");

/** Local-only conversion. Strict UTF-8; preserve BOM, CR/LF and all original text bytes. */
export function canvasFileDraft(name: string, bytes: Uint8Array): CanvasDraft {
  if (bytes.byteLength > CANVAS_MAX_CONTENT_BYTES) throw new Error("Файл превышает лимит 512 КиБ.");
  const basename = name.split(/[\\/]/).at(-1) ?? "";
  const extension = basename.split(".").at(-1)?.toLowerCase() ?? "";
  const format = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!format) throw new Error("Выберите текстовый файл: Markdown, TXT, HTML, JSON или код.");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Файл не в UTF-8. Сохраните его в UTF-8 и выберите заново.");
  }
  if (
    Array.from(content).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new Error("В файле обнаружены бинарные или управляющие символы.");
  let title = "";
  const cleanName = Array.from(basename, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character
  )
    .join("")
    .trim();
  for (const character of cleanName) {
    if (canvasBytes(title + character) > CANVAS_MAX_TITLE_BYTES) break;
    title += character;
  }
  title = title.trim() || "Импорт файла";
  validateCanvasContent(title, format, content);
  return { title, format, content, baseVersion: 0 };
}
