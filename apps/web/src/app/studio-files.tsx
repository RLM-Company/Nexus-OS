"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CHAT_TEXT_EXTENSIONS, type ChatAttachment } from "@cosmora/contracts/chat-attachments";
import { decodeStudioDocument } from "./decode-chat-attachment";
import { WorkspaceIcon as Icon } from "./workspace-icons";
import styles from "./studio-files.module.css";

// Each part fits the chat byte budget, even with non-ASCII text.
function splitText(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4_500, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + 2_250) end = newline + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
export function StudioFiles({
  onCompose
}: {
  onCompose: (prompt: string, files?: ChatAttachment[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const [document, setDocument] = useState<{
    name: string;
    bytes: number;
    text: string;
    parts: string[];
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query.trim().toLocaleLowerCase("ru"));
  const [question, setQuestion] = useState(
    "Выдели главные мысли, важные факты и вопросы, требующие проверки."
  );
  useEffect(() => () => operation.current?.abort(), []);
  const load = async (file: File) => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setReading(true);
    setProgress("Читаю файл…");
    setError(null);
    setDocument(null);
    setQuery("");
    setIndex(0);
    try {
      const text = await decodeStudioDocument(file, controller.signal, (page, total) => {
        if (!controller.signal.aborted) setProgress(`Страница ${page} из ${total}`);
      });
      controller.signal.throwIfAborted();
      setDocument({ name: file.name, bytes: file.size, text, parts: splitText(text) });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл.");
    } finally {
      if (operation.current === controller) {
        setReading(false);
        setProgress("");
      }
    }
  };
  const facts = useMemo(
    () =>
      document
        ? {
            words: document.text.match(/\S+/g)?.length ?? 0,
            lines: document.text.split("\n").length,
            headings: Array.from(document.text.matchAll(/^#{1,6}\s+(.+)$/gm))
              .slice(0, 100)
              .map((match) => ({ title: match[1], offset: match.index }))
          }
        : null,
    [document]
  );
  const matches = useMemo(() => {
    if (!search || !document) return [];
    const text = document.text.toLocaleLowerCase("ru");
    const found = new Set<number>();
    let part = 0,
      end = document.parts[0]?.length ?? 0;
    for (let at = text.indexOf(search); at >= 0; at = text.indexOf(search, at + search.length)) {
      while (at >= end && part < document.parts.length - 1)
        end += document.parts[++part]?.length ?? 0;
      found.add(part);
    }
    return [...found];
  }, [document, search]);
  const part = document?.parts[index] ?? "";
  const download = () => {
    if (!document) return;
    const url = URL.createObjectURL(
      new Blob([document.text], { type: "text/plain;charset=utf-8" })
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.name}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.icon}>
          <Icon name="files" />
        </span>
        <div>
          <p>Cosmora Studio</p>
          <h2>Анализ крупных файлов</h2>
          <p>Документы, данные и код — в одном рабочем окне.</p>
        </div>
      </header>
      <section className={styles.upload} aria-label="Загрузка документа">
        <input
          ref={input}
          type="file"
          hidden
          aria-label="Крупный документ"
          accept={[...CHAT_TEXT_EXTENSIONS, "pdf", "docx"]
            .map((extension) => `.${extension}`)
            .join(",")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void load(file);
          }}
        />
        <button type="button" onClick={() => input.current?.click()}>
          <Icon name="paperclip" />
          {document ? "Выбрать другой файл" : "Выбрать файл"}
        </button>
        <p>PDF, DOCX, текст и код · до 20 МБ</p>
        <p>
          <small>До 500 страниц PDF и 2 миллионов символов текста.</small>
        </p>
        <small>Файл читается в браузере. В чат передаётся только выбранная часть.</small>
        {reading && (
          <div className={styles.reading}>
            <span role="status">{progress}</span>
            <button
              type="button"
              onClick={() => {
                operation.current?.abort();
                setReading(false);
                setProgress("");
              }}
            >
              Отменить чтение
            </button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      {document && facts && (
        <>
          <div className={styles.documentTitle}>
            <h3>{document.name}</h3>
            <button type="button" onClick={download}>
              <Icon name="download" />
              Скачать текст
            </button>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Размер</dt>
              <dd>
                {(document.bytes / 1_000_000).toLocaleString("ru", { maximumFractionDigits: 2 })} МБ
              </dd>
            </div>
            <div>
              <dt>Символы</dt>
              <dd>{document.text.length.toLocaleString("ru")}</dd>
            </div>
            <div>
              <dt>Слова</dt>
              <dd>{facts.words.toLocaleString("ru")}</dd>
            </div>
            <div>
              <dt>Строки / части</dt>
              <dd>
                {facts.lines.toLocaleString("ru")} / {document.parts.length}
              </dd>
            </div>
          </dl>
          <div className={styles.layout}>
            <aside className={styles.panel}>
              <label htmlFor="document-search">Поиск по файлу</label>
              <input
                id="document-search"
                value={query}
                maxLength={160}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти слово или фразу…"
              />
              {search && (
                <>
                  <p role="status">Найдено частей: {matches.length}</p>
                  <div className={styles.matchList}>
                    {matches.slice(0, 50).map((part) => {
                      const text = document.parts[part] ?? "";
                      const at = text.toLocaleLowerCase("ru").indexOf(search);
                      return (
                        <button key={part} type="button" onClick={() => setIndex(part)}>
                          Часть {part + 1}
                          <small>{text.slice(Math.max(0, at - 35), at + 100)}</small>
                        </button>
                      );
                    })}
                  </div>
                  {matches.length > 50 && <small>Показаны первые 50. Уточните запрос.</small>}
                </>
              )}
              {facts.headings.length > 0 && (
                <>
                  <h3>Разделы документа</h3>
                  <div className={styles.matchList}>
                    {facts.headings.map((heading, i) => (
                      <button
                        type="button"
                        key={i}
                        onClick={() => {
                          let offset = 0;
                          const part = document.parts.findIndex((text) => {
                            offset += text.length;
                            return offset > heading.offset;
                          });
                          setIndex(Math.max(0, part));
                        }}
                      >
                        {heading.title}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </aside>
            <section className={styles.panel} aria-label="Содержимое документа">
              <div className={styles.partNav}>
                <button
                  type="button"
                  aria-label="Предыдущая часть"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  ←
                </button>
                <label>
                  Часть{" "}
                  <select
                    aria-label="Часть документа"
                    value={index}
                    onChange={(event) => setIndex(Number(event.target.value))}
                  >
                    {document.parts.map((_, i) => (
                      <option value={i} key={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>{" "}
                  из {document.parts.length}
                </label>
                <button
                  type="button"
                  aria-label="Следующая часть"
                  disabled={index === document.parts.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  →
                </button>
              </div>
              <pre className={styles.preview}>{part}</pre>
              <label htmlFor="document-question">Что разобрать?</label>
              <textarea
                id="document-question"
                value={question}
                maxLength={2_000}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button
                className={styles.primary}
                type="button"
                disabled={!question.trim()}
                onClick={() =>
                  onCompose(
                    `Разбери часть ${index + 1} из ${document.parts.length} файла «${document.name}». Это фрагмент, а не весь документ. Не делай выводов о непрочитанных частях.\n\n${question.trim()}`,
                    [{ name: `document-part-${index + 1}.txt`, content: part }]
                  )
                }
              >
                Разобрать эту часть в чате <Icon name="arrow" />
              </button>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
