import { parseDataWorkspace, type DataWorkspace } from "@cosmora/contracts/data-workspace";

/** Column numbers and source row numbers are 1-based. No fuzzy or inferred matching. */
export type TableAlignment =
  { kind: "position" } | { kind: "key"; before_columns: number[]; after_columns: number[] };
export type TableComparisonOptions = {
  alignment: TableAlignment;
  offset?: number;
  limit?: number;
  include_values?: boolean;
};
export class TableComparisonError extends Error {
  constructor(
    public readonly code:
      "TABLE_COMPARE_INVALID" | "TABLE_COMPARE_EMPTY_KEY" | "TABLE_COMPARE_DUPLICATE_KEY",
    public readonly side?: "before" | "after",
    public readonly row?: number
  ) {
    super(code);
  }
}
type Change = {
  kind: "added" | "removed" | "changed";
  before_row: number | null;
  after_row: number | null;
  changed_columns: number[];
  before?: string[] | null;
  after?: string[] | null;
};

function read(source: string) {
  try {
    return parseDataWorkspace(source);
  } catch {
    throw new TableComparisonError("TABLE_COMPARE_INVALID");
  }
}
function keyColumns(columns: number[], width: number) {
  if (
    !Array.isArray(columns) ||
    !columns.length ||
    columns.length > 3 ||
    new Set(columns).size !== columns.length ||
    columns.some((c) => !Number.isInteger(c) || c < 1 || c > width)
  )
    throw new TableComparisonError("TABLE_COMPARE_INVALID");
}
function keyIndex(workspace: DataWorkspace, columns: number[], side: "before" | "after") {
  const index = new Map<string, number>();
  for (let row = 0; row < workspace.table.rows.length; row++) {
    const values = columns.map((column) => workspace.table.rows[row]![column - 1]!);
    if (values.some((value) => !value.trim()))
      throw new TableComparisonError("TABLE_COMPARE_EMPTY_KEY", side, row + 1);
    // JSON tuple encoding prevents collisions for separators, quotes and multi-column keys.
    const key = JSON.stringify(values);
    if (index.has(key))
      throw new TableComparisonError("TABLE_COMPARE_DUPLICATE_KEY", side, row + 1);
    index.set(key, row);
  }
  return index;
}

/** Compares all original rows. Saved view filters/sorting do not hide changes. */
export function compareTables(
  beforeSource: string,
  afterSource: string,
  options: TableComparisonOptions
) {
  const before = read(beforeSource),
    after = read(afterSource);
  const { alignment, offset = 0, limit = 50, include_values = false } = options;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > 200 ||
    typeof include_values !== "boolean" ||
    !alignment ||
    !["position", "key"].includes(alignment.kind)
  )
    throw new TableComparisonError("TABLE_COMPARE_INVALID");
  if (alignment.kind === "key") {
    keyColumns(alignment.before_columns, before.table.headers.length);
    keyColumns(alignment.after_columns, after.table.headers.length);
    if (alignment.before_columns.length !== alignment.after_columns.length)
      throw new TableComparisonError("TABLE_COMPARE_INVALID");
  }
  const schemaChanges = [];
  for (
    let column = 0;
    column < Math.max(before.table.headers.length, after.table.headers.length);
    column++
  ) {
    const oldColumn =
      column < before.table.headers.length
        ? { name: before.table.headers[column]!, type: before.settings.types[column]! }
        : null;
    const newColumn =
      column < after.table.headers.length
        ? { name: after.table.headers[column]!, type: after.settings.types[column]! }
        : null;
    if (oldColumn?.name !== newColumn?.name || oldColumn?.type !== newColumn?.type)
      schemaChanges.push({ column: column + 1, before: oldColumn, after: newColumn });
  }
  const summary = {
    added_rows: 0,
    removed_rows: 0,
    changed_rows: 0,
    unchanged_rows: 0,
    matched_rows: 0,
    moved_rows: 0,
    changed_cells: 0
  };
  const changes: Change[] = [];
  let totalChanges = 0;
  const record = (
    kind: Change["kind"],
    oldIndex: number | null,
    newIndex: number | null,
    columns: number[]
  ) => {
    const changeIndex = totalChanges++;
    if (changeIndex < offset || changes.length >= limit) return;
    const change: Change = {
      kind,
      before_row: oldIndex === null ? null : oldIndex + 1,
      after_row: newIndex === null ? null : newIndex + 1,
      changed_columns: columns
    };
    if (include_values) {
      change.before = oldIndex === null ? null : [...before.table.rows[oldIndex]!];
      change.after = newIndex === null ? null : [...after.table.rows[newIndex]!];
    }
    changes.push(change);
  };
  const pair = (oldIndex: number, newIndex: number) => {
    summary.matched_rows++;
    if (alignment.kind === "key" && oldIndex !== newIndex) summary.moved_rows++;
    const oldRow = before.table.rows[oldIndex]!,
      newRow = after.table.rows[newIndex]!;
    const changed: number[] = [];
    for (let column = 0; column < Math.max(oldRow.length, newRow.length); column++)
      if (oldRow[column] !== newRow[column]) changed.push(column + 1);
    if (changed.length) {
      summary.changed_rows++;
      summary.changed_cells += changed.length;
      record("changed", oldIndex, newIndex, changed);
    } else summary.unchanged_rows++;
  };
  if (alignment.kind === "position") {
    const common = Math.min(before.table.rows.length, after.table.rows.length);
    for (let row = 0; row < common; row++) pair(row, row);
    for (let row = common; row < before.table.rows.length; row++) {
      summary.removed_rows++;
      record("removed", row, null, []);
    }
    for (let row = common; row < after.table.rows.length; row++) {
      summary.added_rows++;
      record("added", null, row, []);
    }
  } else {
    const oldKeys = keyIndex(before, alignment.before_columns, "before");
    const newKeys = keyIndex(after, alignment.after_columns, "after");
    for (const [key, oldIndex] of oldKeys) {
      const newIndex = newKeys.get(key);
      if (newIndex === undefined) {
        summary.removed_rows++;
        record("removed", oldIndex, null, []);
      } else pair(oldIndex, newIndex);
    }
    for (const [key, newIndex] of newKeys)
      if (!oldKeys.has(key)) {
        summary.added_rows++;
        record("added", null, newIndex, []);
      }
  }
  return {
    format: "kosmora.table-comparison.v1" as const,
    alignment: structuredClone(alignment),
    cell_matching: "exact_string_by_column_position" as const,
    scope: "all_original_rows" as const,
    sampled: false,
    before: { rows: before.table.rows.length, columns: before.table.headers.length },
    after: { rows: after.table.rows.length, columns: after.table.headers.length },
    schema_changes: schemaChanges,
    summary,
    detail: {
      offset,
      limit,
      include_values,
      total_changes: totalChanges,
      returned_changes: changes.length,
      next_offset:
        changes.length && offset + changes.length < totalChanges ? offset + changes.length : null,
      all_changes_included: totalChanges === changes.length
    },
    changes
  };
}
