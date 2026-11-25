// Generates the example BIZ-069 report from synthetic two-version data.
// Run: node --import ./node_modules/.pnpm/tsx@4.20.6/node_modules/tsx/dist/loader.mjs scripts/generate-biz069-example.mjs
import { writeFileSync } from "node:fs";
import { buildVersionChangeReport } from "../packages/core/src/version-change-report.ts";

const source = (rows, headers = ["ID", "value", "period"]) =>
  JSON.stringify({
    schema: "kosmora.studio.data",
    version: 1,
    name: "Показатели",
    table: { delimiter: ",", headers, rows },
    settings: {
      types: headers.map(() => "text"),
      columns: headers.map((_, i) => i),
      filters: [],
      sort: null,
      group: null,
      measure: 0,
      chart: { kind: "line", x: 0, y: 0 }
    }
  });

const report = buildVersionChangeReport({
  before: {
    label: "версия 2026-10",
    source: source([
      ["001", "19700", "2026-10"],
      ["001", "19700", "2026-10"],
      ["002", "1800", "2026-10"],
      ["003", "200", "2026-10"]
    ]),
    period: "2026-10",
    units: "руб",
    method: "фактические продажи"
  },
  after: {
    label: "версия 2026-11",
    source: source([
      ["001", "21000", "2026-11"],
      ["002", "1800", "2026-11"],
      ["004", "500", "2026-11"]
    ]),
    period: "2026-11",
    units: "%",
    method: "план"
  },
  key: { before_columns: [1], after_columns: [1] },
  previous_report: [
    "# Previous",
    "- Выручка по артикулу 00123 выросла [S1]",
    "- Контроль: строка 2 исходной таблицы"
  ].join("\n")
});

writeFileSync(new URL("../docs/biz069-example.md", import.meta.url), report.markdown);
console.log(
  JSON.stringify(
    {
      summary: report.summary,
      duplicates: report.duplicate_keys,
      definitions: report.definition_changes,
      bytes: Buffer.byteLength(report.markdown)
    },
    null,
    2
  )
);
