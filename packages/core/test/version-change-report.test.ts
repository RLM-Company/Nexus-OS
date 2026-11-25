import { expect, it } from "vitest";
import {
  buildVersionChangeReport,
  VersionReportError,
  type VersionKey,
  type VersionSource
} from "../src/version-change-report.js";

const source = (
  rows: string[][],
  opts: { headers?: string[]; types?: string[]; name?: string } = {}
) => {
  const headers = opts.headers ?? ["ID", "value", "period"];
  const types = opts.types ?? headers.map(() => "text");
  return JSON.stringify({
    schema: "kosmora.studio.data",
    version: 1,
    name: opts.name ?? "fixture",
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
};
const v = (
  label: string,
  sourceText: string,
  extra: Partial<VersionSource> = {}
): VersionSource => ({
  label,
  source: sourceText,
  ...extra
});
const key: VersionKey = { before_columns: [1], after_columns: [1] };

it("ordinary report: added, removed and changed rows with values and source links", () => {
  const before = source([
    ["001", "1", "2026-10"],
    ["002", "2", "2026-10"],
    ["003", "3", "2026-10"]
  ]);
  const after = source([
    ["003", "3", "2026-10"],
    ["002", "20", "2026-10"],
    ["004", "4", "2026-10"]
  ]);
  const report = buildVersionChangeReport({
    before: v("before", before),
    after: v("after", after),
    key
  });
  expect(report.summary).toMatchObject({ added_rows: 1, removed_rows: 1, changed_rows: 1 });
  expect(report.markdown).toContain("ADDED");
  expect(report.markdown).toContain("REMOVED");
  expect(report.markdown).toContain("CHANGED");
  expect(report.markdown).toContain('"2"');
  expect(report.markdown).toContain('"20"');
  expect(report.markdown).toMatch(/before row 2/);
  expect(report.markdown).toMatch(/after row 2/);
  expect(report.duplicate_keys).toEqual([]);
  expect(report.uncomparable).toEqual([]);
  expect(report.definition_changes).toEqual([]);
});

it("duplicate keys are reported explicitly without losing other changes", () => {
  const before = source([
    ["001", "1", "2026-10"],
    ["001", "1", "2026-10"],
    ["002", "2", "2026-10"]
  ]);
  const after = source([
    ["001", "10", "2026-10"],
    ["002", "2", "2026-10"],
    ["003", "3", "2026-10"]
  ]);
  const report = buildVersionChangeReport({
    before: v("before", before),
    after: v("after", after),
    key
  });
  expect(report.duplicate_keys).toEqual([{ side: "before", key: '["001"]', rows: [1, 2] }]);
  expect(report.uncomparable).toMatchObject([{ side: "before", row: 2, reason: "duplicate_key" }]);
  expect(report.summary.changed_rows).toBe(1);
  expect(report.summary.added_rows).toBe(1);
  expect(report.markdown).toContain("Дубли ключей");
  expect(report.markdown).toContain('["001"]');
});

it("period, units and method changes are marked separately from row changes", () => {
  const before = source([["001", "1", "2026-10"]], { name: "old" });
  const after = source([["001", "1", "2026-11"]], { name: "new" });
  const report = buildVersionChangeReport({
    before: v("before", before, { period: "2026-10", units: "руб", method: "факт" }),
    after: v("after", after, { period: "2026-11", units: "%", method: "план" }),
    key
  });
  expect(report.definition_changes).toEqual([
    { field: "period", before: "2026-10", after: "2026-11" },
    { field: "units", before: "руб", after: "%" },
    { field: "method", before: "факт", after: "план" }
  ]);
  expect(report.markdown).toContain("Определения и методика");
  expect(report.markdown).toContain("могут быть некорректными");
});

it("previous report conclusions are carried without inventing new ones", () => {
  const previous = [
    "# Previous",
    "- Вывод: выручка выросла [S1]",
    "- Контроль: строка 2 исходной таблицы",
    "Просто текст без ссылки"
  ].join("\n");
  const data = source([["001", "1", "2026-10"]]);
  const report = buildVersionChangeReport({
    before: v("before", data),
    after: v("after", data),
    key,
    previous_report: previous
  });
  expect(report.affected_conclusions).toHaveLength(2);
  expect(report.markdown).toContain("выручка выросла");
  expect(report.markdown).not.toContain("Просто текст без ссылки");
});

it("invalid key throws a typed error and produces no partial report", () => {
  const data = source([["001", "1", "2026-10"]]);
  expect(() =>
    buildVersionChangeReport({
      before: v("before", data),
      after: v("after", data),
      key: { before_columns: [9], after_columns: [1] }
    })
  ).toThrow(VersionReportError);
});
