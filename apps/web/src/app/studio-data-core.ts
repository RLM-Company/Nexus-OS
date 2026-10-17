import { parseCsv, type CsvTable } from "./studio-csv";

import {
  DATA_LIMITS,
  validateDataTable,
  validateDataSettings,
  type DataSettings
} from "@cosmora/contracts/data-workspace";
export {
  DATA_LIMITS,
  validateDataTable,
  validateDataSettings,
  parseDataWorkspace,
  type DataWorkspace,
  type DataType,
  type DataOperator,
  type DataFilter,
  type DataSort,
  type DataChart,
  type DataSettings
} from "@cosmora/contracts/data-workspace";
export type DataStats = {
  count: number;
  missing: number;
  invalid: number;
  scanned: number;
  sum: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
};
export type DataGroup = { key: string; stats: DataStats };
export type DataPoint = { x: number; y: number; row: number };
export type DataResult = {
  indexes: number[];
  stats: DataStats;
  groups: DataGroup[];
  plot: { points: DataPoint[]; valid: number; missing: number; invalid: number; sampled: boolean };
};

// Strict Russian decimal notation: digits and optional decimal dot/comma; grouping uses
// ONLY consistent groups of three separated by spaces/NBSP/narrow-NBSP.
// Mixed dot/comma notation and ambiguous comma thousands are never guessed.
export function dataNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const plain = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u;
  const grouped = /^[+-]?\d{1,3}(?:([ \u00a0\u202f])\d{3})(?:\1\d{3})*(?:[.,]\d+)?$/u;
  if (!plain.test(value) && !grouped.test(value)) return null;
  const number = Number(value.replace(/[ \u00a0\u202f]/gu, "").replace(",", "."));
  // Do not silently lose high-order integer digits when IDs are explicitly typed as numbers.
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : null;
}

export function initialDataSettings(table: CsvTable): DataSettings {
  return {
    types: table.headers.map(() => "text"),
    columns: table.headers.map((_, i) => i),
    filters: [],
    sort: null,
    group: null,
    measure: 0,
    chart: { kind: "scatter", x: 0, y: Math.min(1, table.headers.length - 1) }
  };
}

// Preflight is a single bounded pass BEFORE parseCsv creates any row arrays.
// Counts logical records and candidate delimiter widths outside quoted fields.
export async function preflightDataCsv(text: string, tick: () => Promise<void> = async () => {}) {
  if (new TextEncoder().encode(text).byteLength > DATA_LIMITS.csvBytes)
    throw new Error("CSV/TSV больше 8 МБ.");
  const delimiters = [",", ";", "\t", "|"];
  const widths = [1, 1, 1, 1];
  const maxWidths = [0, 0, 0, 0];
  const samples: number[][] = [[], [], [], []];
  let rows = 0,
    quoted = false,
    seen = false;
  const finish = () => {
    rows++;
    if (rows > DATA_LIMITS.rows + 1) throw new Error("Более 80 000 строк CSV.");
    for (let j = 0; j < 4; j++) {
      maxWidths[j] = Math.max(maxWidths[j]!, widths[j]!);
      if (rows <= 40) samples[j]!.push(widths[j]!);
      widths[j] = 1;
    }
    seen = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
      seen = true;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finish();
    } else {
      if (!quoted) for (let j = 0; j < 4; j++) if (char === delimiters[j]) widths[j]!++;
      seen = true;
    }
    if ((i & 0xffff) === 0xffff) await tick();
  }
  if (seen) finish();
  let best = 0,
    score = -Infinity;
  for (let j = 0; j < 4; j++) {
    const freq = new Map<number, number>();
    for (const width of samples[j]!) freq.set(width, (freq.get(width) ?? 0) + 1);
    let mode = 1,
      count = 0;
    for (const [width, n] of freq)
      if (n > count) {
        mode = width;
        count = n;
      }
    const value = mode < 2 ? -Infinity : count * 100 + mode - (samples[j]!.length - count) * 20;
    if (value > score) {
      score = value;
      best = j;
    }
  }
  const width = maxWidths[best]!;
  if (width > DATA_LIMITS.columns) throw new Error("CSV превышает 100 столбцов.");
  if (rows * width > DATA_LIMITS.cells) throw new Error("CSV превышает 1 млн ячеек.");
  return { rows, width, delimiter: delimiters[best] };
}

export async function loadDataCsv(source: string, tick?: () => Promise<void>): Promise<CsvTable> {
  const checked = await preflightDataCsv(source, tick);
  const table = parseCsv(source); // canonical parser, not a fork
  if (table.delimiter !== checked.delimiter)
    throw new Error(
      "Неоднозначный разделитель CSV/TSV: выберите файл с согласованными разделителями."
    );
  validateDataTable(table);
  return table;
}

