import { Unzip, UnzipInflate } from "fflate";
import {
  CHAT_ATTACHMENT_LIMITS,
  imageDimensions,
  isChatFilename,
  isChatTextFilename,
  type ChatAttachment
} from "@cosmora/contracts/chat-attachments";

type DocumentOptions = {
  characters: number;
  pages: number;
  xmlBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (page: number, total: number) => void;
};
const chatOptions: DocumentOptions = {
  characters: 8_000,
  pages: 20,
  xmlBytes: 512_000,
  timeoutMs: 10_000
};
const boundedText = (value: string, options = chatOptions): string => {
  if (!value.trim())
    throw new Error("В документе нет текста. Для сканов используйте изображение страницы.");
  if (value.length > options.characters) {
    throw new Error(
      `В документе больше ${options.characters.toLocaleString("ru").replace(/[\u00a0\u202f]/g, " ")} символов. Выберите меньший файл или фрагмент.`
    );
  }
  return value;
};

async function pdfText(bytes: Uint8Array, options = chatOptions): Promise<string> {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = "/generated/pdf.worker.mjs";
  options.signal?.throwIfAborted();
  const task = pdf.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false
  });
  const abort = () => {
    void task.destroy();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => {
    void task.destroy();
  }, options.timeoutMs);
  try {
    const document = await task.promise;
    if (document.numPages > options.pages)
      throw new Error(`PDF должен содержать не больше ${options.pages} страниц.`);
    let result = "";
    for (let number = 1; number <= document.numPages; number++) {
      options.signal?.throwIfAborted();
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      result +=
        content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("") + "\n";
      if (result.length > options.characters) boundedText(result, options);
      page.cleanup();
      options.onProgress?.(number, document.numPages);
    }
    return boundedText(result.trim(), options);
  } catch (cause) {
    options.signal?.throwIfAborted();
    if (cause instanceof Error && /символов|страниц|нет текста/.test(cause.message)) throw cause;
    throw new Error(
      "Не удалось прочитать PDF. Проверьте файл; защищённые паролем PDF не поддерживаются.",
      { cause }
    );
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}

async function docxText(bytes: Uint8Array, options = chatOptions): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let found = false;
  let complete = false;
  const unzip = new Unzip((file) => {
    if (file.name !== "word/document.xml") return;
    if (found || (file.originalSize ?? 0) > options.xmlBytes)
      throw new Error("DOCX слишком большой после распаковки.");
    found = true;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      if (size > options.xmlBytes) {
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
    for (let position = 0; position < bytes.length; position += 16_384) {
      options.signal?.throwIfAborted();
      unzip.push(bytes.subarray(position, position + 16_384), position + 16_384 >= bytes.length);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
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
    return boundedText(result.trim(), options);
  } catch (cause) {
    options.signal?.throwIfAborted();
    if (cause instanceof Error && /символов|нет текста|после распаковки/.test(cause.message))
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
    return { name: file.name, source_type: "docx", content: await docxText(bytes) };
  try {
    return { name: file.name, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    throw new Error("Не удалось прочитать файл. Используйте текст в кодировке UTF-8.");
  }
}

export async function decodeStudioDocument(
  file: File,
  signal: AbortSignal,
  onProgress: (page: number, total: number) => void
): Promise<string> {
  if (!isChatFilename(file.name)) throw new Error("Недопустимое имя файла.");
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension !== "pdf" && extension !== "docx" && !isChatTextFilename(file.name))
    throw new Error("Выберите PDF, DOCX, текст или файл с кодом.");
  if (file.size > 20_000_000) throw new Error("Выберите файл до 20 МБ.");
  signal.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const options: DocumentOptions = {
    characters: 2_000_000,
    pages: 500,
    xmlBytes: 8_000_000,
    timeoutMs: 60_000,
    signal,
    onProgress
  };
  if (extension === "pdf") return pdfText(bytes, options);
  if (extension === "docx") return docxText(bytes, options);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Используйте текст в кодировке UTF-8.");
  }
  boundedText(text, options);
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code === 127 || (code < 32 && ![9, 10, 13].includes(code)))
      throw new Error("В файле обнаружены двоичные данные.");
  }
  return text;
}
