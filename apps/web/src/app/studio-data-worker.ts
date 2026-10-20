/// <reference lib="webworker" />
import {
  DATA_LIMITS,
  initialDataSettings,
  loadDataCsv,
  parseDataWorkspace,
  queryData,
  validateDataTable,
  type DataSettings
} from "./studio-data-core";
import {
  SafeXlsxZip,
  inspectXlsx,
  importXlsxSheet,
  type XlsxIndex
} from "./studio-data-xlsx-import";
import type { CsvTable } from "./studio-csv";

type Message =
  | { id: number; kind: "csv"; buffer: ArrayBuffer; name: string }
  | { id: number; kind: "workspace"; buffer: ArrayBuffer }
  | { id: number; kind: "xlsx"; buffer: ArrayBuffer; name: string }
  | { id: number; kind: "xlsx-sheet"; sheetIndex: number; headerRow: number }
  | { id: number; kind: "restore"; table: CsvTable; name: string }
  | { id: number; kind: "query"; settings: DataSettings };
let table: CsvTable | null = null;
let xlsxZip: SafeXlsxZip | null = null;
let xlsxIndex: XlsxIndex | null = null;
let xlsxName = "";
const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async (event: MessageEvent<Message>) => {
  const req = event.data;
  try {
    if (req.kind === "xlsx") {
      // Worker lifetime is tied to the current file; terminate() revokes pending imports.
      xlsxZip = new SafeXlsxZip(req.buffer);
      xlsxIndex = inspectXlsx(xlsxZip);
      xlsxName = req.name;
      table = null;
      scope.postMessage({ id: req.id, kind: "xlsx-index", sheets: xlsxIndex.sheets });
      return;
    }
    if (req.kind === "xlsx-sheet") {
      if (!xlsxZip || !xlsxIndex) throw new Error("Сначала откройте файл XLSX.");
      scope.postMessage({
        id: req.id,
        kind: "progress",
        message: "Импортирую выбранный лист Excel…"
      });
      const loaded = importXlsxSheet(xlsxZip, xlsxIndex, req.sheetIndex, req.headerRow);
      validateDataTable(loaded.table);
      table = loaded.table;
      const selectedName = xlsxIndex.sheets[req.sheetIndex]!.name;
      xlsxZip = null;
      xlsxIndex = null;
      // Never transfer original workbook or unselected sheets to the UI/server.
      scope.postMessage({
        id: req.id,
        kind: "loaded",
        name: `${xlsxName} — ${selectedName}`,
        table,
        settings: initialDataSettings(table),
        warnings: loaded.warnings
      });
      return;
    }
    if (req.kind === "csv" || req.kind === "workspace") {
      xlsxZip = null;
      xlsxIndex = null;
      const limit = req.kind === "csv" ? DATA_LIMITS.csvBytes : DATA_LIMITS.workspaceBytes;
      if (req.buffer.byteLength > limit)
        throw new Error("Размер входного файла превышает установленный лимит.");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const text = decoder.decode(req.buffer);
      if (req.kind === "csv") {
        let passes = 0;
        const loaded = await loadDataCsv(text, () => {
          if (++passes % 8 === 0)
            scope.postMessage({ id: req.id, kind: "progress", message: "Проверяю CSV/TSV…" });
          return new Promise((resolve) => setTimeout(resolve, 0));
        });
        table = loaded;
        scope.postMessage({
          id: req.id,
          kind: "loaded",
          name: req.name,
          table,
          settings: initialDataSettings(table)
        });
      } else {
        const workspace = parseDataWorkspace(text);
        table = workspace.table;
        scope.postMessage({
          id: req.id,
          kind: "loaded",
          name: workspace.name,
          table,
          settings: workspace.settings
        });
      }
      return;
    }
    if (req.kind === "restore") {
      validateDataTable(req.table);
      table = req.table;
      scope.postMessage({ id: req.id, kind: "restored" });
      return;
    }
    if (!table) throw new Error("Сначала откройте таблицу.");
    const result = queryData(table, req.settings);
    scope.postMessage({ id: req.id, kind: "result", result });
  } catch (error) {
    scope.postMessage({
      id: req.id,
      kind: "error",
      message: error instanceof Error ? error.message : "Ошибка обработки таблицы."
    });
  }
};
