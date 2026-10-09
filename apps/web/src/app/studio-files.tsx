"use client";
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { CHAT_TEXT_EXTENSIONS, type ChatAttachment } from "@cosmora/contracts/chat-attachments";
import { decodeStudioDocument } from "./decode-chat-attachment";
import {
  csvEmptyCells,
  numericStats,
  parseCsv,
  serializeCsvSelection,
  type CsvTable
} from "./studio-csv";
import { WorkspaceIcon as Icon } from "./workspace-icons";
import styles from "./studio-files.module.css";
import { StudioDocumentLibrary } from "./studio-files-library";

type DocumentState = {
  name: string;
  bytes: number;
  text: string;
  parts: string[];
  csv: CsvTable | null;
};
type SearchMatch = {
  start: number;
  end: number;
  part: number;
  endPart: number;
  partOffset: number;
};

// Each part fits the existing chat attachment budget and never splits a surrogate pair.
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

function foldWithOffsets(value: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset)!;
    let source = String.fromCodePoint(codePoint);
    let next = offset + source.length;
    while (next < value.length) {
      const following = String.fromCodePoint(value.codePointAt(next)!);
      if (!/\p{M}/u.test(following)) break;
      source += following;
      next += following.length;
    }
    const normalized = source.normalize("NFKC").toLocaleLowerCase("ru");
    folded += normalized;
    for (let i = 0; i < normalized.length; i++) {
      starts.push(offset);
      ends.push(next);
    }
    offset = next;
  }
  return { folded, starts, ends };
}

function findMatches(text: string, parts: readonly string[], query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const haystack = foldWithOffsets(text);
  const needle = foldWithOffsets(query.trim()).folded;
  if (!needle) return [];
  const partStarts: number[] = [];
  let total = 0;
  for (const part of parts) {
    partStarts.push(total);
    total += part.length;
  }
  const matches: SearchMatch[] = [];
  for (
    let at = haystack.folded.indexOf(needle);
    at >= 0 && matches.length < 1_001;
    at = haystack.folded.indexOf(needle, at + Math.max(1, needle.length))
  ) {
    const start = haystack.starts[at] ?? 0;
    const end = haystack.ends[at + needle.length - 1] ?? start;
    let part = 0;
    while (part + 1 < partStarts.length && partStarts[part + 1]! <= start) part++;
    let endPart = part;
    const lastOffset = Math.max(start, end - 1);
    while (endPart + 1 < partStarts.length && partStarts[endPart + 1]! <= lastOffset) endPart++;
    matches.push({ start, end, part, endPart, partOffset: start - (partStarts[part] ?? 0) });
  }
  return matches;
}

function HighlightedPart({
  text,
  partStart,
  matches,
  activeStart
}: {
  text: string;
  partStart: number;
  matches: readonly SearchMatch[];
  activeStart?: number | undefined;
}) {
  const ranges = matches
    .map((match) => ({
      globalStart: match.start,
      start: Math.max(0, match.start - partStart),
      end: Math.min(text.length, match.end - partStart)
    }))
    .filter((range) => range.end > 0 && range.start < text.length)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return <>{text}</>;
  const output: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    const start = Math.max(cursor, range.start);
    if (start > cursor)
      output.push(<Fragment key={`t-${index}`}>{text.slice(cursor, start)}</Fragment>);
    if (range.end > start)
      output.push(
        <mark
          id={range.globalStart === activeStart ? "studio-active-search-match" : undefined}
          className={range.globalStart === activeStart ? styles.activeMatch : undefined}
          key={`m-${index}`}
        >
          {text.slice(start, range.end)}
        </mark>
      );
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < text.length) output.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{output}</>;
}

