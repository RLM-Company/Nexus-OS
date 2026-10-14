"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatAttachment } from "@cosmora/contracts/chat-attachments";
import type { CsvTable } from "./studio-csv";
import {
  DATA_LIMITS,
  type DataChart,
  type DataFilter,
  type DataOperator,
  type DataResult,
  type DataSettings,
  type DataType
} from "./studio-data-core";
import {
  attachmentData,
  dataReport,
  dataSvg,
  exportData,
  exportWorkspace
} from "./studio-data-export";
import { StudioFiles } from "./studio-files";
import styles from "./studio-data-workbench.module.css";
import { ShiningText, SystemMessage } from "./ui/kosmora-controls";
import { WorkspaceIcon } from "./workspace-icons";

type Response =
  | { id: number; kind: "loaded"; name: string; table: CsvTable; settings: DataSettings }
  | { id: number; kind: "result"; result: DataResult }
  | { id: number; kind: "restored" }
  | { id: number; kind: "progress"; message: string }
  | { id: number; kind: "error"; message: string };
const textNumber = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("ru", { maximumFractionDigits: 5 });
const cleanFilename = (value: string) =>
  value.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 70) || "данные";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const element = document.createElement("a");
  element.href = url;
  element.download = name;
  element.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function StudioDataSurface({
  onCompose,
  projectId,
  onProjectCreated
}: {
  onCompose: (prompt: string, files?: ChatAttachment[]) => void;
  projectId: string | null;
  onProjectCreated?: (id: string) => void;
}) {
  const [tab, setTab] = useState<"data" | "documents">("documents");
  return (
    <div className={styles.surface}>
      <nav aria-label="Раздел файлов Studio" className={styles.tabs}>
        <button
          type="button"
          aria-current={tab === "data" ? "page" : undefined}
          onClick={() => setTab("data")}
        >
          Таблицы и диаграммы
        </button>
        <button
          type="button"
          aria-current={tab === "documents" ? "page" : undefined}
          onClick={() => setTab("documents")}
        >
          Документы и текст
        </button>
      </nav>
      {tab === "data" ? (
        <DataWorkbench onCompose={onCompose} />
      ) : (
        <StudioFiles
          onCompose={onCompose}
          projectId={projectId}
          {...(onProjectCreated ? { onProjectCreated } : {})}
        />
      )}
    </div>
  );
}

