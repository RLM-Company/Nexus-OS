import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DataWorkspace } from "@cosmora/contracts/data-workspace";
import type { CanvasRevision } from "@cosmora/contracts/canvas-artifacts";
import { initialDataSettings } from "./studio-data-core";
import { compareDataWorkspaces, DATA_COMPARE_MAX_CELLS } from "./studio-data-comparison";
import { StudioDataComparison } from "./studio-data-comparison-view";

function workspace(rows: string[][], headers = ["id", "value"]): DataWorkspace {
  const table = { rows, headers, delimiter: "," };
  return {
    schema: "kosmora.studio.data",
    version: 1,
    name: "input.csv",
    table,
    settings: initialDataSettings(table)
  };
}
const revision = (content: string, version: number): CanvasRevision => ({
  artifact_id: "table",
  version,
  title: "<img src=x onerror=alert(1)>",
  format: "code",
  content,
  sha256: "a".repeat(64),
  source: { kind: "data_workspace" },
  created_at: "now"
});

describe("positional table revision comparison", () => {
  it("preserves duplicate headings, whitespace, leading zeroes, formulas and exact newlines without mutating snapshots", () => {
    const before = workspace(
      [
        ["001", "a\r\nb"],
        ["=1+1", " x "]
      ],
      ["same", "same"]
    );
    const after = workspace(
      [
        ["1", "a\nb"],
        ["=1+1", "x"]
      ],
      ["same", "renamed"]
    );
    const original = JSON.stringify([before, after]);
    const result = compareDataWorkspaces(before, after);
    expect(result).toMatchObject({
      complete: true,
      changedHeaders: 1,
      changedCells: 3,
      samplesOmitted: 0
    });
    if (!result.complete) throw Error("comparison unexpectedly limited");
    expect(result.samples).toContainEqual({
      kind: "cell",
      row: 1,
      column: 2,
      before: "a\r\nb",
      after: "a\nb"
    });
    expect(JSON.stringify([before, after])).toBe(original);
  });
  it("counts structural changes separately from shared positional cell changes", () => {
    const result = compareDataWorkspaces(
      workspace([
        ["A", "1"],
        ["B", "2"]
      ]),
      workspace([["A"], ["X"], ["C"]], ["id"])
    );
    expect(result).toMatchObject({
      complete: true,
      changedCells: 1,
      addedRows: 1,
      removedRows: 0,
      addedColumns: 0,
      removedColumns: 1
    });
    const reversed = compareDataWorkspaces(
      workspace([["A"], ["X"], ["C"]], ["id"]),
      workspace([
        ["A", "1"],
        ["B", "2"]
      ])
    );
    expect(reversed).toMatchObject({ complete: true, removedRows: 1, addedColumns: 1 });
  });
  it("treats reordering as positional edits and does not guess keys from duplicate values", () => {
    const before = workspace([
      ["A", "x"],
      ["B", "x"]
    ]);
    const after = workspace([
      ["B", "x"],
      ["A", "x"]
    ]);
    expect(compareDataWorkspaces(before, after)).toMatchObject({
      complete: true,
      changedCells: 2,
      addedRows: 0,
      removedRows: 0
    });
  });
  it("compares meaningful settings while ignoring object property insertion order", () => {
    const before = workspace([["A", "5"]]);
    before.settings.filters = [{ column: 0, operator: "equals", value: "A" }];
    const after = structuredClone(before);
    after.settings.filters = [{ value: "A", operator: "equals", column: 0 }];
    after.settings.chart = { y: 1, x: 0, kind: "scatter" };
    expect(compareDataWorkspaces(before, after)).toMatchObject({
      settingsChanged: false,
      nameChanged: false,
      delimiterChanged: false
    });
    after.settings.sort = { column: 1, direction: "desc" };
    after.name = "different.csv";
    after.table.delimiter = ";";
    expect(compareDataWorkspaces(before, after)).toMatchObject({
      settingsChanged: true,
      nameChanged: true,
      delimiterChanged: true,
      changedCells: 0
    });
  });
  it("bounds displayed changes while keeping exact counts", () => {
    const before = workspace(Array.from({ length: 110 }, () => ["A", "1"]));
    const after = workspace(Array.from({ length: 110 }, () => ["A", "2"]));
    const result = compareDataWorkspaces(before, after);
    expect(result).toMatchObject({ complete: true, changedCells: 110, samplesOmitted: 10 });
    if (!result.complete) throw Error("comparison unexpectedly limited");
    expect(result.samples).toHaveLength(100);
    expect(result.samples[99]!.row).toBe(100);
  });
  it("returns no misleading partial counts when computation exceeds the cell bound", () => {
    const columns = 100;
    const tooLarge = workspace(
      Array.from({ length: DATA_COMPARE_MAX_CELLS / columns }, () =>
        Array.from({ length: columns }, () => "x")
      ),
      Array.from({ length: columns }, (_, i) => String(i))
    );
    const result = compareDataWorkspaces(tooLarge, tooLarge);
    expect(result.complete).toBe(false);
    expect(result).not.toHaveProperty("changedCells");
    expect(result).not.toHaveProperty("samples");
    const boundary = workspace(tooLarge.table.rows.slice(1), tooLarge.table.headers);
    expect(compareDataWorkspaces(boundary, boundary)).toMatchObject({
      complete: true,
      changedCells: 0
    });
  });
  it("supports empty data rows and detects literal heading changes", () => {
    expect(compareDataWorkspaces(workspace([], ["a"]), workspace([], ["a "]))).toMatchObject({
      complete: true,
      changedCells: 0,
      changedHeaders: 1
    });
  });
  it("renders HTML/formulas as escaped text, labels shortened values and keeps line-ending differences visible", () => {
    const before = workspace([["<script>alert(1)</script>", "x".repeat(1000)]]);
    const after = workspace([["=1+1", "x\r\ny"]]);
    const html = renderToStaticMarkup(
      <StudioDataComparison
        before={revision("before", 2)}
        after={revision("after", 1)}
        comparison={compareDataWorkspaces(before, after)}
      />
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("значение сокращено");
    expect(html).toContain("\\r\\n");
    expect(html).toContain("=1+1");
  });
});
