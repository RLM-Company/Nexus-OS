import { zip, type Zippable } from "fflate";
import type { LibraryFileView } from "./studio-files-library-client";

export const ORIGINAL_ARCHIVE_LIMIT = 50_000_000;
type OriginalEntry = { file_id: string; name: string; path: string; bytes: number; sha256: string };

export async function createLibraryOriginalsArchive({
  projectId,
  files,
  signal,
  onProgress,
  fetcher = fetch
}: {
  projectId: string;
  files: readonly LibraryFileView[];
  signal: AbortSignal;
  onProgress: (completed: number, total: number, name: string) => void;
  fetcher?: typeof fetch;
}): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (!files.length || files.length > 100) throw new Error("Выберите от 1 до 100 документов.");
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error("В подборке повторяется документ.");
  if (
    files.some(
      (file) => !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 20_000_000
    )
  )
    throw new Error("Неверный размер сохранённого документа.");
  if (files.reduce((sum, file) => sum + file.bytes, 0) > ORIGINAL_ARCHIVE_LIMIT)
    throw new Error("Архив оригиналов ограничен 50 МБ. Выберите меньше документов.");
  const entries: Zippable = Object.create(null) as Zippable;
  const manifest: OriginalEntry[] = [];
  let totalBytes = 0;
  for (let index = 0; index < files.length; index++) {
    signal.throwIfAborted();
    const file = files[index]!;
    if (!/^(pdf|docx|txt|csv)$/.test(file.format))
      throw new Error("Неподдерживаемый формат документа.");
    onProgress(index, files.length, file.name);
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const response = await fetcher(
      `/api/v1/projects/${encodeURIComponent(projectId)}/document-library/${encodeURIComponent(file.id)}/download`,
      { signal: requestSignal, cache: "no-store" }
    );
    if (!response.ok || !response.body)
      throw new Error("Не удалось скачать один из оригиналов. Архив не создан; повторите позже.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let ended = false;
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    requestSignal.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const item = await reader.read();
        requestSignal.throwIfAborted();
        if (item.done) {
          ended = true;
          break;
        }
        length += item.value.byteLength;
        totalBytes += item.value.byteLength;
        if (length > file.bytes || totalBytes > ORIGINAL_ARCHIVE_LIMIT)
          throw new Error(
            "Размер оригинала изменился или превышает лимит. Обновите список документов."
          );
        chunks.push(item.value);
      }
      if (length !== file.bytes)
        throw new Error("Оригинал загружен не полностью. Архив не создан.");
    } finally {
      requestSignal.removeEventListener("abort", abort);
      if (!ended) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    signal.throwIfAborted();
    const stem =
      Array.from(
        file.name
          .replace(/\.[^.]*$/, "")
          .normalize("NFC")
          .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      )
        .slice(0, 80)
        .join("")
        .replace(/^-+|-+$/g, "") || "document";
    const path = `documents/${String(index + 1).padStart(4, "0")}-${stem}.${file.format}`;
    entries[path] = bytes;
    manifest.push({
      file_id: file.id,
      name: file.name,
      path,
      bytes: length,
      sha256: Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")
    });
    onProgress(index + 1, files.length, file.name);
  }
  const encoder = new TextEncoder();
  entries["manifest.json"] = encoder.encode(
    JSON.stringify(
      {
        format: "kosmora.library.originals",
        version: 1,
        project_id: projectId,
        exported_at: new Date().toISOString(),
        files: manifest
      },
      null,
      2
    )
  );
  entries["README.txt"] = encoder.encode(
    "Kosmora — оригиналы документов проекта\n\nВ documents/ находятся точные сохранённые байты PDF, DOCX, TXT и CSV.\nmanifest.json связывает документы с их именами/ID и содержит размеры/SHA-256.\nИмена внутри ZIP очищены и пронумерованы; исходные имена сохранены в manifest.json.\nЭто выбранные оригиналы, а не полный экспорт проекта и его индекса.\n"
  );
  signal.throwIfAborted();
  const output = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    let stop = () => {};
    const abort = () => {
      stop();
      reject(new DOMException("Отменено", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    stop = zip(entries, { level: 1 }, (error, result) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(new Uint8Array(result));
    });
    if (signal.aborted) abort();
  });
  signal.throwIfAborted();
  return output;
}