export function DataWorkbench({
  onCompose
}: {
  onCompose: (prompt: string, files?: ChatAttachment[]) => void;
}) {
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const nextId = useRef(0);
  const queryId = useRef(0);
  const exportRef = useRef<AbortController | null>(null);
  const [table, setTable] = useState<CsvTable | null>(null);
  const [settings, setSettings] = useState<DataSettings | null>(null);
  const [name, setName] = useState("");
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [question, setQuestion] = useState(
    "Сделай выводы по приложенной выборке данных. Укажи ограничения покрытия."
  );
  const [page, setPage] = useState(0);

  function stopAll() {
    generation.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    exportRef.current?.abort();
    exportRef.current = null;
  }
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      exportRef.current?.abort();
    },
    []
  );

  function makeWorker() {
    const worker = new Worker(new URL("./studio-data-worker.ts", import.meta.url), {
      type: "module"
    });
    const generationId = ++generation.current;
    workerRef.current = worker;
    worker.onmessage = (message: MessageEvent<Response>) => {
      if (generation.current !== generationId) return;
      const response = message.data;
      if (response.kind === "progress" && response.id === nextId.current) {
        setProgress(response.message);
        return;
      }
      if (response.kind === "error") {
        if (response.id !== queryId.current && response.id !== nextId.current) return;
        setBusy(false);
        setError(response.message);
        setProgress("");
        return;
      }
      if (response.kind === "loaded") {
        setName(response.name);
        setTable(response.table);
        setSettings(response.settings);
        setResult(null);
        setBusy(false);
        setProgress("");
        setPage(0);
      } else if (response.kind === "result" && response.id === queryId.current) {
        setResult(response.result);
        setBusy(false);
        setProgress("");
        setPage(0);
      }
    };
    worker.onerror = () => {
      if (generation.current !== generationId) return;
      setBusy(false);
      setProgress("");
      setError("Рабочий поток остановлен из-за ошибки. Попробуйте повторить.");
      worker.terminate();
      workerRef.current = null;
    };
    return worker;
  }

  async function loadFile(file: File) {
    stopAll();
    setBusy(false);
    setExporting(false);
    setProgress("");
    setError("");
    setNotice("");
    setTable(null);
    setSettings(null);
    setResult(null);
    const workspace = file.name.toLowerCase().endsWith(".json");
    if (!(workspace || /\.(csv|tsv)$/i.test(file.name))) {
      setError("Поддерживаются только CSV, TSV и файл workspace JSON.");
      return;
    }
    if (file.size > (workspace ? DATA_LIMITS.workspaceBytes : DATA_LIMITS.csvBytes)) {
      setError(`Файл превышает ${workspace ? "16" : "8"} МБ.`);
      return;
    }
    let loadGeneration = generation.current;
    setBusy(true);
    setProgress("Читаю файл и проверяю границы…");
    try {
      const buffer = await file.arrayBuffer();
      if (generation.current !== loadGeneration) return;
      const worker = makeWorker(),
        id = ++nextId.current;
      loadGeneration = generation.current;
      worker.postMessage(
        workspace
          ? { id, kind: "workspace", buffer }
          : { id, kind: "csv", buffer, name: file.name },
        [buffer]
      );
    } catch (reason) {
      if (generation.current === loadGeneration) {
        setBusy(false);
        setProgress("");
        setError(reason instanceof Error ? reason.message : "Ошибка чтения файла.");
      }
    }
  }

  useEffect(() => {
    if (!table || !settings) return;
    setResult(null);
    setError("");
    setBusy(true);
    setProgress("Обновляю таблицу и статистику…");
    let worker = workerRef.current;
    if (!worker) {
      worker = makeWorker();
      worker.postMessage({ id: ++nextId.current, kind: "restore", table, name });
    }
    const id = ++nextId.current;
    queryId.current = id;
    worker.postMessage({ id, kind: "query", settings });
    // Settings are immutable; queries supersede stale results by id.
  }, [table, settings]);

  function update(next: (current: DataSettings) => DataSettings) {
    // Fence old query responses and abort an export of a now-stale selection.
    queryId.current = ++nextId.current;
    exportRef.current?.abort();
    exportRef.current = null;
    setExporting(false);
    setProgress("");
    setResult(null);
    setBusy(true);
    setSettings((current) => (current ? next(current) : current));
  }
  function typeColumn(column: number, value: DataType) {
    update((s) => ({
      ...s,
      types: s.types.map((t, i) => (i === column ? value : t)),
      filters: s.filters.filter(
        (f) =>
          !(f.column === column && ["greater", "less"].includes(f.operator) && value !== "number")
      )
    }));
  }
  function setFilter(index: number, patch: Partial<DataFilter>) {
    update((s) => ({
      ...s,
      filters: s.filters.map((f, i) => (i === index ? { ...f, ...patch } : f))
    }));
  }
  function cancel() {
    stopAll();
    setBusy(false);
    setExporting(false);
    setProgress("");
    setResult(null);
    setError("Операция отменена. Измените настройки, чтобы пересчитать результат.");
  }

  async function exportFile(kind: "csv" | "json") {
    if (!table || !settings || !result || exporting || busy) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExporting(true);
    setError("");
    setProgress("Формирую полный файл…");
    try {
      const blob = await exportData(
        table,
        result.indexes,
        settings,
        kind,
        controller.signal,
        (value) => {
          if (!controller.signal.aborted)
            setProgress(`Выгружено ${value} из ${result.indexes.length} строк`);
        }
      );
      controller.signal.throwIfAborted();
      download(blob, `${cleanFilename(name)}-filtered.${kind}`);
      setNotice(`Экспортировано ${result.indexes.length} полных строк (${blob.size} байт).`);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Ошибка экспорта.");
    } finally {
      if (exportRef.current === controller) {
        exportRef.current = null;
        setExporting(false);
        setProgress("");
      }
    }
  }
  async function saveWorkspace() {
    if (!table || !settings || busy || exporting) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExporting(true);
    setError("");
    setProgress("Сохраняю workspace без усечения…");
    try {
      const blob = await exportWorkspace(name, table, settings, controller.signal, (value) => {
        if (!controller.signal.aborted)
          setProgress(`Сохранено ${value} из ${table.rows.length} строк`);
      });
      controller.signal.throwIfAborted();
      download(blob, `${cleanFilename(name)}.workspace.json`);
      setNotice("Workspace сохранён локально по вашему действию.");
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Не удалось сохранить workspace.");
    } finally {
      if (exportRef.current === controller) {
        exportRef.current = null;
        setExporting(false);
        setProgress("");
      }
    }
  }
  function attach() {
    if (!table || !settings || !result || !question.trim() || busy) return;
    try {
      const attach = attachmentData(table, result.indexes, settings.columns);
      if (result.indexes.length && attach.includedRows === 0)
        throw new Error(
          "Ни одна полная строка не помещается во вложение. Выберите меньше столбцов."
        );
      onCompose(
        `Проанализируй приложенную выборку «${name}». Вложено ${attach.includedRows} из ${result.indexes.length} строк после фильтров, ` +
          `${settings.columns.length} столбцов, всего в файле ${table.rows.length} строк. ` +
          `includedRows=${attach.includedRows}; truncated=${attach.truncated}. ` +
          `Не выдавай ограниченную выборку за полные данные.\n\n${question.trim()}`,
        [{ name: "data-selection.csv", content: attach.content }]
      );
      setNotice(`Подготовлено ${attach.includedRows} из ${result.indexes.length} строк для чата.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать вложение.");
    }
  }
  const columns = table?.headers ?? [];
  const numericColumns =
    settings?.types.map((type, i) => (type === "number" ? i : -1)).filter((x) => x >= 0) ?? [];
  const preview = result?.indexes.slice(page * 100, (page + 1) * 100) ?? [];
  const chartReady =
    !!settings &&
    numericColumns.includes(settings.chart.x) &&
    numericColumns.includes(settings.chart.y) &&
    settings.columns.includes(settings.chart.x) &&
    settings.columns.includes(settings.chart.y);
  const chartText =
    result && settings && chartReady
      ? dataSvg(
          result.plot.points,
          `Kosmora · ${settings.chart.kind}`,
          columns[settings.chart.x]!,
          columns[settings.chart.y]!,
          settings.chart.kind
        )
      : null;
  return (
    <section className={styles.root} aria-label="Data Workbench">
      <header className={styles.header}>
        <span className={styles.icon}>
          <WorkspaceIcon name="files" />
        </span>
        <div>
          <h2>Таблицы и диаграммы</h2>
          <p>Фильтруйте данные, сравнивайте значения и сохраняйте результаты.</p>
        </div>
      </header>
      <div className={styles.box}>
        <label className={styles.fileLabel} htmlFor="data-file">
          Открыть таблицу или сохранённый проект
        </label>
        <input
          id="data-file"
          type="file"
          accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = "";
          }}
        />
        <small>
          CSV и TSV в UTF-8 до 8 МБ: 80 000 строк, 100 столбцов, 1 млн ячеек. Сохранённый проект —
          до 16 МБ; выгрузка — до 32 МБ.
        </small>
        {(busy || exporting) && (
          <button type="button" onClick={cancel}>
            Отменить обработку
          </button>
        )}
        {table && settings && !busy && !exporting && (
          <button type="button" onClick={() => update((s) => ({ ...s }))}>
            Пересчитать
          </button>
        )}

        {progress && (
          <p role="status">
            {busy || exporting ? <ShiningText>{progress}</ShiningText> : progress}
          </p>
        )}
        {error && <SystemMessage>{error}</SystemMessage>}
        {notice && <SystemMessage kind="success">{notice}</SystemMessage>}
      </div>
      {table && settings && (
        <>
          <div className={styles.summary}>
            <strong>{name}</strong> · {table.rows.length.toLocaleString("ru")} строк ·{" "}
            {columns.length} колонок · после фильтра:{" "}
            {result ? result.indexes.length.toLocaleString("ru") : "пересчёт"}
          </div>
          <div className={styles.box}>
            <h3>Столбцы и явные типы</h3>
            <p className={styles.muted}>
              По умолчанию все значения — текст. Идентификаторы остаются исходными строками; числа
              распознаются только после выбора типа.
            </p>
            <div className={styles.columns}>
              {columns.map((label, i) => (
                <div key={i} className={styles.column}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.columns.includes(i)}
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          columns: e.target.checked
                            ? [...s.columns, i].sort((a, b) => a - b)
                            : s.columns.length > 1
                              ? s.columns.filter((x) => x !== i)
                              : s.columns
                        }))
                      }
                    />{" "}
                    {i + 1}. {label}
                  </label>
                  <select
                    aria-label={`Тип столбца ${i + 1} ${label}`}
                    value={settings.types[i]}
                    onChange={(e) => typeColumn(i, e.target.value as DataType)}
                  >
                    <option value="text">Текст</option>
                    <option value="number">Число</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.box}>
            <h3>Фильтры и сортировка</h3>
            <div className={styles.filters}>
              {settings.filters.map((f, i) => (
                <div className={styles.filter} key={i}>
                  <select
                    aria-label={`Столбец фильтра ${i + 1}`}
                    value={f.column}
                    onChange={(e) =>
                      setFilter(i, { column: Number(e.target.value), operator: "contains" })
                    }
                  >
                    {columns.map((label, j) => (
                      <option key={j} value={j}>
                        {j + 1}. {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Условие фильтра ${i + 1}`}
                    value={f.operator}
                    onChange={(e) => setFilter(i, { operator: e.target.value as DataOperator })}
                  >
                    <option value="contains">Содержит</option>
                    <option value="equals">Равно</option>
                    {settings.types[f.column] === "number" && (
                      <>
                        <option value="greater">≥ число</option>
                        <option value="less">≤ число</option>
                      </>
                    )}
                    <option value="empty">Пусто</option>
                    <option value="nonempty">Не пусто</option>
                  </select>
                  {!["empty", "nonempty"].includes(f.operator) && (
                    <input
                      aria-label={`Значение фильтра ${i + 1}`}
                      value={f.value}
                      maxLength={200}
                      onChange={(e) => setFilter(i, { value: e.target.value })}
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Удалить фильтр ${i + 1}`}
                    onClick={() =>
                      update((s) => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }))
                    }
                  >
                    Убрать
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={settings.filters.length >= 8}
              onClick={() =>
                update((s) => ({
                  ...s,
                  filters: [...s.filters, { column: 0, operator: "contains", value: "" }]
                }))
              }
            >
              Добавить фильтр
            </button>
            <div className={styles.controls}>
              <label>
                Сортировать по{" "}
                <select
                  value={settings.sort?.column ?? ""}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sort:
                        e.target.value === ""
                          ? null
                          : {
                              column: Number(e.target.value),
                              direction: s.sort?.direction ?? "asc"
                            }
                    }))
                  }
                >
                  <option value="">По порядку файла</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Направление{" "}
                <select
                  disabled={!settings.sort}
                  value={settings.sort?.direction ?? "asc"}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sort: s.sort
                        ? { ...s.sort, direction: e.target.value as "asc" | "desc" }
                        : null
                    }))
                  }
                >
                  <option value="asc">По возрастанию</option>
                  <option value="desc">По убыванию</option>
                </select>
              </label>
            </div>
          </div>
          <div className={styles.box}>
            <h3>Статистика и группировка</h3>
            <div className={styles.controls}>
              <label>
                Числовая колонка{" "}
                <select
                  value={settings.measure}
                  onChange={(e) => update((s) => ({ ...s, measure: Number(e.target.value) }))}
                >
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {c}
                      {settings.types[i] === "number" ? " (число)" : " (текст)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Группировать по{" "}
                <select
                  value={settings.group ?? ""}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      group: e.target.value === "" ? null : Number(e.target.value)
                    }))
                  }
                >
                  <option value="">Без группировки</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {settings.types[settings.measure] !== "number" ? (
              <p role="status">Для числовой статистики укажите тип «Число» у выбранной колонки.</p>
            ) : (
              result && (
                <>
                  <dl className={styles.metrics}>
                    {(
                      [
                        "scanned",
                        "count",
                        "missing",
                        "invalid",
                        "sum",
                        "min",
                        "max",
                        "mean"
                      ] as const
                    ).map((key) => (
                      <div key={key}>
                        <dt>
                          {
                            {
                              scanned: "Проверено",
                              count: "Чисел",
                              missing: "Пропуски",
                              invalid: "Некорректные",
                              sum: "Сумма",
                              min: "Минимум",
                              max: "Максимум",
                              mean: "Среднее"
                            }[key]
                          }
                        </dt>
                        <dd>{textNumber(result.stats[key])}</dd>
                      </div>
                    ))}
                  </dl>
                  {settings.group !== null && (
                    <>
                      <p>
                        Групп: {result.groups.length} (максимум {DATA_LIMITS.groups}).
                      </p>
                      <div className={styles.tableWrap}>
                        <table>
                          <thead>
                            <tr>
                              <th>Группа</th>
                              <th>Чисел</th>
                              <th>Пустых</th>
                              <th>Ошибок</th>
                              <th>Сумма</th>
                              <th>Мин.</th>
                              <th>Макс.</th>
                              <th>Среднее</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.groups.slice(0, 40).map((g, i) => (
                              <tr key={i}>
                                <td>{g.key || "(пусто)"}</td>
                                {(
                                  [
                                    "count",
                                    "missing",
                                    "invalid",
                                    "sum",
                                    "min",
                                    "max",
                                    "mean"
                                  ] as const
                                ).map((key) => (
                                  <td key={key}>{textNumber(g.stats[key])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <small>
                        Показаны до 40 групп; отчёт включает все {result.groups.length}.
                      </small>
                    </>
                  )}
                </>
              )
            )}
          </div>
          <div className={styles.box}>
            <h3>Диаграмма</h3>
            <div className={styles.controls}>
              <label>
                Вид{" "}
                <select
                  value={settings.chart.kind}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      chart: { ...s.chart, kind: e.target.value as DataChart["kind"] }
                    }))
                  }
                >
                  <option value="bar">Столбчатая</option>
                  <option value="line">Линейная</option>
                  <option value="scatter">Точечная (scatter)</option>
                </select>
              </label>
              {(["x", "y"] as const).map((axis) => (
                <label key={axis}>
                  Ось {axis.toUpperCase()}{" "}
                  <select
                    value={
                      settings.columns.includes(settings.chart[axis]) &&
                      numericColumns.includes(settings.chart[axis])
                        ? settings.chart[axis]
                        : ""
                    }
                    onChange={(e) => {
                      if (e.target.value !== "")
                        update((s) => ({
                          ...s,
                          chart: { ...s.chart, [axis]: Number(e.target.value) }
                        }));
                    }}
                  >
                    <option value="">Выберите числовую колонку</option>
                    {settings.columns
                      .filter((col) => numericColumns.includes(col))
                      .map((i) => (
                        <option key={i} value={i}>
                          {i + 1}. {columns[i]}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            {!chartReady ? (
              <p role="status">
                Выберите две числовые колонки среди отмеченных и укажите оси X и Y.
              </p>
            ) : (
              chartText && (
                <>
                  <div
                    className={styles.chart}
                    role="img"
                    aria-label={`${settings.chart.kind}: ${columns[settings.chart.x]} по X, ${columns[settings.chart.y]} по Y`}
                    dangerouslySetInnerHTML={{ __html: chartText.replace(/^<\?xml[^>]*>\s*/u, "") }}
                  />
                  <p>
                    Числовых пар: {result?.plot.valid}; пропусков: {result?.plot.missing}; ошибок:{" "}
                    {result?.plot.invalid}; точек на графике: {result?.plot.points.length}
                    {result?.plot.sampled
                      ? " (визуальная выборка, полный экспорт не ограничен)"
                      : ""}
                    . Линия упорядочена по X.
                  </p>
                  <button
                    type="button"
                    disabled={busy || exporting}
                    onClick={() =>
                      download(
                        new Blob([chartText], { type: "image/svg+xml" }),
                        `${cleanFilename(name)}-chart.svg`
                      )
                    }
                  >
                    Скачать SVG
                  </button>
                </>
              )
            )}
          </div>
          <div className={styles.box}>
            <h3>Таблица</h3>
            <p>
              {result
                ? `Показано ${preview.length} из ${result.indexes.length} строк`
                : "Идёт пересчёт…"}
              . Просмотр постраничный, выгрузка всегда полная.
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Строка</th>
                    {settings.columns.map((col) => (
                      <th key={col} scope="col">
                        {col + 1}. {columns[col]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((idx) => (
                    <tr key={idx}>
                      <th scope="row">{idx + 1}</th>
                      {settings.columns.map((col) => (
                        <td key={col}>{table.rows[idx]?.[col]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.controls}>
              <button type="button" disabled={!page || busy} onClick={() => setPage((p) => p - 1)}>
                ← Назад
              </button>
              <span>
                Страница {page + 1} из {Math.max(1, Math.ceil((result?.indexes.length ?? 0) / 100))}
              </span>
              <button
                type="button"
                disabled={busy || (page + 1) * 100 >= (result?.indexes.length ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее →
              </button>
            </div>
          </div>
          <div className={styles.box}>
            <h3>Полный экспорт и сохранение</h3>
            <p>
              CSV/JSON (не более 32 МБ) выгружают все строки фильтра и все выбранные столбцы, без
              ограничения страниц. Заголовки-дубликаты сохраняются в JSON через индексы.
            </p>
            <div className={styles.controls}>
              <button
                type="button"
                disabled={!result || busy || exporting}
                onClick={() => void exportFile("csv")}
              >
                Выгрузить CSV
              </button>
              <button
                type="button"
                disabled={!result || busy || exporting}
                onClick={() => void exportFile("json")}
              >
                Выгрузить JSON
              </button>
              <button
                type="button"
                disabled={!result || busy || exporting}
                onClick={() =>
                  download(
                    new Blob([dataReport(name, table, settings, result!)], {
                      type: "text/markdown;charset=utf-8"
                    }),
                    `${cleanFilename(name)}-report.md`
                  )
                }
              >
                Скачать отчёт
              </button>
              <button
                type="button"
                disabled={busy || exporting}
                onClick={() => void saveWorkspace()}
              >
                Сохранить workspace JSON
              </button>
            </div>
            <p className={styles.muted}>
              Сохраните проект вместе с таблицей и настройками, чтобы продолжить позже. Откройте
              сохранённый JSON через выбор файла выше.
            </p>
          </div>
          <div className={styles.box}>
            <h3>В чат через скрепку</h3>
            <label htmlFor="data-question">Задача для чата</label>
            <textarea
              id="data-question"
              maxLength={1900}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <p>
              В чат попадёт выборка целых строк до 8 000 символов. Её размер и ограничения будут
              указаны в сообщении.
            </p>
            <button
              type="button"
              disabled={!result || busy || exporting || !question.trim()}
              onClick={attach}
            >
              Подготовить CSV во вложении
            </button>
          </div>
        </>
      )}
    </section>
  );
}
