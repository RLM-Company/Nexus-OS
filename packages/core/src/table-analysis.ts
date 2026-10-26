import {
  parseDataWorkspace,
  type DataWorkspace,
  type DataSettings
} from "@cosmora/contracts/data-workspace";

/** Same strict decimal notation as Studio; identifiers stay text unless explicitly typed. */
export function tableNumber(raw: string): number | null {
  const value = raw.trim();
  const plain = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u;
  const grouped = /^[+-]?\d{1,3}(?:([ \u00a0\u202f])\d{3})(?:\1\d{3})*(?:[.,]\d+)?$/u;
  if (!plain.test(value) && !grouped.test(value)) return null;
  const number = Number(value.replace(/[ \u00a0\u202f]/gu, "").replace(",", "."));
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : null;
}

export class TableAnalysisError extends Error {
  constructor(public readonly code: "TABLE_FILTER_INVALID" | "TABLE_WORKSPACE_INVALID") {
    super(code);
  }
}

export type TableScope = "all" | "view";
export type TableSelection = {
  workspace: DataWorkspace;
  indexes: number[];
  columns: number[];
  scope: TableScope;
};

/** Reads an immutable saved workspace. No SQL, expression evaluation, sampling or model call. */
export function selectTable(source: string, scope: TableScope): TableSelection {
  let workspace: DataWorkspace;
  try {
    workspace = parseDataWorkspace(source);
  } catch {
    throw new TableAnalysisError("TABLE_WORKSPACE_INVALID");
  }
  if (scope !== "all" && scope !== "view") throw new TableAnalysisError("TABLE_FILTER_INVALID");
  const { table, settings } = workspace;
  const indexes: number[] = [];
  const filters = scope === "view" ? compileFilters(settings) : [];
  for (let index = 0; index < table.rows.length; index++) {
    if (filters.every((matches) => matches(table.rows[index]!))) indexes.push(index);
  }
  if (scope === "view" && settings.sort) {
    const { column, direction } = settings.sort;
    const sign = direction === "asc" ? 1 : -1;
    const collator = new Intl.Collator("ru", { sensitivity: "base" });
    indexes.sort((a, b) => {
      const av = table.rows[a]![column]!,
        bv = table.rows[b]![column]!;
      if (settings.types[column] === "number") {
        const x = tableNumber(av),
          y = tableNumber(bv);
        // Missing and malformed numbers always sort last, including descending order.
        if (x === null || y === null) return (x === null ? (y === null ? 0 : 1) : -1) || a - b;
        return (x < y ? -sign : x > y ? sign : 0) || a - b;
      }
      return collator.compare(av, bv) * sign || a - b;
    });
  }
  return {
    workspace,
    indexes,
    scope,
    columns: scope === "view" ? [...settings.columns] : table.headers.map((_, index) => index)
  };
}

function compileFilters(settings: DataSettings): Array<(row: string[]) => boolean> {
  const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru");
  return settings.filters.map((filter) => {
    const threshold = tableNumber(filter.value);
    const numeric = settings.types[filter.column] === "number";
    if (
      (filter.operator === "greater" ||
        filter.operator === "less" ||
        (filter.operator === "equals" && numeric)) &&
      threshold === null
    )
      throw new TableAnalysisError("TABLE_FILTER_INVALID");
    const text = fold(filter.value);
    return (row: string[]) => {
      const raw = row[filter.column]!;
      switch (filter.operator) {
        case "empty":
          return !raw.trim();
        case "nonempty":
          return !!raw.trim();
        case "contains":
          return fold(raw).includes(text);
        case "equals":
          return numeric ? tableNumber(raw) === threshold : fold(raw) === text;
        // Studio's existing operators include the threshold; preserve that convention.
        case "greater": {
          const n = tableNumber(raw);
          return n !== null && n >= threshold!;
        }
        case "less": {
          const n = tableNumber(raw);
          return n !== null && n <= threshold!;
        }
      }
    };
  });
}

export function tableColumns(selection: TableSelection) {
  return selection.columns.map((index) => ({
    index,
    name: selection.workspace.table.headers[index]!,
    type: selection.workspace.settings.types[index]!
  }));
}

