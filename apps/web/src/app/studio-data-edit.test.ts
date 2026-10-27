import { expect, it } from "vitest";
import { applyDataCellEdit } from "./studio-data-edit";
import { initialDataSettings, loadDataCsv, queryData } from "./studio-data-core";
import { exportData } from "./studio-data-export";

it("edits original row coordinates after filtering/sorting, recalculates statistics and reverses exactly", async () => {
  const table = await loadDataCsv("id,value\nA,9\nB,2\nC,5");
  const settings = initialDataSettings(table);
  settings.types[1] = "number";
  settings.measure = 1;
  settings.sort = { column: 1, direction: "asc" };
  settings.filters = [{ column: 1, operator: "greater", value: "3" }];
  expect(queryData(table, settings).indexes).toEqual([2, 0]);
  const edit = { row: 2, column: 1, before: "5", after: "12,5" };
  const changed = applyDataCellEdit(table, edit);
  expect(table.rows[2]![1]).toBe("5");
  expect(queryData(changed, settings).indexes).toEqual([0, 2]);
  expect(queryData(changed, settings).stats.sum).toBe(21.5);
  expect(applyDataCellEdit(changed, edit, true)).toEqual(table);
  const formula = applyDataCellEdit(changed, {
    row: 2,
    column: 0,
    before: "C",
    after: "\u200b=1+1"
  });
  const csv = await exportData(
    formula,
    queryData(formula, settings).indexes,
    settings,
    "csv",
    new AbortController().signal
  );
  expect(await csv.text()).toContain("'\u200b=1+1");
});

it("rejects stale, oversized and invalid-coordinate edits without changing the source", async () => {
  const table = await loadDataCsv("id,value\nA,9");
  const edit = { row: 0, column: 1, before: "9", after: "10" };
  expect(() => applyDataCellEdit(table, { ...edit, before: "stale" })).toThrow("изменилась");
  expect(() => applyDataCellEdit(table, { ...edit, row: -1 })).toThrow("недоступна");
  expect(() => applyDataCellEdit(table, { ...edit, after: "я".repeat(32769) })).toThrow("64 КиБ");
  expect(table.rows).toEqual([["A", "9"]]);
});
