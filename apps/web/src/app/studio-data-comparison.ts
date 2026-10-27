import type { DataWorkspace } from "@cosmora/contracts/data-workspace";

export const DATA_COMPARE_MAX_CELLS = 100_000;
export const DATA_COMPARE_SAMPLES = 100;
export type DataCellChange = {
  kind: "header" | "cell";
  row: number;
  column: number;
  before: string;
  after: string;
};
export type DataComparison = {
  before: { rows: number; columns: number };
  after: { rows: number; columns: number };
  nameChanged: boolean;
  delimiterChanged: boolean;
  settingsChanged: boolean;
} & (
  | { complete: false }
  | {
      complete: true;
      changedHeaders: number;
      changedCells: number;
      addedRows: number;
      removedRows: number;
      addedColumns: number;
      removedColumns: number;
      samples: DataCellChange[];
      samplesOmitted: number;
    }
);

// Normalize known settings explicitly: JSON property insertion order is not a change.
function settingsKey(workspace: DataWorkspace): string {
  const s = workspace.settings;
  return JSON.stringify([
    s.types,
    s.columns,
    s.filters.map((f) => [f.column, f.operator, f.value]),
    s.sort ? [s.sort.column, s.sort.direction] : null,
    s.group,
    s.measure,
    [s.chart.kind, s.chart.x, s.chart.y]
  ]);
}

/** Literal, positional comparison of two validated snapshots; never guesses row identity. */
export function compareDataWorkspaces(before: DataWorkspace, after: DataWorkspace): DataComparison {
  const a = before.table,
    b = after.table;
  const rows = Math.min(a.rows.length, b.rows.length);
  const columns = Math.min(a.headers.length, b.headers.length);
  const summary = {
    before: { rows: a.rows.length, columns: a.headers.length },
    after: { rows: b.rows.length, columns: b.headers.length },
    nameChanged: before.name !== after.name,
    delimiterChanged: a.delimiter !== b.delimiter,
    settingsChanged: settingsKey(before) !== settingsKey(after)
  };
  if ((rows + 1) * columns > DATA_COMPARE_MAX_CELLS) return { ...summary, complete: false };
  let changedHeaders = 0,
    changedCells = 0;
  const samples: DataCellChange[] = [];
  const sample = (change: DataCellChange) => {
    if (samples.length < DATA_COMPARE_SAMPLES) samples.push(change);
  };
  for (let column = 0; column < columns; column++) {
    if (a.headers[column] !== b.headers[column]) {
      changedHeaders++;
      sample({
        kind: "header",
        row: 0,
        column: column + 1,
        before: a.headers[column]!,
        after: b.headers[column]!
      });
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const oldValue = a.rows[row]![column]!,
        newValue = b.rows[row]![column]!;
      if (oldValue !== newValue) {
        changedCells++;
        sample({
          kind: "cell",
          row: row + 1,
          column: column + 1,
          before: oldValue,
          after: newValue
        });
      }
    }
  }
  return {
    ...summary,
    complete: true,
    changedHeaders,
    changedCells,
    addedRows: Math.max(0, b.rows.length - a.rows.length),
    removedRows: Math.max(0, a.rows.length - b.rows.length),
    addedColumns: Math.max(0, b.headers.length - a.headers.length),
    removedColumns: Math.max(0, a.headers.length - b.headers.length),
    samples,
    samplesOmitted: changedHeaders + changedCells - samples.length
  };
}
