export type CsvTable = {
  delimiter: string;
  headers: string[];
  rows: string[][];
};

export type CsvNumericStats = {
  count: number;
  invalid: number;
  empty: number;
  scanned: number;
  limited: boolean;
  min: number | null;
  max: number | null;
  mean: number | null;
};

export type CsvSelection = {
  content: string;
  includedRows: number;
  truncated: boolean;
  blocked: "header" | "row" | null;
};

const DELIMITERS = [",", ";", "\t", "|"] as const;

function parseWithDelimiter(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote) {
      if (character === delimiter) {
        finishField();
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[i + 1] === "\n") i++;
        finishRow();
      } else {
        throw new Error("CSV содержит символы после закрывающей кавычки поля.");
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error("CSV содержит кавычку внутри некавыченного поля.");
      quoted = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV содержит незакрытое поле в кавычках.");
  if (field.length > 0 || row.length > 0 || closedQuote) {
    finishRow();
  }
  return rows;
}

function scoreDelimiter(rows: string[][]): number {
  const sample = rows.slice(0, 40);
  if (sample.length < 1) return -Infinity;
  const widths = sample.map((row) => row.length);
  const frequency = new Map<number, number>();
  for (const width of widths) frequency.set(width, (frequency.get(width) ?? 0) + 1);
  const [width, count] = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0] ?? [1, 0];
  if (width < 2) return -Infinity;
  return count * 100 + width - (sample.length - count) * 20;
}

export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let best: { delimiter: string; rows: string[][]; score: number } | null = null;
  let firstError: Error | null = null;
  for (const delimiter of DELIMITERS) {
    try {
      const rows = parseWithDelimiter(source, delimiter);
      const score = scoreDelimiter(rows);
      if (!best || score > best.score) best = { delimiter, rows, score };
    } catch (cause) {
      if (!firstError && cause instanceof Error) firstError = cause;
    }
  }
  const delimiter = best?.score === -Infinity ? "," : (best?.delimiter ?? ",");
  let parsed: string[][];
  try {
    parsed = parseWithDelimiter(source, delimiter);
  } catch (cause) {
    throw cause instanceof Error ? cause : (firstError ?? new Error("Не удалось разобрать CSV."));
  }
  if (parsed.length === 0 || parsed.every((row) => row.every((field) => field.length === 0)))
    throw new Error("CSV не содержит записей.");
  let width = 0;
  for (const row of parsed) {
    if (row.length > width) width = row.length;
    if (width > 250) throw new Error("CSV содержит больше 250 столбцов.");
  }
  // Short ragged records can expand far beyond the input size when padded.
  // Reject this case explicitly rather than allocating millions of empty cells.
  if (parsed.length * width > 2_000_000) {
    throw new Error("CSV содержит больше 2 млн ячеек после выравнивания строк.");
  }
  const first = parsed[0]!;
  const headers = Array.from({ length: width }, (_, index) => {
    const raw = (first[index] ?? "").trim();
    return raw || `Столбец ${index + 1}`;
  });
  const rows = parsed
    .slice(1)
    .map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  return { delimiter, headers, rows };
}

export function csvEmptyCells(rows: readonly string[][]): number {
  let empty = 0;
  for (const row of rows) for (const cell of row) if (cell.trim() === "") empty++;
  return empty;
}

function parseNumericCell(raw: string): number | null {
  const compact = raw.replace(/\s/gu, "");
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(compact)) return null;
  if (compact.includes(",") && compact.includes(".")) return null;
  const value = Number(compact.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function numericStats(
  rows: readonly string[][],
  column: number,
  maxRows = 100_000,
  rowIndexes?: readonly number[]
): CsvNumericStats {
  let count = 0;
  let invalid = 0;
  let empty = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  const available = rowIndexes?.length ?? rows.length;
  const scanned = Math.min(available, maxRows);
  for (let position = 0; position < scanned; position++) {
    const rowIndex = rowIndexes?.[position] ?? position;
    const raw = (rows[rowIndex]?.[column] ?? "").trim();
    if (!raw) {
      empty++;
      continue;
    }
    const value = parseNumericCell(raw);
    if (value === null) {
      invalid++;
      continue;
    }
    count++;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return {
    count,
    invalid,
    empty,
    scanned,
    limited: available > scanned,
    min: count ? min : null,
    max: count ? max : null,
    mean: count ? sum / count : null
  };
}

export function serializeCsvSelection(
  table: CsvTable,
  rowIndexes: readonly number[],
  columns: readonly number[],
  maxCharacters = 7_000
): CsvSelection {
  const escape = (value: string) =>
    /["\r\n,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const header = columns.map((column) => escape(table.headers[column] ?? "")).join(",");
  if (header.length > maxCharacters) {
    return { content: "", includedRows: 0, truncated: true, blocked: "header" };
  }
  const lines = [header];
  let includedRows = 0;
  let length = header.length;
  for (const rowIndex of rowIndexes) {
    const row = table.rows[rowIndex];
    if (!row) continue;
    const line = columns.map((column) => escape(row[column] ?? "")).join(",");
    if (length + line.length + 1 > maxCharacters) {
      return {
        content: lines.join("\n"),
        includedRows,
        truncated: true,
        blocked: includedRows === 0 ? "row" : null
      };
    }
    lines.push(line);
    length += line.length + 1;
    includedRows++;
  }
  return { content: lines.join("\n"), includedRows, truncated: false, blocked: null };
}
