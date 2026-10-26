import { describe, expect, it } from "vitest";
import { parseDataWorkspace } from "@cosmora/contracts/data-workspace";
import {
  tableNumber,
  selectTable,
  profileTable,
  tableRows,
  exportTableCsv,
  exportTableJson
} from "../src/table-analysis.js";

const source = (rows: string[][], settings = {}) =>
  JSON.stringify({
    schema: "kosmora.studio.data",
    version: 1,
    name: "test",
    table: { delimiter: ",", headers: ["id", "amount"], rows },
    settings: {
      types: ["text", "number"],
      columns: [0, 1],
      filters: [],
      sort: null,
      group: null,
      measure: 1,
      chart: { kind: "line", x: 0, y: 1 },
      ...settings
    }
  });

describe("saved table analysis", () => {
  it.each([
    ["1 234,5", 1234.5],
    ["-2,5", -2.5],
    ["1\u202f234\u202f567,25", 1234567.25],
    ["001", 1],
    ["", null],
    ["1,234.5", null],
    ["1 23", null],
    ["1e5", null],
    ["Infinity", null],
    ["9007199254740992", null]
  ] as const)("strict decimal %s", (raw, expected) => {
    expect(tableNumber(raw)).toBe(expected);
  });
  it("profiles every row, preserving text identifiers, missing data and malformed numbers", () => {
    const data = selectTable(
      source([
        ["001", "1,5"],
        ["002", "2,5"],
        ["002", "2,5"],
        ["003", "bad"],
        ["004", " "]
      ]),
      "all"
    );
    const result = profileTable(data);
    expect(result).toMatchObject({ analyzed_rows: 5, sampled: false, duplicate_rows: 1 });
    expect(result.columns[0]).toMatchObject({ distinct_nonempty: 4, numeric: null });
    expect(result.columns[1]).toMatchObject({
      missing: 1,
      numeric: { count: 3, invalid: 1, sum: 6.5, min: 1.5, max: 2.5, median: 2.5 }
    });
    expect(result.columns[1]!.numeric!.mean).toBeCloseTo(6.5 / 3);
    expect(result.columns[1]!.numeric!.population_stddev).toBeCloseTo(Math.sqrt(2 / 9));
    expect(tableRows(data).rows[0]!.cells[0]).toBe("001");
  });
  it("uses saved filters, selected columns and stable sorting with invalid numbers last", () => {
    const data = selectTable(
      source(
        [
          ["A", "2"],
          ["a", "bad"],
          ["B", "3"],
          ["a", "2"],
          ["a", ""]
        ],
        {
          filters: [{ column: 0, operator: "equals", value: "Ａ" }],
          sort: { column: 1, direction: "desc" },
          columns: [1]
        }
      ),
      "view"
    );
    expect(data.indexes).toEqual([0, 3, 1, 4]);
    expect(tableRows(data, 1, 2)).toMatchObject({
      total_rows: 4,
      next_offset: 3,
      rows: [
        { source_row: 4, cells: ["2"] },
        { source_row: 2, cells: ["bad"] }
      ]
    });
    expect(profileTable(data).duplicate_rows).toBe(1);
    expect(tableRows(data, 8, 2)).toMatchObject({ rows: [], next_offset: null });
  });
  it("preserves inclusive Studio numeric thresholds and rejects malformed thresholds", () => {
    const rows = [
      ["A", "2"],
      ["B", "3"],
      ["C", "bad"]
    ];
    expect(
      selectTable(
        source(rows, { filters: [{ column: 1, operator: "greater", value: "2" }] }),
        "view"
      ).indexes
    ).toEqual([0, 1]);
    expect(() =>
      selectTable(
        source(rows, { filters: [{ column: 1, operator: "equals", value: "bad" }] }),
        "view"
      )
    ).toThrow("TABLE_FILTER_INVALID");
    expect(
      selectTable(
        source(rows, { filters: [{ column: 1, operator: "equals", value: "bad" }] }),
        "all"
      ).indexes
    ).toEqual([0, 1, 2]);
  });
  it("reports empty statistics and unreliable sums without Infinity, NaN or fake zeros", () => {
    const empty = profileTable(selectTable(source([]), "all"));
    expect(empty.columns[1]!.numeric).toMatchObject({
      count: 0,
      sum: null,
      median: null,
      mean: null,
      population_stddev: null
    });
    const high = profileTable(
      selectTable(
        source([
          ["A", "9007199254740991"],
          ["B", "1"]
        ]),
        "all"
      )
    );
    expect(high.columns[1]!.numeric).toMatchObject({ sum: null, sum_reliable: false });
    expect(JSON.stringify(high)).not.toMatch(/NaN|Infinity/);
  });
  it("exports all filtered rows, escapes formulas and CSV quotes, and keeps JSON lossless", () => {
    const data = selectTable(
      source([
        ["=cmd(1)", "-2"],
        ["\t@evil", "3"],
        ['001\r\n"x', "bad"]
      ]),
      "all"
    );
    const csv = exportTableCsv(data);
    expect(csv).toContain('"\'=cmd(1)","-2"');
    expect(csv).toContain('"\'\t@evil"');
    expect(csv).toContain('"001\r\n""x"');
    const exported = JSON.parse(exportTableJson(data)) as { rows: Array<{ cells: string[] }> };
    expect(exported.rows[0]!.cells[0]).toBe("=cmd(1)");
    const json = parseDataWorkspace(source([["A", "2"]]));
    json.table.headers = ["same", "same"];
    const duplicate = JSON.parse(exportTableJson(selectTable(JSON.stringify(json), "all"))) as {
      columns: Array<{ name: string }>;
    };
    expect(duplicate.columns.map((c) => c.name)).toEqual(["same", "same"]);
  });
  it("rejects malformed workspaces and pagination outside the bounded API", () => {
    expect(() => selectTable("{}", "all")).toThrow("TABLE_WORKSPACE_INVALID");
    const data = selectTable(source([["a", "1"]]), "all");
    expect(() => tableRows(data, 0, 501)).toThrow("TABLE_FILTER_INVALID");
    expect(() => tableRows(data, -1, 10)).toThrow("TABLE_FILTER_INVALID");
  });
  it("does not confuse the 500-row response page with the full analysis or export", () => {
    const data = selectTable(
      source(Array.from({ length: 620 }, (_, i) => [String(i).padStart(4, "0"), String(i + 1)])),
      "all"
    );
    expect(profileTable(data).columns[1]!.numeric).toMatchObject({
      count: 620,
      sum: (620 * 621) / 2,
      median: 310.5
    });
    expect(tableRows(data, 0, 500)).toMatchObject({ next_offset: 500, total_rows: 620 });
    expect(tableRows(data, 500, 500).rows).toHaveLength(120);
    const exported = JSON.parse(exportTableJson(data)) as { rows: Array<{ cells: string[] }> };
    expect(exported.rows).toHaveLength(620);
    expect(exported.rows[619]!.cells).toEqual(["0619", "620"]);
  });
});
