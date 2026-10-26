import { expect, it } from "vitest";
import {
  compareTables,
  TableComparisonError,
  type TableAlignment
} from "../src/table-comparison.js";
const source = (rows: string[][], headers = ["ID", "value"], types = headers.map(() => "text")) =>
  JSON.stringify({
    schema: "kosmora.studio.data",
    version: 1,
    name: "fixture",
    table: { delimiter: ",", headers, rows },
    settings: {
      types,
      columns: headers.map((_, i) => i),
      filters: [],
      sort: null,
      group: null,
      measure: 0,
      chart: { kind: "line", x: 0, y: 0 }
    }
  });
const key: TableAlignment = { kind: "key", before_columns: [1], after_columns: [1] };
it("distinguishes added, removed, modified and reordered rows by an explicit key", () => {
  const before = source([
    ["001", "1"],
    ["002", "2"],
    ["003", "3"]
  ]);
  const after = source([
    ["003", "3"],
    ["002", "20"],
    ["004", "4"]
  ]);
  const result = compareTables(before, after, { alignment: key, include_values: true });
  expect(result.summary).toEqual({
    added_rows: 1,
    removed_rows: 1,
    changed_rows: 1,
    unchanged_rows: 1,
    matched_rows: 2,
    moved_rows: 1,
    changed_cells: 1
  });
  expect(result.changes).toEqual([
    {
      kind: "removed",
      before_row: 1,
      after_row: null,
      changed_columns: [],
      before: ["001", "1"],
      after: null
    },
    {
      kind: "changed",
      before_row: 2,
      after_row: 2,
      changed_columns: [2],
      before: ["002", "2"],
      after: ["002", "20"]
    },
    {
      kind: "added",
      before_row: null,
      after_row: 3,
      changed_columns: [],
      before: null,
      after: ["004", "4"]
    }
  ]);
  expect(result.detail.all_changes_included).toBe(true);
});
it("treats row order independently in key mode and never infers an inserted row in position mode", () => {
  const before = source([
      ["A", "one"],
      ["B", "two"]
    ]),
    after = source([
      ["B", "two"],
      ["A", "one"]
    ]);
  expect(compareTables(before, after, { alignment: key }).summary).toMatchObject({
    changed_rows: 0,
    unchanged_rows: 2,
    moved_rows: 2
  });
  expect(compareTables(before, after, { alignment: { kind: "position" } }).summary).toMatchObject({
    changed_rows: 2,
    changed_cells: 4,
    moved_rows: 0
  });
});
it("keeps exact text keys and cell spelling, including leading zeros, spaces, formulas and number formats", () => {
  const result = compareTables(
    source([
      ["001", "1"],
      ["1", "=KEEP()"]
    ]),
    source([
      ["001", "1.0"],
      ["1", "=KEEP()"]
    ]),
    { alignment: key }
  );
  expect(result.summary).toMatchObject({ changed_rows: 1, unchanged_rows: 1 });
  expect(result.changes[0]).not.toHaveProperty("before");
  expect(
    compareTables(source([["A ", "x"]]), source([["A", "x"]]), { alignment: key }).summary
  ).toMatchObject({ removed_rows: 1, added_rows: 1, matched_rows: 0 });
});
it("rejects duplicate or missing key components with side and row, without exposing their text", () => {
  for (const [oldRows, newRows, code, side, row] of [
    [
      [
        ["A", "1"],
        ["A", "2"]
      ],
      [["B", "3"]],
      "TABLE_COMPARE_DUPLICATE_KEY",
      "before",
      2
    ],
    [
      [["A", "1"]],
      [
        ["B", "3"],
        ["B", "4"]
      ],
      "TABLE_COMPARE_DUPLICATE_KEY",
      "after",
      2
    ],
    [[[" ", "1"]], [["B", "2"]], "TABLE_COMPARE_EMPTY_KEY", "before", 1]
  ] as const) {
    let error: unknown;
    try {
      compareTables(source(oldRows.map((r) => [...r])), source(newRows.map((r) => [...r])), {
        alignment: key
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TableComparisonError);
    expect(error).toMatchObject({ code, side, row });
  }
});
it("uses collision-free composite keys and accepts duplicate single components", () => {
  const before = source([
    ["a|b", "c"],
    ["a", "b|c"],
    ["a", "x"]
  ]);
  const after = source([
    ["a", "b|c"],
    ["a|b", "c"],
    ["a", "x"]
  ]);
  const result = compareTables(before, after, {
    alignment: { kind: "key", before_columns: [1, 2], after_columns: [1, 2] }
  });
  expect(result.summary).toMatchObject({
    matched_rows: 3,
    unchanged_rows: 3,
    changed_rows: 0,
    moved_rows: 2
  });
});
it("uses separately selected key columns when the key moves between versions", () => {
  const result = compareTables(source([["A", "10"]]), source([["10", "A"]], ["value", "ID"]), {
    alignment: { kind: "key", before_columns: [1], after_columns: [2] }
  });
  expect(result.summary).toMatchObject({
    matched_rows: 1,
    added_rows: 0,
    removed_rows: 0,
    changed_rows: 1,
    changed_cells: 2
  });
  expect(result.changes[0]!.changed_columns).toEqual([1, 2]);
});
it("reports schema changes by position even with duplicate names and no data rows", () => {
  const before = source([], ["same", "same"], ["text", "number"]),
    after = source([], ["same", "renamed", "new"], ["text", "text", "number"]);
  expect(compareTables(before, after, { alignment: { kind: "position" } }).schema_changes).toEqual([
    {
      column: 2,
      before: { name: "same", type: "number" },
      after: { name: "renamed", type: "text" }
    },
    { column: 3, before: null, after: { name: "new", type: "number" } }
  ]);
  const width = compareTables(source([["A", "1"]]), source([["A"]], ["ID"]), {
    alignment: { kind: "position" }
  });
  expect(width.changes[0]!.changed_columns).toEqual([2]);
  expect(width.summary.changed_cells).toBe(1);
});
it("keeps full counts across pages and supports summary-only results without claiming completeness", () => {
  const old = source(Array.from({ length: 650 }, (_, i) => [String(i), "old"]));
  const next = source(Array.from({ length: 650 }, (_, i) => [String(i), "new"]));
  const first = compareTables(old, next, { alignment: key, limit: 200 });
  expect(first.summary.changed_rows).toBe(650);
  expect(first.detail).toMatchObject({
    returned_changes: 200,
    total_changes: 650,
    next_offset: 200,
    all_changes_included: false
  });
  expect(
    compareTables(old, next, { alignment: key, offset: 600, limit: 200 }).detail
  ).toMatchObject({ returned_changes: 50, next_offset: null, all_changes_included: false });
  expect(compareTables(old, next, { alignment: key, limit: 0 }).detail).toMatchObject({
    returned_changes: 0,
    total_changes: 650,
    next_offset: null,
    all_changes_included: false
  });
});
it("rejects malformed workspaces, impossible key maps and unbounded pages", () => {
  const data = source([["A", "1"]]);
  for (const alignment of [
    { kind: "key", before_columns: [0], after_columns: [1] },
    { kind: "key", before_columns: [1, 1], after_columns: [1, 2] },
    { kind: "key", before_columns: [1], after_columns: [1, 2] },
    { kind: "key", before_columns: [1], after_columns: [3] }
  ] as TableAlignment[])
    expect(() => compareTables(data, data, { alignment })).toThrow("TABLE_COMPARE_INVALID");
  expect(() => compareTables("{}", data, { alignment: key })).toThrow("TABLE_COMPARE_INVALID");
  expect(() => compareTables(data, data, { alignment: key, limit: 201 })).toThrow(
    "TABLE_COMPARE_INVALID"
  );
  expect(() => compareTables(data, data, { alignment: key, offset: -1 })).toThrow(
    "TABLE_COMPARE_INVALID"
  );
});
it("preserves row accounting identities across deterministic mixtures", () => {
  for (let size = 0; size < 30; size++) {
    const before = source(Array.from({ length: size }, (_, i) => [String(i), String(i)]));
    const rows = Array.from({ length: size + 5 }, (_, i) => [
      String(i + 3),
      String((i + 3) % 2)
    ]).reverse();
    const after = source(rows),
      result = compareTables(before, after, { alignment: key });
    expect(result.summary.matched_rows + result.summary.removed_rows).toBe(size);
    expect(result.summary.matched_rows + result.summary.added_rows).toBe(rows.length);
    expect(result.summary.changed_rows + result.summary.unchanged_rows).toBe(
      result.summary.matched_rows
    );
    expect(result.detail.total_changes).toBe(
      result.summary.added_rows + result.summary.removed_rows + result.summary.changed_rows
    );
  }
});