export function StudioFiles({
  onCompose,
  projectId
}: {
  onCompose: (prompt: string, files?: ChatAttachment[]) => void;
  projectId: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const operationId = useRef(0);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [activeMatch, setActiveMatch] = useState(0);
  const [selectedParts, setSelectedParts] = useState<number[]>([]);
  const [question, setQuestion] = useState(
    "Выдели главные мысли, важные факты и вопросы, требующие проверки."
  );
  const [csvFilter, setCsvFilter] = useState("");
  const deferredCsvFilter = useDeferredValue(
    csvFilter.trim().normalize("NFKC").toLocaleLowerCase("ru")
  );
  const [csvColumns, setCsvColumns] = useState<number[]>([]);
  const [numericColumn, setNumericColumn] = useState(0);

  useEffect(() => () => operation.current?.abort(), []);

  const load = async (file: File) => {
    operation.current?.abort();
    const controller = new AbortController();
    const id = ++operationId.current;
    operation.current = controller;
    setReading(true);
    setProgress("Читаю файл…");
    setError(null);
    setDocument(null);
    setQuery("");
    setIndex(0);
    setSelectedParts([]);
    setCsvFilter("");
    try {
      const text = await decodeStudioDocument(file, controller.signal, (current, total, unit) => {
        if (controller.signal.aborted || operationId.current !== id) return;
        setProgress(
          unit === "page"
            ? `Страница ${current} из ${total}`
            : `Читаю файл: ${Math.min(100, Math.round((current / Math.max(1, total)) * 100))}%`
        );
      });
      controller.signal.throwIfAborted();
      if (operationId.current !== id) return;
      let csv: CsvTable | null = null;
      if (/\.csv$/i.test(file.name)) csv = parseCsv(text);
      const parts = splitText(text);
      setDocument({ name: file.name, bytes: file.size, text, parts, csv });
      if (csv) {
        setCsvColumns(csv.headers.map((_, column) => column));
        setNumericColumn(0);
      }
    } catch (cause) {
      if (!controller.signal.aborted && operationId.current === id)
        setError(cause instanceof Error ? cause.message : "Не удалось прочитать файл.");
    } finally {
      if (operation.current === controller && operationId.current === id) {
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
  const allMatches = useMemo(
    () => (document ? findMatches(document.text, document.parts, search) : []),
    [document, search]
  );
  const searchCapped = allMatches.length > 1_000;
  const matches = useMemo(() => allMatches.slice(0, 1_000), [allMatches]);
  useEffect(() => setActiveMatch(0), [search]);
  const part = document?.parts[index] ?? "";
  const partStart = useMemo(
    () =>
      document ? document.parts.slice(0, index).reduce((sum, value) => sum + value.length, 0) : 0,
    [document, index]
  );

  const csvRows = useMemo(() => {
    if (!document?.csv) return [] as number[];
    if (!deferredCsvFilter) return document.csv.rows.map((_, row) => row);
    return document.csv.rows.flatMap((row, rowIndex) =>
      csvColumns.some((column) =>
        (row[column] ?? "").normalize("NFKC").toLocaleLowerCase("ru").includes(deferredCsvFilter)
      )
        ? [rowIndex]
        : []
    );
  }, [document, deferredCsvFilter, csvColumns]);
  const csvStats = useMemo(
    () => (document?.csv ? numericStats(document.csv.rows, numericColumn, 100_000, csvRows) : null),
    [document, numericColumn, csvRows]
  );

  const goToMatch = (matchIndex: number) => {
    const match = matches[matchIndex];
    if (!match) return;
    setActiveMatch(matchIndex);
    setIndex(match.part);
    window.setTimeout(
      () =>
        window.document
          .getElementById("studio-active-search-match")
          ?.scrollIntoView({ block: "center" }),
      0
    );
  };

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

  const composeParts = () => {
    if (!document || !question.trim()) return;
    const selected = (selectedParts.length ? selectedParts : [index]).sort((a, b) => a - b);
    const maxCharacters = 7_000;
    const chunks: string[] = [];
    let used = 0;
    const included: number[] = [];
    for (const partIndex of selected) {
      const value = document.parts[partIndex] ?? "";
      const prefix = `--- Часть ${partIndex + 1} из ${document.parts.length} ---\n`;
      if (used + prefix.length + value.length > maxCharacters) break;
      chunks.push(prefix + value);
      used += prefix.length + value.length + 1;
      included.push(partIndex);
    }
    if (!included.length) return;
    onCompose(
      `Разбери выбранные части ${included.map((value) => value + 1).join(", ")} из ${document.parts.length} файла «${document.name}». Передано ${included.length} из ${selected.length} выбранных частей (${used.toLocaleString("ru")} символов). Это не весь документ; не делай выводов о непрочитанных частях.\n\n${question.trim()}`,
      [
        {
          name: selectedParts.length ? "document-selection.txt" : `document-part-${index + 1}.txt`,
          content: chunks.join("\n")
        }
      ]
    );
  };

  const composeCsv = () => {
    if (!document?.csv || !question.trim() || !csvColumns.length) return;
    setError(null);
    const material = serializeCsvSelection(document.csv, csvRows, csvColumns);
    if (material.blocked === "header") {
      setError(
        "Выбранные заголовки CSV не помещаются во вложение для чата. Выберите меньше столбцов."
      );
      return;
    }
    if (material.blocked === "row" || !material.includedRows) {
      setError(
        "Первая подходящая строка CSV не помещается во вложение для чата. Выберите меньше столбцов или сузьте фильтр."
      );
      return;
    }
    onCompose(
      `Разбери локально отфильтрованную выборку CSV «${document.name}». Передано ${material.includedRows} из ${csvRows.length} строк текущего фильтра и ${csvColumns.length} из ${document.csv.headers.length} столбцов${material.truncated ? "; выборка дополнительно ограничена размером вложения" : ""}. Всего в исходном CSV ${document.csv.rows.length} записей. Не выдавай эту выборку за анализ всех данных.\n\n${question.trim()}`,
      [{ name: "csv-selection.csv", content: material.content }]
    );
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.icon}>
          <Icon name="files" />
        </span>
        <div>
          <p>Kosmora Studio</p>
          <h2>Анализ крупных файлов</h2>
          <p>Документы, данные и код — локально в одном рабочем окне.</p>
        </div>
      </header>
      <StudioDocumentLibrary projectId={projectId} onCompose={onCompose} />
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
        <p>PDF, DOCX, CSV, текст и код · до 20 МБ</p>
        <p>
          <small>
            До 500 страниц PDF, 8 МБ DOCX XML и 2 миллионов символов текста. Без скрытого обрезания.
          </small>
        </p>
        <small>
          Файл обрабатывается локально. В чат попадёт только подготовленная вами выборка — без
          автоматической отправки.
        </small>
        {reading && (
          <div className={styles.reading}>
            <span role="status">{progress}</span>
            <button
              type="button"
              onClick={() => {
                operationId.current++;
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
          {document.csv ? (
            <CsvWorkspace
              table={document.csv}
              bytes={document.bytes}
              filter={csvFilter}
              setFilter={setCsvFilter}
              columns={csvColumns}
              setColumns={setCsvColumns}
              rowIndexes={csvRows}
              numericColumn={numericColumn}
              setNumericColumn={setNumericColumn}
              stats={csvStats!}
              question={question}
              setQuestion={setQuestion}
              onCompose={composeCsv}
            />
          ) : (
            <>
              <dl className={styles.stats}>
                <div>
                  <dt>Размер</dt>
                  <dd>
                    {(document.bytes / 1_000_000).toLocaleString("ru", {
                      maximumFractionDigits: 2
                    })}{" "}
                    МБ
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
                  {search.trim() && (
                    <>
                      <p role="status">
                        Найдено совпадений: {matches.length}
                        {searchCapped ? "+" : ""}
                      </p>
                      {matches.length > 0 && (
                        <div className={styles.searchNav}>
                          <button
                            type="button"
                            aria-label="Предыдущее совпадение"
                            onClick={() =>
                              goToMatch((activeMatch - 1 + matches.length) % matches.length)
                            }
                          >
                            ←
                          </button>
                          <span>
                            {activeMatch + 1} / {matches.length}
                          </span>
                          <button
                            type="button"
                            aria-label="Следующее совпадение"
                            onClick={() => goToMatch((activeMatch + 1) % matches.length)}
                          >
                            →
                          </button>
                        </div>
                      )}
                      <div className={styles.matchList}>
                        {matches.slice(0, 50).map((match, matchIndex) => (
                          <button
                            key={`${match.start}-${matchIndex}`}
                            type="button"
                            onClick={() => goToMatch(matchIndex)}
                          >
                            {match.endPart === match.part
                              ? `Часть ${match.part + 1}`
                              : `Части ${match.part + 1}–${match.endPart + 1}`}
                            <small>
                              {document.text
                                .slice(
                                  Math.max(0, match.start - 35),
                                  Math.min(document.text.length, match.end + 80)
                                )
                                .replace(/\s+/g, " ")}
                            </small>
                          </button>
                        ))}
                      </div>
                      {matches.length > 50 && (
                        <small>
                          Показаны первые 50 совпадений. Стрелки переходят по всем найденным (до
                          1000).
                        </small>
                      )}
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
                              const target = document.parts.findIndex((text) => {
                                offset += text.length;
                                return offset > heading.offset;
                              });
                              setIndex(Math.max(0, target));
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
                  <label className={styles.selectionToggle}>
                    <input
                      type="checkbox"
                      checked={selectedParts.includes(index)}
                      onChange={(event) =>
                        setSelectedParts((current) =>
                          event.target.checked
                            ? [...new Set([...current, index])]
                            : current.filter((value) => value !== index)
                        )
                      }
                    />{" "}
                    Выбрать эту часть для материала ({selectedParts.length} выбрано)
                  </label>
                  <pre id="studio-document-preview" className={styles.preview}>
                    <HighlightedPart
                      text={part}
                      partStart={partStart}
                      matches={matches}
                      activeStart={matches[activeMatch]?.start}
                    />
                  </pre>
                  <label htmlFor="document-question">Что разобрать?</label>
                  <textarea
                    id="document-question"
                    value={question}
                    maxLength={2_000}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                  <small className={styles.coverage}>
                    Будет подготовлено не более 7 000 символов из {selectedParts.length || 1}{" "}
                    выбранных частей; отправка модели не запускается.
                  </small>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={!question.trim()}
                    onClick={composeParts}
                  >
                    {selectedParts.length
                      ? "Подготовить выбранное в чате"
                      : "Разобрать эту часть в чате"}{" "}
                    <Icon name="arrow" />
                  </button>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CsvWorkspace({
  table,
  bytes,
  filter,
  setFilter,
  columns,
  setColumns,
  rowIndexes,
  numericColumn,
  setNumericColumn,
  stats,
  question,
  setQuestion,
  onCompose
}: {
  table: CsvTable;
  bytes: number;
  filter: string;
  setFilter: (value: string) => void;
  columns: number[];
  setColumns: Dispatch<SetStateAction<number[]>>;
  rowIndexes: number[];
  numericColumn: number;
  setNumericColumn: (value: number) => void;
  stats: ReturnType<typeof numericStats>;
  question: string;
  setQuestion: (value: string) => void;
  onCompose: () => void;
}) {
  const empty = useMemo(() => csvEmptyCells(table.rows), [table]);
  const previewRows = rowIndexes.slice(0, 200);
  const delimiterName = table.delimiter === "\t" ? "табуляция" : table.delimiter;
  return (
    <div className={styles.csvWorkspace}>
      <dl className={styles.stats}>
        <div>
          <dt>Размер</dt>
          <dd>{(bytes / 1_000_000).toLocaleString("ru", { maximumFractionDigits: 2 })} МБ</dd>
        </div>
        <div>
          <dt>Записи</dt>
          <dd>{table.rows.length.toLocaleString("ru")}</dd>
        </div>
        <div>
          <dt>Пустые значения</dt>
          <dd>{empty.toLocaleString("ru")}</dd>
        </div>
        <div>
          <dt>Разделитель</dt>
          <dd>{delimiterName}</dd>
        </div>
      </dl>
      <section className={styles.panel} aria-label="Настройки CSV">
        <label htmlFor="csv-filter">Поиск / фильтр по выбранным столбцам</label>
        <input
          id="csv-filter"
          value={filter}
          maxLength={160}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Найти значение…"
        />
        <p role="status">
          После фильтра: {rowIndexes.length.toLocaleString("ru")} из{" "}
          {table.rows.length.toLocaleString("ru")} записей
        </p>
        <div className={styles.csvControls}>
          <fieldset>
            <legend>Столбцы</legend>
            <div className={styles.columnList}>
              {table.headers.map((header, column) => (
                <label key={column}>
                  <input
                    type="checkbox"
                    checked={columns.includes(column)}
                    onChange={(event) =>
                      setColumns((current) =>
                        event.target.checked
                          ? [...current, column].sort((a, b) => a - b)
                          : current.filter((value) => value !== column)
                      )
                    }
                  />{" "}
                  {header}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="numeric-column">Числовая статистика</label>
            <select
              id="numeric-column"
              value={numericColumn}
              onChange={(event) => setNumericColumn(Number(event.target.value))}
            >
              {table.headers.map((header, column) => (
                <option key={column} value={column}>
                  {header}
                </option>
              ))}
            </select>
            <dl className={styles.numericStats}>
              <div>
                <dt>Чисел</dt>
                <dd>{stats.count.toLocaleString("ru")}</dd>
              </div>
              <div>
                <dt>Пустых</dt>
                <dd>{stats.empty.toLocaleString("ru")}</dd>
              </div>
              <div>
                <dt>Нечисловых</dt>
                <dd>{stats.invalid.toLocaleString("ru")}</dd>
              </div>
              <div>
                <dt>Мин.</dt>
                <dd>{stats.min === null ? "—" : stats.min.toLocaleString("ru")}</dd>
              </div>
              <div>
                <dt>Макс.</dt>
                <dd>{stats.max === null ? "—" : stats.max.toLocaleString("ru")}</dd>
              </div>
              <div>
                <dt>Среднее</dt>
                <dd>
                  {stats.mean === null
                    ? "—"
                    : stats.mean.toLocaleString("ru", { maximumFractionDigits: 4 })}
                </dd>
              </div>
            </dl>
            <small>
              Статистика текущей выборки: проверено {stats.scanned.toLocaleString("ru")} из{" "}
              {rowIndexes.length.toLocaleString("ru")} строк
              {stats.limited ? " (лимит 100 000 строк)" : ""}. Десятичная запятая поддерживается;
              неоднозначные разделители тысяч не угадываются.
            </small>
          </div>
        </div>
      </section>
      <section className={styles.panel} aria-label="Таблица CSV">
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                {columns.map((column) => (
                  <th key={column}>{table.headers[column]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((rowIndex) => (
                <tr key={rowIndex}>
                  <th>{rowIndex + 1}</th>
                  {columns.map((column) => (
                    <td key={column}>{table.rows[rowIndex]?.[column] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small>
          Показано: {previewRows.length} из {rowIndexes.length} строк текущего фильтра. Исходные
          данные не обрезаются.
        </small>
      </section>
      <section className={styles.panel}>
        <label htmlFor="csv-question">Что разобрать?</label>
        <textarea
          id="csv-question"
          value={question}
          maxLength={2_000}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <small className={styles.coverage}>
          В чат готовятся только выбранные столбцы и строки текущего фильтра, максимум 7 000
          символов, с явным покрытием. Автоматической отправки модели нет.
        </small>
        <button
          className={styles.primary}
          type="button"
          disabled={!question.trim() || !columns.length || !rowIndexes.length}
          onClick={onCompose}
        >
          Подготовить выборку в чате <Icon name="arrow" />
        </button>
      </section>
    </div>
  );
}
