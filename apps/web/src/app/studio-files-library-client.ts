import { decodeStudioDocument } from "./decode-chat-attachment";

export type IndexedPage = { page: number | null; text: string };
export type LibraryFileView = {
  id: string;
  project_id: string;
  name: string;
  format: string;
  bytes: number;
  status: "processing" | "ready" | "failed";
  error_code: string | null;
  characters: number;
  chunks: number;
};
export type LibrarySearchHit = {
  file_id: string;
  chunk_id: number;
  name: string;
  ordinal: number;
  page: number | null;
  line_start: number;
  line_end: number;
  content: string;
  citation: string;
  score: number;
};

export async function extractLibraryPages(
  file: File,
  signal: AbortSignal,
  onProgress: (value: string) => void
): Promise<IndexedPage[]> {
  if (!/\.(pdf|docx|csv|txt)$/i.test(file.name) || file.size > 20_000_000 || !file.size)
    throw new Error("Библиотека принимает PDF, DOCX, TXT, CSV до 20 МБ.");
  signal.throwIfAborted();
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await import("pdfjs-dist");
    pdf.GlobalWorkerOptions.workerSrc = "/generated/pdf.worker.mjs";
    const task = pdf.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      disableFontFace: true,
      useSystemFonts: false
    });
    const abort = () => {
      void task.destroy();
    };
    const timer = window.setTimeout(abort, 60_000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const document = await task.promise;
      if (document.numPages > 500) throw new Error("PDF: максимум 500 страниц.");
      const pages: IndexedPage[] = [];
      let characters = 0;
      for (let i = 1; i <= document.numPages; i++) {
        signal.throwIfAborted();
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        const text =
          content.items
            .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
            .join("") || "\n";
        characters += text.length;
        if (characters > 2_000_000) throw new Error("Текст: максимум 2 млн символов.");
        pages.push({ page: i, text });
        page.cleanup();
        onProgress(`Извлечена страница ${i} из ${document.numPages}`);
      }
      if (!pages.some((p) => p.text.trim()))
        throw new Error("Не найден текстовый слой PDF. OCR не реализован.");
      return pages;
    } finally {
      signal.removeEventListener("abort", abort);
      window.clearTimeout(timer);
      await task.destroy();
    }
  }
  const text = await decodeStudioDocument(file, signal, (current, total, unit) =>
    onProgress(
      unit === "page"
        ? `Страница ${current}/${total}`
        : `Прочитано ${Math.round((current / Math.max(total, 1)) * 100)}%`
    )
  );
  signal.throwIfAborted();
  return [{ page: null, text }];
}

export async function libraryFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const result = await fetch(url, { ...init, cache: "no-store" });
  if (!result.ok) {
    // Do not display raw server error text or user documents in UI errors.
    throw new Error(`Ошибка библиотеки (${result.status}). Проверьте права, квоты или файл.`);
  }
  return (await result.json()) as T;
}
