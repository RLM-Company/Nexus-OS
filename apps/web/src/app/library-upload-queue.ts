import type { IndexedPage, LibraryFileView } from "./studio-files-library-client";

export type UploadState =
  "waiting" | "uploading" | "reading" | "indexing" | "ready" | "failed" | "cancelled" | "uncertain";
export type LibraryUploadItem = {
  index: number;
  name: string;
  state: UploadState;
  detail: string;
  fileId?: string;
};
export const UPLOAD_STATE_LABELS: Record<UploadState, string> = {
  waiting: "В очереди",
  uploading: "Сохраняем оригинал",
  reading: "Читаем документ",
  indexing: "Индексируем",
  ready: "Готов",
  failed: "Ошибка",
  cancelled: "Отменено",
  uncertain: "Не подтверждено"
};
export const uploadFinished = (item: LibraryUploadItem): boolean =>
  ["ready", "failed", "cancelled", "uncertain"].includes(item.state);
export type LibraryUploadAdapter = {
  stage: (file: File, signal: AbortSignal) => Promise<LibraryFileView>;
  extract: (
    file: File,
    signal: AbortSignal,
    onProgress: (detail: string) => void
  ) => Promise<IndexedPage[]>;
  index: (file: LibraryFileView, pages: IndexedPage[], signal: AbortSignal) => Promise<unknown>;
  settle: (file: LibraryFileView, cancelled: boolean) => Promise<LibraryFileView["status"] | null>;
};

export async function runLibraryUploadQueue(
  files: readonly File[],
  adapter: LibraryUploadAdapter,
  signal: AbortSignal,
  onChange: (items: LibraryUploadItem[]) => void
): Promise<LibraryUploadItem[]> {
  if (files.length > 100) throw new Error("В одном пакете может быть до 100 файлов.");
  if (files.reduce((total, file) => total + file.size, 0) > 100_000_000)
    throw new Error("Общий размер пакета превышает 100 МБ. Выберите меньшую подборку.");
  let items: LibraryUploadItem[] = files.map((file, index) => ({
    index,
    name: file.name,
    state: "waiting",
    detail: ""
  }));
  const update = (index: number, changes: Partial<LibraryUploadItem>) => {
    items = items.map((item) => (item.index === index ? { ...item, ...changes } : item));
    onChange(items);
  };
  onChange(items);
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    if (signal.aborted) {
      update(index, { state: "cancelled", detail: "Обработка не начиналась." });
      continue;
    }
    if (
      !/^[^/\\]{1,180}\.(pdf|docx|txt|csv)$/i.test(file.name) ||
      Array.from(file.name).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ) ||
      !file.size ||
      file.size > 20_000_000
    ) {
      update(index, {
        state: "failed",
        detail: "Нужен непустой PDF, DOCX, TXT или CSV до 20 МБ с корректным именем."
      });
      continue;
    }
    let staged: LibraryFileView | null = null;
    let dispatched = false;
    try {
      update(index, { state: "uploading" });
      signal.throwIfAborted();
      dispatched = true;
      staged = await adapter.stage(file, signal);
      signal.throwIfAborted();
      update(index, { state: "reading", fileId: staged.id });
      const pages = await adapter.extract(file, signal, (detail) => {
        if (!signal.aborted) update(index, { detail });
      });
      signal.throwIfAborted();
      update(index, { state: "indexing", detail: "Сохраняем поисковый индекс…" });
      await adapter.index(staged, pages, signal);
      signal.throwIfAborted();
      update(index, { state: "ready", detail: "Оригинал и поисковый индекс сохранены." });
    } catch (cause) {
      if (staged) {
        const actual = await adapter.settle(staged, signal.aborted).catch(() => null);
        if (actual === "ready")
          update(index, {
            state: "ready",
            fileId: staged.id,
            detail: "Индекс уже сохранён на сервере."
          });
        else if (actual === "failed")
          update(index, {
            state: signal.aborted ? "cancelled" : "failed",
            fileId: staged.id,
            detail: signal.aborted
              ? "Обработка остановлена. Оригинал сохранён; можно повторить."
              : cause instanceof Error
                ? cause.message
                : "Обработка не удалась. Оригинал сохранён."
          });
        else
          update(index, {
            state: "uncertain",
            fileId: staged.id,
            detail:
              "Оригинал сохранён, итог обработки не подтверждён. Проверьте библиотеку перед повтором."
          });
      } else {
        // A lost POST response does not prove the original wasn't committed. Never auto-reupload.
        const knownRejection = cause instanceof LibraryUploadRejectedError;
        update(index, {
          state:
            dispatched && !knownRejection ? "uncertain" : signal.aborted ? "cancelled" : "failed",
          detail:
            dispatched && !knownRejection
              ? "Не удалось подтвердить сохранение оригинала. Проверьте библиотеку перед повторной загрузкой."
              : cause instanceof Error
                ? cause.message
                : "Загрузка не удалась."
        });
      }
    }
  }
  return items;
}

export class LibraryUploadRejectedError extends Error {}