function blankStats(): DataStats {
  return {
    count: 0,
    missing: 0,
    invalid: 0,
    scanned: 0,
    sum: null,
    min: null,
    max: null,
    mean: null
  };
}
function addStat(stats: DataStats, raw: string) {
  stats.scanned++;
  if (!raw.trim()) {
    stats.missing++;
    return;
  }
  const n = dataNumber(raw);
  if (n === null) {
    stats.invalid++;
    return;
  }
  stats.count++;
  stats.sum = (stats.sum ?? 0) + n;
  if (!Number.isFinite(stats.sum) || Math.abs(stats.sum) > Number.MAX_SAFE_INTEGER)
    throw new Error("Сумма превышает диапазон надёжного числового отображения.");
  stats.min = stats.min === null ? n : Math.min(stats.min, n);
  stats.max = stats.max === null ? n : Math.max(stats.max, n);
  stats.mean = stats.sum / stats.count;
}

export function queryData(table: CsvTable, settings: DataSettings): DataResult {
  validateDataSettings(settings, table.headers.length);
  const indexes: number[] = [];
  const fold = (v: string) => v.normalize("NFKC").toLocaleLowerCase("ru");
  const numericFilters = settings.filters.map((filter) => ({
    ...filter,
    threshold: dataNumber(filter.value)
  }));
  if (
    numericFilters.some(
      (f) =>
        (f.operator === "greater" ||
          f.operator === "less" ||
          (f.operator === "equals" && settings.types[f.column] === "number")) &&
        f.threshold === null
    )
  )
    throw new Error("Для числового фильтра укажите корректное число.");
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i]!;
    if (
      numericFilters.every((f) => {
        const raw = row[f.column] ?? "";
        if (f.operator === "empty") return !raw.trim();
        if (f.operator === "nonempty") return !!raw.trim();
        if (f.operator === "contains") return fold(raw).includes(fold(f.value));
        if (f.operator === "equals")
          return settings.types[f.column] === "number"
            ? f.threshold !== null && dataNumber(raw) === f.threshold
            : fold(raw) === fold(f.value);
        const number = dataNumber(raw);
        return (
          number !== null &&
          f.threshold !== null &&
          (f.operator === "greater" ? number >= f.threshold : number <= f.threshold)
        );
      })
    )
      indexes.push(i);
  }
  if (settings.sort) {
    const { column, direction } = settings.sort;
    const sign = direction === "asc" ? 1 : -1;
    const numeric = settings.types[column] === "number";
    const collator = new Intl.Collator("ru", { sensitivity: "base" });
    indexes.sort((a, b) => {
      const av = table.rows[a]![column]!,
        bv = table.rows[b]![column]!;
      let diff: number;
      if (numeric) {
        const x = dataNumber(av),
          y = dataNumber(bv);
        diff = x === null ? (y === null ? 0 : 1) : y === null ? -1 : x < y ? -1 : x > y ? 1 : 0;
        return (x === null || y === null ? diff : diff * sign) || a - b;
      }
      diff = collator.compare(av, bv);
      return diff * sign || a - b;
    });
  }
  const stats = blankStats();
  const groups = new Map<string, DataStats>();
  const points: DataPoint[] = [];
  let valid = 0,
    missing = 0,
    invalid = 0;
  const plotStep = Math.max(1, Math.ceil(indexes.length / DATA_LIMITS.plotPoints));
  const chartReady =
    settings.types[settings.chart.x] === "number" && settings.types[settings.chart.y] === "number";
  for (const rowIndex of indexes) {
    const row = table.rows[rowIndex]!;
    if (settings.types[settings.measure] === "number") addStat(stats, row[settings.measure] ?? "");
    if (settings.group !== null) {
      const key = row[settings.group] ?? "";
      let group = groups.get(key);
      if (!group) {
        if (groups.size >= DATA_LIMITS.groups)
          throw new Error("Более 300 групп. Уточните фильтры или группировку.");
        group = blankStats();
        groups.set(key, group);
      }
      if (settings.types[settings.measure] === "number")
        addStat(group, row[settings.measure] ?? "");
    }
    if (chartReady) {
      const xRaw = row[settings.chart.x] ?? "",
        yRaw = row[settings.chart.y] ?? "";
      if (!xRaw.trim() || !yRaw.trim()) {
        missing++;
        continue;
      }
      const x = dataNumber(xRaw),
        y = dataNumber(yRaw);
      if (x === null || y === null) {
        invalid++;
        continue;
      }
      valid++;
      if (valid % plotStep === 1 || plotStep === 1) {
        if (points.length < DATA_LIMITS.plotPoints) points.push({ x, y, row: rowIndex });
      }
    }
  }
  if (settings.chart.kind === "line") points.sort((a, b) => a.x - b.x || a.row - b.row);
  return {
    indexes,
    stats,
    groups: Array.from(groups, ([key, value]) => ({ key, stats: value })),
    plot: { points, valid, missing, invalid, sampled: valid > points.length }
  };
}
