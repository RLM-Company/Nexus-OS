"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchText } from "./canvas-editor/text-search";
import {
  extractLibraryPages,
  type IndexedPage,
  type LibraryFileView
} from "./studio-files-library-client";
import styles from "./library-file-preview.module.css";
import {
  sourceLineRange,
  previewPart,
  PREVIEW_PART_SIZE,
  type SourceLocation
} from "./library-source-location";
export function LibraryFilePreview({
  base,
  file,
  disabled,
  location
}: {
  base: string;
  file: LibraryFileView;
  disabled: boolean;
  location?: SourceLocation;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const pending = useRef<AbortController | null>(null);
  const marker = useRef<HTMLElement>(null);
  const reader = useRef<HTMLPreElement>(null);
  const [visible, setVisible] = useState(false);
  const [pages, setPages] = useState<IndexedPage[]>([]);
  const [index, setIndex] = useState(0);
  const [part, setPart] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => {
    pending.current?.abort();
    modal.current?.close();
    opener.current?.focus();
  };
  const open = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setVisible(true);
    setPages([]);
    setError("");
    setIndex(0);
    setQuery("");
    setStatus("Читаю сохранённый оригинал…");
    modal.current?.showModal();
    try {
      const response = await fetch(`${base}/${encodeURIComponent(file.id)}/download`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)])
      });
      if (!response.ok) throw new Error("Не удалось открыть оригинал. Проверьте доступ к проекту.");
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      if (blob.size > 20_000_000) throw new Error("Предпросмотр: максимум 20 МБ.");
      const extracted = await extractLibraryPages(
        new File([blob], file.name),
        controller.signal,
        (value) => {
          if (!controller.signal.aborted) setStatus(value);
        }
      );
      controller.signal.throwIfAborted();
      setPages(extracted);
      if (location)
        setIndex(
          Math.max(
            0,
            extracted.findIndex((page) => page.page === location.page)
          )
        );
      setStatus("");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Предпросмотр недоступен.");
        setStatus("");
      }
    }
  };
  const match = query.trim().toLocaleLowerCase("ru");
  const available = pages
    .map((page, index) => ({ ...page, index }))
    .filter((page) => !match || page.text.toLocaleLowerCase("ru").includes(match));
  const selected = available.find((page) => page.index === index) ?? available[0];
  const candidateRange =
    location && selected?.page === location.page
      ? sourceLineRange(selected.text, location.line_start, location.line_end)
      : null;
  const range =
    candidateRange &&
    (!location?.content ||
      selected!.text
        .slice(candidateRange.start, candidateRange.end)
        .replace(/\r\n?/g, "\n")
        .includes(location.content.replace(/\r\n?/g, "\n")))
      ? candidateRange
      : null;
  const partView = previewPart(selected?.text ?? "", part);
  const found = useMemo(
    () => (match ? searchText(selected?.text ?? "", query.trim()).matches[0] : null),
    [selected?.text, match, query]
  );
  const focusRange = match ? found : range;
  const markStart = focusRange ? Math.max(partView.start, focusRange.start) : 0;
  const markEnd = focusRange ? Math.min(partView.end, focusRange.end) : 0;
  useEffect(() => {
    const offset = focusRange?.start ?? 0;
    setPart(Math.floor(Math.max(0, offset) / PREVIEW_PART_SIZE));
  }, [selected?.index, match, pages, focusRange?.start]);
  useEffect(() => {
    if (visible && focusRange && marker.current) marker.current.scrollIntoView({ block: "center" });
    else if (reader.current) reader.current.scrollTop = 0;
  }, [visible, selected?.index, pages, focusRange?.start, focusRange?.end, partView.index, match]);
  return (
    <>
      <button
        ref={opener}
        type="button"
        disabled={disabled}
        onClick={() => void open()}
        aria-label={
          location
            ? `Открыть источник ${location.citation ?? file.name}`
            : `Предпросмотр ${file.name}`
        }
      >
        {location ? "Открыть источник" : "Просмотр"}
      </button>
      <dialog
        ref={modal}
        className={styles.dialog}
        aria-labelledby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onCancel={close}
        onClose={() => {
          setVisible(false);
          pending.current?.abort();
          opener.current?.focus();
        }}
      >
        {visible && (
          <>
            <header>
              <div>
                <h3 id={id}>{file.name}</h3>
                <p>Текст сохранённого оригинала · без отправки модели</p>
              </div>
              <button type="button" aria-label="Закрыть предпросмотр файла" onClick={close}>
                ×
              </button>
            </header>
            {status && <p role="status">{status}</p>}
            {error && <p role="alert">{error}</p>}
            {!!pages.length && (
              <>
                <div className={styles.tools}>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Поиск в предпросмотре"
                    placeholder="Найти текст…"
                  />
                  <select
                    aria-label="Страница предпросмотра"
                    value={selected?.index ?? ""}
                    onChange={(e) => setIndex(Number(e.target.value))}
                    disabled={!available.length}
                  >
                    {available.map((page) => (
                      <option key={page.index} value={page.index}>
                        {page.page === null ? "Текст документа" : `Страница ${page.page}`}
                      </option>
                    ))}
                  </select>
                  <span>
                    {available.length} из {pages.length}
                  </span>
                  {partView.count > 1 && (
                    <select
                      aria-label="Часть текста оригинала"
                      value={partView.index}
                      onChange={(event) => setPart(Number(event.target.value))}
                    >
                      {Array.from({ length: partView.count }, (_, i) => (
                        <option key={i} value={i}>
                          Часть {i + 1} из {partView.count}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <pre ref={reader} tabIndex={0} aria-label="Текст оригинала">
                  {selected ? (
                    focusRange && markEnd > markStart ? (
                      <>
                        {selected.text.slice(partView.start, markStart)}
                        <mark
                          ref={marker}
                          aria-label={match ? "Найденный текст" : "Цитируемые строки"}
                        >
                          {selected.text.slice(markStart, markEnd)}
                        </mark>
                        {selected.text.slice(markEnd, partView.end)}
                      </>
                    ) : (
                      selected.text.slice(partView.start, partView.end)
                    )
                  ) : (
                    "Совпадений не найдено."
                  )}
                </pre>
                {partView.count > 1 && (
                  <p>Предпросмотр показан частями. Полный текст сохраняется в оригинале.</p>
                )}
                {location && (
                  <p>
                    {range
                      ? `${location.page === null ? "Текст" : `Страница ${location.page}`} · строки ${location.line_start}–${location.line_end}`
                      : "Указанные строки не найдены в текущем извлечённом тексте. Цитата сохранена в отчёте."}
                  </p>
                )}
              </>
            )}
            <footer>
              <a href={`${base}/${encodeURIComponent(file.id)}/download`}>Скачать оригинал</a>
              <small>Извлечённый текст без исходной вёрстки. Для сканов требуется OCR.</small>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
