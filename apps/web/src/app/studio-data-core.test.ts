import { describe, expect, it } from "vitest";
import {
  attachmentData,
  csvField,
  dataReport,
  dataSvg,
  exportData,
  exportWorkspace,
  safeSpreadsheetCell,
  workspaceBlob
} from "./studio-data-export";
import {
  DATA_LIMITS,
  dataNumber,
  initialDataSettings,
  loadDataCsv,
  parseDataWorkspace,
  preflightDataCsv,
  queryData
} from "./studio-data-core";

describe("Kosmora Studio Data Workbench", () => {
  it("supports locale explicitly and never auto-converts IDs", async () => {
    const table = await loadDataCsv(
      '\ufeffid;value;value\r\nID001;"1 234,50";9\r\n001;2,5;3\r\nABC;broken;1\r\nEMPTY;;4'
    );
    expect(table.headers).toEqual(["id", "value", "value"]);
    expect(table.rows[0]).toEqual(["ID001", "1 234,50", "9"]);
    const settings = initialDataSettings(table);
    expect(settings.types).toEqual(["text", "text", "text"]);
    expect(dataNumber("1 234,50")).toBe(1234.5);
    expect(dataNumber("1\u00a0234,50")).toBe(1234.5);
    expect(dataNumber("-17,5")).toBe(-17.5);
    expect(dataNumber("1,234.50")).toBeNull();
    expect(dataNumber("1.234,50")).toBeNull();
    settings.types[1] = "number";
    settings.measure = 1;
    settings.group = 0;
    const result = queryData(table, settings);
    expect(result.stats).toMatchObject({
      scanned: 4,
      count: 2,
      missing: 1,
      invalid: 1,
      sum: 1237,
      mean: 618.5
    });
    expect(result.groups.map((g) => g.key)).toEqual(["ID001", "001", "ABC", "EMPTY"]);
    const saved = workspaceBlob("test", table, settings);
    const streamed = await exportWorkspace("test", table, settings, new AbortController().signal);
    const reloaded = parseDataWorkspace(await streamed.text());
    expect(parseDataWorkspace(await saved.text()).settings).toEqual(reloaded.settings);
    expect(reloaded.table.headers).toEqual(["id", "value", "value"]);
    expect(reloaded.table.rows[1]![0]).toBe("001");
  });

  it("rejects oversized input BEFORE parsing and invalid workspace schemas", async () => {
    await expect(preflightDataCsv("a,".repeat(101) + "\nx")).rejects.toThrow("100 столбцов");
    await expect(preflightDataCsv("x,y\n" + "x,y\n".repeat(DATA_LIMITS.rows + 1))).rejects.toThrow(
      "80 000 строк"
    );
    await expect(preflightDataCsv("x,".repeat(19) + "y\n" + "a\n".repeat(55_000))).rejects.toThrow(
      "1 млн ячеек"
    );
    expect(() => parseDataWorkspace('{"schema":"other","version":1}')).toThrow();
    const t = await loadDataCsv("x,y\n1,2");
    const s = initialDataSettings(t);
    const bad = parseDataWorkspace(await workspaceBlob("w", t, s).text());
    bad.table.rows.push(["only one"]);
    expect(() => parseDataWorkspace(JSON.stringify(bad))).toThrow("строка");
  });

  it("sorts stably by X for lines, builds real scatter and bar, filters and groups", async () => {
    const t = await loadDataCsv("x,y,g\n9,50,A\n2,10,A\n2,20,B\n5,40,B\nBAD,0,C\n,0,C");
    const s = initialDataSettings(t);
    s.types = ["number", "number", "text"];
    s.measure = 1;
    s.group = 2;
    s.chart = { kind: "line", x: 0, y: 1 };
    let r = queryData(t, s);
    expect(r.plot.points.map((v) => v.x)).toEqual([2, 2, 5, 9]);
    expect(r.plot.points.filter((v) => v.x === 2).map((v) => v.row)).toEqual([1, 2]);
    expect(r.plot).toMatchObject({ valid: 4, missing: 1, invalid: 1 });
    expect(r.groups[0]?.stats.sum).toBe(60);
    s.chart.kind = "scatter";
    r = queryData(t, s);
    expect(dataSvg(r.plot.points, "plot", "x", "y", "scatter").match(/<circle/g)).toHaveLength(4);
    expect(dataSvg(r.plot.points, "plot", "x", "y", "bar").match(/<rect x=/g)).toHaveLength(4);
    s.filters = [{ column: 2, operator: "equals", value: "b" }];
    s.sort = { column: 0, direction: "asc" };
    expect(queryData(t, s).indexes).toEqual([2, 3]);
  });

  it("prevents spreadsheet injection after whitespace and exports entire selected table", async () => {
    for (const dangerous of ["=1+1", "\t+cmd", " \n@HYPERLINK(1)", "\ufeff-2", "\u200B＝1"])
      expect(safeSpreadsheetCell(dangerous)).toBe("'" + dangerous);
    expect(csvField(' "=1"')).toBe('" ""=1"""');
    const t = await loadDataCsv('id,id\nAA," =SUM(1)"\nBB,"\t@cmd"\nCC,normal');
    const s = initialDataSettings(t);
    const r = queryData(t, s);
    const csv = await (
      await exportData(t, r.indexes, s, "csv", new AbortController().signal)
    ).text();
    expect(csv).toContain("' =SUM(1)");
    expect(csv).toContain("'\t@cmd");
    expect(csv.split("\r\n").length).toBe(5);
    const json: unknown = JSON.parse(
      await (await exportData(t, r.indexes, s, "json", new AbortController().signal)).text()
    );
    expect(json).toMatchObject({
      columns: [
        { index: 0, name: "id", type: "text" },
        { index: 1, name: "id", type: "text" }
      ],
      rows: t.rows
    });
    expect(dataReport("sample", t, s, r)).toContain("Строк после фильтров: 3");
  });

  it("attachment uses UTF-8 BYTES and only complete rows, reports truncation; cancel prevents export", async () => {
    const t = await loadDataCsv("a,b\n" + "😀,test\n".repeat(20));
    const s = initialDataSettings(t);
    const r = queryData(t, s);
    const attachment = attachmentData(t, r.indexes, s.columns, 45, 60);
    expect(attachment.truncated).toBe(true);
    expect(attachment.includedRows).toBeGreaterThan(0);
    expect(attachment.content.split("\n")).toHaveLength(attachment.includedRows + 1);
    expect(new TextEncoder().encode(attachment.content).length).toBeLessThanOrEqual(45);
    const cancel = new AbortController();
    cancel.abort();
    await expect(exportData(t, r.indexes, s, "csv", cancel.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
    const many = await loadDataCsv("id,value\n" + "a,1\n".repeat(2_000));
    const large = initialDataSettings(many);
    const indexes = queryData(many, large).indexes;
    const during = new AbortController();
    await expect(
      exportData(many, indexes, large, "csv", during.signal, (rows) => {
        if (rows === 512) during.abort();
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    const duringWorkspace = new AbortController();
    await expect(
      exportWorkspace("many", many, large, duringWorkspace.signal, (rows) => {
        if (rows === 512) duringWorkspace.abort();
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("handles 80K x 10 real CSV/TSV cells and embedded multiline quoted fields", async () => {
    const source =
      Array.from({ length: 10 }, (_, i) => `h${i}`).join("\t") +
      "\n" +
      'ID001\t"две\nстроки"\t1,5\t2\t3\t4\t5\t6\t7\t8\n'.repeat(80_000);
    const checked = await preflightDataCsv(source);
    expect(checked).toMatchObject({ rows: 80_001, width: 10, delimiter: "\t" });
    const table = await loadDataCsv(source);
    expect(table.rows).toHaveLength(80_000);
    expect(table.rows[79_999]?.[1]).toBe("две\nстроки");
  });

  it("refuses export above 32MB after JSON escaping rather than silently truncating", async () => {
    const table = { delimiter: ",", headers: ["x"], rows: [["\u0000".repeat(6_000_000)]] };
    const settings = initialDataSettings(table);
    await expect(
      exportData(table, [0], settings, "json", new AbortController().signal)
    ).rejects.toThrow("32 МБ");
  });

  it("rejects unsafe integer precision, protects directional/invisible prefixes, handles extreme scatter SVG", () => {
    expect(dataNumber("9007199254740993")).toBeNull();
    expect(dataNumber("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ["\u200f=1", "\u202e+1", "\u2063－1", "\u0000@danger"])
      expect(safeSpreadsheetCell(value)).toBe("'" + value);
    const svg = dataSvg(
      [
        { x: -1e308, y: -1e308, row: 1 },
        { x: 1e308, y: 1e308, row: 2 }
      ],
      "<script>",
      "X",
      "Y",
      "scatter"
    );
    expect(svg).not.toMatch(/NaN|Infinity|<script>/u);
  });

  it("honors cancellation even at final progress before constructing a Blob", async () => {
    const table = await loadDataCsv("x,y\n1,2");
    const settings = initialDataSettings(table);
    const controller = new AbortController();
    await expect(
      exportData(table, [0], settings, "csv", controller.signal, () => controller.abort())
    ).rejects.toMatchObject({ name: "AbortError" });
    const workspaceController = new AbortController();
    await expect(
      exportWorkspace("w", table, settings, workspaceController.signal, () =>
        workspaceController.abort()
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
