import type { CsvTable } from "./studio-csv";
import {
  DATA_LIMITS,
  validateDataTable,
  validateDataSettings,
  type DataResult,
  type DataSettings,
  type DataPoint,
  type DataWorkspace
} from "./studio-data-core";

const encoder = new TextEncoder();
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Guard spreadsheet formulas, including when applications strip leading whitespace,
// BOM, C0 and zero-width formatting characters. Applied to ALL exported cells and headers.
export function safeSpreadsheetCell(value: string): string {
  // Control characters are deliberate: spreadsheet apps strip these prefixes before evaluating formulas.
  // eslint-disable-next-line no-control-regex
  return /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(
    value
  )
    ? "'" + value
    : value;
}
export function csvField(value: string): string {
  const safe = safeSpreadsheetCell(value);
  return /[,"\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
function record(table: CsvTable, rowIndex: number, columns: number[]): string {
  const row = table.rows[rowIndex]!;
  return columns.map((column) => csvField(row[column] ?? "")).join(",");
}
export function attachmentData(
  table: CsvTable,
  indexes: readonly number[],
  columns: number[],
  limitBytes: number = DATA_LIMITS.attachmentBytes,
  limitCharacters: number = DATA_LIMITS.attachmentCharacters
) {
  const header = columns.map((col) => csvField(table.headers[col] ?? "")).join(",");
  if (
    !columns.length ||
    encoder.encode(header).length > limitBytes ||
    header.length > limitCharacters
  )
    throw new Error("Заголовок CSV не помещается во вложение.");
  const lines = [header];
  let bytes = encoder.encode(header).length,
    characters = header.length,
    includedRows = 0;
  for (const idx of indexes) {
    const line = record(table, idx, columns);
    const addedBytes = encoder.encode("\n" + line).byteLength;
    if (bytes + addedBytes > limitBytes || characters + 1 + line.length > limitCharacters) break;
    lines.push(line);
    bytes += addedBytes;
    characters += line.length + 1;
    includedRows++;
  }
  return {
    content: lines.join("\n"),
    includedRows,
    truncated: includedRows < indexes.length,
    bytes,
    totalRows: indexes.length
  };
}

export async function exportData(
  table: CsvTable,
  indexes: readonly number[],
  settings: DataSettings,
  format: "csv" | "json",
  signal: AbortSignal,
  progress?: (value: number) => void
): Promise<Blob> {
  validateDataSettings(settings, table.headers.length);
  const parts: string[] = [];
  let outputBytes = 0;
  const push = (chunk: string) => {
    outputBytes += encoder.encode(chunk).byteLength;
    if (outputBytes > DATA_LIMITS.exportBytes)
      throw new Error("Экспорт превышает 32 МБ; выгрузка остановлена без усечения.");
    parts.push(chunk);
  };
  const json = format === "json";
  if (json) {
    // Object row mapping would lose duplicate headers. Indexed column metadata + arrays preserve them.
    push(
      JSON.stringify({
        schema: "kosmora.studio.data.export",
        version: 1,
        columns: settings.columns.map((index) => ({
          index,
          name: table.headers[index],
          type: settings.types[index]
        }))
      }).slice(0, -1) + ',"rows":['
    );
  } else push(settings.columns.map((col) => csvField(table.headers[col] ?? "")).join(",") + "\r\n");
  let chunk = "";
  for (let i = 0; i < indexes.length; i++) {
    signal.throwIfAborted();
    const row = table.rows[indexes[i]!]!;
    if (json) {
      if (i) chunk += ",";
      chunk += JSON.stringify(settings.columns.map((col) => row[col] ?? ""));
    } else chunk += record(table, indexes[i]!, settings.columns) + "\r\n";
    if ((i + 1) % 512 === 0) {
      push(chunk);
      chunk = "";
      progress?.(i + 1);
      await nextFrame();
    }
  }
  signal.throwIfAborted();
  push(chunk);
  if (json) push("]}");
  progress?.(indexes.length);
  signal.throwIfAborted();
  return new Blob(parts, {
    type: json ? "application/json;charset=utf-8" : "text/csv;charset=utf-8"
  });
}

export function workspaceBlob(name: string, table: CsvTable, settings: DataSettings): Blob {
  validateDataTable(table);
  validateDataSettings(settings, table.headers.length);
  if (typeof name !== "string" || name.length > 160)
    throw new Error("Имя workspace должно содержать не более 160 символов.");
  const workspace: DataWorkspace = {
    schema: "kosmora.studio.data",
    version: 1,
    name,
    table,
    settings
  };
  const content = JSON.stringify(workspace);
  if (encoder.encode(content).byteLength > DATA_LIMITS.workspaceBytes)
    throw new Error("Workspace превышает 16 МБ — экспортируйте CSV вместо сохранения проекта.");
  return new Blob([content], { type: "application/json;charset=utf-8" });
}

// Stream workspace serialization to Blob parts rather than creating a second giant string
// on the UI thread. Opening always validates schema and complete dimensions in the Worker.
export async function exportWorkspace(
  name: string,
  table: CsvTable,
  settings: DataSettings,
  signal: AbortSignal,
  progress?: (rows: number) => void
): Promise<Blob> {
  validateDataTable(table);
  validateDataSettings(settings, table.headers.length);
  if (typeof name !== "string" || name.length > 160)
    throw new Error("Имя workspace должно содержать не более 160 символов.");
  const parts: string[] = [];
  let bytes = 0;
  const push = (value: string) => {
    bytes += encoder.encode(value).byteLength;
    if (bytes > DATA_LIMITS.workspaceBytes)
      throw new Error("Workspace превышает 16 МБ — экспортируйте CSV вместо сохранения проекта.");
    parts.push(value);
  };
  push(
    '{"schema":"kosmora.studio.data","version":1,"name":' +
      JSON.stringify(name) +
      ',"table":{"delimiter":' +
      JSON.stringify(table.delimiter) +
      ',"headers":' +
      JSON.stringify(table.headers) +
      ',"rows":['
  );
  let chunk = "";
  for (let i = 0; i < table.rows.length; i++) {
    signal.throwIfAborted();
    if (i) chunk += ",";
    chunk += JSON.stringify(table.rows[i]);
    if ((i + 1) % 512 === 0) {
      push(chunk);
      chunk = "";
      progress?.(i + 1);
      await nextFrame();
    }
  }
  signal.throwIfAborted();
  push(chunk);
  push(']},"settings":' + JSON.stringify(settings) + "}");
  progress?.(table.rows.length);
  signal.throwIfAborted();
  return new Blob(parts, { type: "application/json;charset=utf-8" });
}

export function dataReport(
  name: string,
  table: CsvTable,
  settings: DataSettings,
  result: DataResult
): string {
  const fmt = (n: number | null) => (n === null ? "—" : String(n));
  const s = result.stats;
  const lines = [
    `# Kosmora Data Workbench — ${name.replace(/[\r\n]/g, " ")}`,
    "",
    "Локальный отчёт; модель и внешний сервис не вызывались.",
    `Строк всего: ${table.rows.length}. Строк после фильтров: ${result.indexes.length}.`,
    `Выбранные столбцы: ${settings.columns.map((i) => `${i + 1}: ${table.headers[i]}`).join("; ")}.`,
    `Числовой столбец: ${settings.measure + 1}: ${table.headers[settings.measure]}.`,
    `Подсчитано: ${s.scanned}; чисел: ${s.count}; пропусков: ${s.missing}; некорректных: ${s.invalid}.`,
    `sum: ${fmt(s.sum)}; min: ${fmt(s.min)}; max: ${fmt(s.max)}; mean: ${fmt(s.mean)}.`,
    `Диаграмма ${settings.chart.kind}: ось X — ${table.headers[settings.chart.x]}, Y — ${table.headers[settings.chart.y]}.`,
    `Числовых пар: ${result.plot.valid}; пропусков: ${result.plot.missing}; некорректных: ${result.plot.invalid}; отображено: ${result.plot.points.length}.`,
    result.plot.sampled
      ? "ВНИМАНИЕ: диаграмма показывает выборку точек, не все значения."
      : "Диаграмма показывает все пригодные пары.",
    "",
    "## Агрегация по группам"
  ];
  if (settings.group === null) lines.push("Группировка не выбрана.");
  else
    for (const group of result.groups) {
      const x = group.stats;
      lines.push(
        `- ${JSON.stringify(group.key)}: count=${x.count}, missing=${x.missing}, invalid=${x.invalid}, sum=${fmt(x.sum)}, min=${fmt(x.min)}, max=${fmt(x.max)}, mean=${fmt(x.mean)}`
      );
    }
  return lines.join("\n") + "\n";
}

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const safeCoordinate = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : "0");

export function dataSvg(
  points: readonly DataPoint[],
  title: string,
  xTitle: string,
  yTitle: string,
  kind: DataSettings["chart"]["kind"]
): string {
  const width = 850,
    height = 450,
    left = 78,
    right = 22,
    top = 55,
    bottom = 68;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  // Only numeric finite pairs may contribute to SVG attributes.
  const validPoints = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  let lowX = Infinity,
    highX = -Infinity,
    lowY = Infinity,
    highY = -Infinity;
  for (const p of validPoints) {
    lowX = Math.min(lowX, p.x);
    highX = Math.max(highX, p.x);
    lowY = Math.min(lowY, p.y);
    highY = Math.max(highY, p.y);
  }
  if (!validPoints.length) {
    lowX = 0;
    highX = 1;
    lowY = 0;
    highY = 1;
  }
  if (kind === "bar") {
    lowY = Math.min(0, lowY);
    highY = Math.max(0, highY);
  }
  // Subtracting 1e308 - (-1e308) overflows. Normalize halves in this case.
  const ratio = (value: number, min: number, max: number) => {
    if (min === max) return 0.5;
    if (Number.isFinite(max - min)) return (value - min) / (max - min);
    return (value / 2 - min / 2) / (max / 2 - min / 2);
  };
  const x = (value: number) => left + ratio(value, lowX, highX) * plotWidth;
  const y = (value: number) => top + plotHeight - ratio(value, lowY, highY) * plotHeight;
  let shapes: string;
  if (kind === "line") {
    // Line ordering guaranteed by queryData; defend a direct export call too.
    const sorted = [...validPoints].sort((a, b) => a.x - b.x || a.row - b.row);
    shapes = `<polyline fill="none" stroke="#222" stroke-width="1.8" points="${sorted.map((p) => `${safeCoordinate(x(p.x))},${safeCoordinate(y(p.y))}`).join(" ")}"/>`;
  } else if (kind === "scatter") {
    shapes = validPoints
      .map(
        (p) =>
          `<circle cx="${safeCoordinate(x(p.x))}" cy="${safeCoordinate(y(p.y))}" r="3" fill="#222"/>`
      )
      .join("");
  } else {
    const barWidth = Math.max(
      1,
      Math.min(16, (plotWidth / Math.max(1, validPoints.length)) * 0.75)
    );
    const zeroY = y(0);
    shapes = validPoints
      .map((p) => {
        const topY = Math.min(y(p.y), zeroY),
          barHeight = Math.max(0.8, Math.abs(y(p.y) - zeroY));
        return `<rect x="${safeCoordinate(x(p.x) - barWidth / 2)}" y="${safeCoordinate(topY)}" width="${safeCoordinate(barWidth)}" height="${safeCoordinate(barHeight)}" fill="#222"/>`;
      })
      .join("");
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}">` +
    `<rect width="${width}" height="${height}" fill="#fff"/>` +
    `<text x="${left}" y="30" font-family="sans-serif" font-size="19" fill="#111">${xml(title)}</text>` +
    `<path d="M${left} ${top}V${top + plotHeight}H${left + plotWidth}" fill="none" stroke="#666"/>` +
    `<text x="${left + plotWidth / 2}" y="${height - 15}" font-family="sans-serif" text-anchor="middle" font-size="13">${xml(xTitle)}</text>` +
    `<text transform="translate(22 ${top + plotHeight / 2}) rotate(-90)" font-family="sans-serif" text-anchor="middle" font-size="13">${xml(yTitle)}</text>` +
    `<text x="${left}" y="${top + plotHeight + 20}" font-family="monospace" font-size="11">${xml(String(lowX))}</text>` +
    `<text x="${left + plotWidth}" y="${top + plotHeight + 20}" font-family="monospace" text-anchor="end" font-size="11">${xml(String(highX))}</text>` +
    `${shapes}</svg>`
  );
}