export function tableRows(selection: TableSelection, offset = 0, limit = 100) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw new TableAnalysisError("TABLE_FILTER_INVALID");
  const selected = selection.indexes.slice(offset, offset + limit);
  return {
    scope: selection.scope,
    total_rows: selection.indexes.length,
    offset,
    limit,
    next_offset:
      offset + selected.length < selection.indexes.length ? offset + selected.length : null,
    columns: tableColumns(selection),
    rows: selected.map((index) => ({
      source_row: index + 1,
      cells: selection.columns.map((column) => selection.workspace.table.rows[index]![column]!)
    }))
  };
}

export function profileTable(selection: TableSelection) {
  const seenRows = new Set<string>();
  let duplicates = 0;
  for (const index of selection.indexes) {
    const key = JSON.stringify(
      selection.columns.map((column) => selection.workspace.table.rows[index]![column]!)
    );
    if (seenRows.has(key)) duplicates++;
    else seenRows.add(key);
  }
  return {
    format: "kosmora.table-analysis.v1" as const,
    scope: selection.scope,
    source_rows: selection.workspace.table.rows.length,
    analyzed_rows: selection.indexes.length,
    sampled: false,
    duplicate_rows: duplicates,
    duplicate_definition: "exact_cells_in_selected_columns" as const,
    columns: tableColumns(selection).map((column) => {
      const unique = new Set<string>(),
        numbers: number[] = [];
      let missing = 0,
        invalid = 0,
        mean = 0,
        m2 = 0,
        sum = 0,
        sumReliable = true;
      for (const index of selection.indexes) {
        const raw = selection.workspace.table.rows[index]![column.index]!;
        if (!raw.trim()) {
          missing++;
          continue;
        }
        unique.add(raw);
        if (column.type !== "number") continue;
        const value = tableNumber(raw);
        if (value === null) {
          invalid++;
          continue;
        }
        numbers.push(value);
        sum += value;
        if (!Number.isFinite(sum) || Math.abs(sum) > Number.MAX_SAFE_INTEGER) sumReliable = false;
        const delta = value - mean;
        mean += delta / numbers.length;
        m2 += delta * (value - mean);
      }
      numbers.sort((a, b) => a - b);
      const n = numbers.length,
        middle = Math.floor(n / 2);
      return {
        ...column,
        missing,
        present: selection.indexes.length - missing,
        distinct_nonempty: unique.size,
        numeric:
          column.type === "number"
            ? {
                count: n,
                invalid,
                min: n ? numbers[0]! : null,
                max: n ? numbers[n - 1]! : null,
                sum: n && sumReliable ? sum : null,
                sum_reliable: sumReliable,
                mean: n ? mean : null,
                median: n
                  ? n % 2
                    ? numbers[middle]!
                    : numbers[middle - 1]! / 2 + numbers[middle]! / 2
                  : null,
                population_stddev: n ? Math.sqrt(Math.max(0, m2 / n)) : null
              }
            : null
      };
    })
  };
}

/** JSON uses indexed columns and cell arrays, preserving duplicate headers and identifiers. */
export function exportTableJson(selection: TableSelection): string {
  return JSON.stringify({
    format: "kosmora.table-export.v1",
    scope: selection.scope,
    columns: tableColumns(selection),
    rows: selection.indexes.map((index) => ({
      source_row: index + 1,
      cells: selection.columns.map((column) => selection.workspace.table.rows[index]![column]!)
    }))
  });
}

/** Spreadsheet-safe CSV is a display export; JSON remains lossless. */
export function exportTableCsv(selection: TableSelection): string {
  const quote = (raw: string, numeric = false) => {
    let first = 0;
    while (
      first < raw.length &&
      (raw.charCodeAt(first) <= 32 || raw.charCodeAt(first) === 127 || /\s/u.test(raw[first]!))
    )
      first++;
    const dangerous =
      (first < raw.length && "=+-@".includes(raw[first]!)) ||
      raw.startsWith("\t") ||
      raw.startsWith("\r") ||
      raw.startsWith("\n");
    const safe = dangerous && !(numeric && tableNumber(raw) !== null) ? "'" + raw : raw;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const headers = selection.columns.map((column) =>
    quote(selection.workspace.table.headers[column]!)
  );
  return (
    "\ufeff" +
    [
      headers.join(","),
      ...selection.indexes.map((index) =>
        selection.columns
          .map((column) =>
            quote(
              selection.workspace.table.rows[index]![column]!,
              selection.workspace.settings.types[column] === "number"
            )
          )
          .join(",")
      )
    ].join("\r\n") +
    "\r\n"
  );
}
