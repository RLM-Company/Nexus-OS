import { DATA_LIMITS } from "./studio-data-core";
import type { CsvTable } from "./studio-csv";

export type DataCellEdit = { row: number; column: number; before: string; after: string };
export const DATA_EDIT_HISTORY_LIMIT = 20;
export const DATA_EDIT_CELL_BYTES = 64 * 1024;

/** Row positions always refer to source data, never to a sorted/filtered screen position. */
export function applyDataCellEdit(table: CsvTable, edit: DataCellEdit, undo = false): CsvTable {
  if (
    !Number.isInteger(edit.row) ||
    !Number.isInteger(edit.column) ||
    edit.row < 0 ||
    edit.column < 0 ||
    edit.row >= table.rows.length ||
    edit.column >= table.headers.length
  )
    throw new Error("Ячейка больше недоступна.");
  const expected = undo ? edit.after : edit.before;
  const value = undo ? edit.before : edit.after;
  if (table.rows[edit.row]![edit.column] !== expected)
    throw new Error("Ячейка изменилась. Откройте её снова перед редактированием.");
  if (expected === value) return table;
  if (!undo && new TextEncoder().encode(value).byteLength > DATA_EDIT_CELL_BYTES)
    throw new Error("Новое значение ячейки должно быть не больше 64 КиБ.");
  const rows = table.rows.slice();
  rows[edit.row] = rows[edit.row]!.map((cell, column) => (column === edit.column ? value : cell));
  const next = { ...table, rows };
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > DATA_LIMITS.workspaceBytes)
    throw new Error("После правки таблица превышает 16 МБ. Сократите значение.");
  return next;
}
