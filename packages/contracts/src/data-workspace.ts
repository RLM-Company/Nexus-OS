export type CsvTable = { delimiter: string; headers: string[]; rows: string[][] };
export const DATA_LIMITS = {
  csvBytes: 8_000_000,
  workspaceBytes: 16_000_000,
  exportBytes: 32_000_000,
  rows: 80_000,
  columns: 100,
  cells: 1_000_000,
  groups: 300,
  plotPoints: 600,
  attachmentBytes: 24_000,
  attachmentCharacters: 8_000
} as const;
export type DataType = "text" | "number";
export type DataOperator = "contains" | "equals" | "greater" | "less" | "empty" | "nonempty";
export type DataFilter = { column: number; operator: DataOperator; value: string };
export type DataSort = { column: number; direction: "asc" | "desc" } | null;
export type DataChart = { kind: "bar" | "line" | "scatter"; x: number; y: number };
export type DataSettings = {
  types: DataType[];
  columns: number[];
  filters: DataFilter[];
  sort: DataSort;
  group: number | null;
  measure: number;
  chart: DataChart;
};
export type DataWorkspace = {
  schema: "kosmora.studio.data";
  version: 1;
  name: string;
  table: CsvTable;
  settings: DataSettings;
};
export const DATA_SERVER_BYTES = 2 * 1024 * 1024;
export const DATA_SERVER_HISTORY_BYTES = 32 * 1024 * 1024;
export const DATA_SERVER_REVISIONS = 20;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const int = (v: unknown, n: number) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

export function validateDataTable(table: unknown): asserts table is CsvTable {
  if (
    !isRecord(table) ||
    typeof table.delimiter !== "string" ||
    ![",", ";", "\t", "|"].includes(table.delimiter) ||
    !Array.isArray(table.headers) ||
    !Array.isArray(table.rows) ||
    !table.headers.length ||
    table.headers.length > DATA_LIMITS.columns ||
    table.rows.length > DATA_LIMITS.rows ||
    table.headers.length * (table.rows.length + 1) > DATA_LIMITS.cells
  )
    throw new Error("Таблица превышает ограничения размера или имеет неверную структуру.");
  if (!table.headers.every((h) => typeof h === "string" && h.length <= 100_000))
    throw new Error("Некорректные заголовки таблицы.");
  for (const row of table.rows) {
    if (
      !Array.isArray(row) ||
      row.length !== table.headers.length ||
      !row.every((cell) => typeof cell === "string" && cell.length <= DATA_LIMITS.csvBytes)
    )
      throw new Error("Некорректная строка таблицы.");
  }
}

export function validateDataSettings(value: unknown, width: number): asserts value is DataSettings {
  if (
    !isRecord(value) ||
    !Array.isArray(value.types) ||
    value.types.length !== width ||
    !value.types.every((v) => v === "number" || v === "text") ||
    !Array.isArray(value.columns) ||
    !value.columns.length ||
    value.columns.length > width ||
    !value.columns.every((v) => int(v, width)) ||
    new Set(value.columns).size !== value.columns.length ||
    !Array.isArray(value.filters) ||
    value.filters.length > 8
  )
    throw new Error("Недопустимые настройки колонок.");
  for (const f of value.filters) {
    if (
      !isRecord(f) ||
      !int(f.column, width) ||
      !["contains", "equals", "greater", "less", "empty", "nonempty"].includes(
        String(f.operator)
      ) ||
      typeof f.value !== "string" ||
      f.value.length > 200 ||
      (["greater", "less"].includes(String(f.operator)) &&
        value.types[f.column as number] !== "number")
    )
      throw new Error("Недопустимые параметры фильтра.");
  }
  const sort = value.sort;
  if (
    sort !== null &&
    (!isRecord(sort) ||
      !int(sort.column, width) ||
      !["asc", "desc"].includes(String(sort.direction)))
  )
    throw new Error("Недопустимая сортировка.");
  if (value.group !== null && !int(value.group, width))
    throw new Error("Недопустимая группировка.");
  if (!int(value.measure, width)) throw new Error("Недопустимый столбец агрегации.");
  const chart = value.chart;
  if (
    !isRecord(chart) ||
    !["bar", "line", "scatter"].includes(String(chart.kind)) ||
    !int(chart.x, width) ||
    !int(chart.y, width)
  )
    throw new Error("Недопустимые оси диаграммы.");
}

export function parseDataWorkspace(source: string): DataWorkspace {
  if (new TextEncoder().encode(source).byteLength > DATA_LIMITS.workspaceBytes)
    throw new Error("Workspace превышает 16 МБ.");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Некорректный JSON workspace.");
  }
  if (
    !isRecord(value) ||
    value.schema !== "kosmora.studio.data" ||
    value.version !== 1 ||
    typeof value.name !== "string" ||
    value.name.length > 160
  )
    throw new Error("Неизвестная версия или структура workspace.");
  validateDataTable(value.table);
  validateDataSettings(value.settings, value.table.headers.length);
  return value as unknown as DataWorkspace;
}
