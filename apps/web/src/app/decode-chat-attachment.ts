import { Unzip, UnzipInflate } from "fflate";
import {
  CHAT_ATTACHMENT_LIMITS,
  imageDimensions,
  isChatFilename,
  isChatTextFilename,
  type ChatAttachment
} from "@cosmora/contracts/chat-attachments";

const boundedText = (value: string): string => {
  if (!value.trim())
    throw new Error("В документе нет текста. Для сканов используйте изображение страницы.");
  if (value.length > CHAT_ATTACHMENT_LIMITS.charactersPerFile) {
    throw new Error("В документе больше 8 000 символов. Прикрепите нужный фрагмент отдельно.");
  }
  return value;
};

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = "/generated/pdf.worker.mjs";
  const task = pdf.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false });
  const timeout = window.setTimeout(() => {
    void task.destroy();
  }, 10_000);
  try {
    const document = await task.promise;
    if (document.numPages > 20) throw new Error("PDF должен содержать не больше 20 страниц.");
    let result = "";
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      result +=
        content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("") + "\n";
      if (result.length > CHAT_ATTACHMENT_LIMITS.charactersPerFile) boundedText(result);
      page.cleanup();
    }
    return boundedText(result.trim());
  } catch (cause) {
    if (cause instanceof Error && /8 000|20 страниц|нет текста/.test(cause.message)) throw cause;
    throw new Error(
      "Не удалось прочитать PDF. Проверьте файл; защищённые паролем PDF не поддерживаются.",
      { cause }
    );
  } finally {
    window.clearTimeout(timeout);
    await task.destroy();
  }
}

function docxText(bytes: Uint8Array): string {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let found = false;
  let complete = false;
  const unzip = new Unzip((file) => {
    if (file.name !== "word/document.xml") return;
    if (found || (file.originalSize ?? 0) > 512_000)
      throw new Error("DOCX слишком большой после распаковки.");
    found = true;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      if (size > 512_000) {
        file.terminate();
        throw new Error("DOCX слишком большой после распаковки.");
      }
      chunks.push(data);
      complete = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
    if (!found || !complete) throw new Error("Нет документа");
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Недопустимый XML");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Недопустимый XML");
    const result = Array.from(document.getElementsByTagNameNS("*", "p"))
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS("*", "t"))
          .map((node) => node.textContent ?? "")
          .join("")
      )
      .join("\n");
    return boundedText(result.trim());
  } catch (cause) {
    if (cause instanceof Error && /8 000|нет текста|после распаковки/.test(cause.message))
      throw cause;
    throw new Error("Не удалось прочитать DOCX. Нужен документ Word без пароля.", { cause });
  }
}

export async function decodeChatAttachment(file: File): Promise<ChatAttachment> {
  if (!isChatFilename(file.name)) throw new Error("Недопустимое имя файла.");
  const extension = file.name.toLowerCase().split(".").at(-1);
  const image = extension === "png" || extension === "jpg" || extension === "jpeg";
  const document = extension === "pdf" || extension === "docx";
  if (!image && !document && !isChatTextFilename(file.name))
    throw new Error("Поддерживаются текст, код, PDF, DOCX, PNG и JPEG.");
  const limit = image
    ? CHAT_ATTACHMENT_LIMITS.imageBytes
    : document
      ? CHAT_ATTACHMENT_LIMITS.documentBytes
      : CHAT_ATTACHMENT_LIMITS.bytesPerFile;
  if (file.size > limit)
    throw new Error(
      image
        ? "Изображение: до 1 МБ."
        : document
          ? "Документ: до 2 МБ."
          : "Файл слишком большой: до 32 КБ и 8 000 символов на файл."
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (image) {
    const media_type = extension === "png" ? "image/png" : "image/jpeg";
    const dimensions = imageDimensions(bytes, media_type);
    if (
      !dimensions ||
      dimensions.width <= 0 ||
      dimensions.height <= 0 ||
      dimensions.width > 4096 ||
      dimensions.height > 4096 ||
      dimensions.width * dimensions.height > 8_000_000
    )
      throw new Error("Нужно PNG/JPEG до 4096 × 4096 и 8 миллионов пикселей.");
    try {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: media_type }));
      bitmap.close();
    } catch {
      throw new Error("Не удалось прочитать изображение. Проверьте PNG/JPEG.");
    }
    let raw = "";
    for (let start = 0; start < bytes.length; start += 8192)
      raw += String.fromCharCode(...bytes.slice(start, start + 8192));
    return { kind: "image", name: file.name, media_type, data_base64: btoa(raw) };
  }
  if (extension === "pdf")
    return { name: file.name, source_type: "pdf", content: await pdfText(bytes) };
  if (extension === "docx")
    return { name: file.name, source_type: "docx", content: docxText(bytes) };
  try {
    return { name: file.name, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    throw new Error("Не удалось прочитать файл. Используйте текст в кодировке UTF-8.");
  }
}
