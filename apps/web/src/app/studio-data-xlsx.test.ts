import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { initialDataSettings, queryData } from "./studio-data-core";
import { exportDataXlsx, XLSX_MIME } from "./studio-data-xlsx";

const fixture = () => ({
  delimiter: ",",
  headers: ["id", "amount", "amount", "omit"],
  rows: [
    ["0001", "1 234,50", ' =HYPERLINK("https://example.com")', "private"],
    ["0002", "-7,25", "<tag>&\r\n_x0041_", "private"],
    ["0003", "1234567890123456", "emoji 🛰️", "private"],
    ["0004", "bad", "empty next", "private"],
    ["0005", "", "", "private"]
  ]
});
const unpack = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const sheet = async (blob: Blob) => strFromU8((await unpack(blob))["xl/worksheets/sheet1.xml"]!);

describe("Studio Excel export", () => {
  it("preserves selected order, duplicate headings, explicit numbers, IDs and literal formula text", async () => {
    const table = fixture();
    const settings = initialDataSettings(table);
    settings.types[1] = "number";
    settings.columns = [2, 0, 1];
    const output = await exportDataXlsx(
      table,
      [1, 0, 2, 3, 4],
      settings,
      new AbortController().signal
    );
    expect(output.type).toBe(XLSX_MIME);
    const files = await unpack(output);
    expect(Object.keys(files).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml"
      ].sort()
    );
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">0002</t>');
    expect(xml).toContain('<c r="C2" t="n"><v>-7.25</v></c>');
    expect(xml).toContain('<c r="C3" t="n"><v>1234.5</v></c>');
    expect(xml).toContain('xml:space="preserve">1234567890123456</t>');
    expect(xml).toContain('xml:space="preserve">bad</t>');
    expect(xml).toContain('xml:space="preserve"></t>');
    expect(xml).toContain(' =HYPERLINK("https://example.com")');
    expect(xml).toContain("&lt;tag&gt;&amp;&#13;\n_x005F_x0041_");
    expect(xml).toContain("emoji 🛰️");
    expect(xml).not.toMatch(/<f[ >]|<hyperlink/);
    expect(xml).not.toContain("private");
    expect(xml.match(/>amount<\/t>/g)).toHaveLength(2);
    expect(xml).toContain('<autoFilter ref="A1:C6"/>');
    expect(xml).toContain('state="frozen"');
    expect(strFromU8(files["xl/_rels/workbook.xml.rels"]!)).not.toContain('TargetMode="External"');
  });

  it("exports every filtered and sorted row beyond the preview page and names columns past Z", async () => {
    const table = {
      delimiter: ",",
      headers: Array.from({ length: 100 }, (_, i) => "h" + i),
      rows: Array.from({ length: 700 }, (_, i) => Array.from({ length: 100 }, () => String(i)))
    };
    const settings = initialDataSettings(table);
    settings.types[0] = "number";
    settings.filters = [{ column: 0, operator: "greater", value: "300" }];
    settings.sort = { column: 0, direction: "desc" };
    const result = queryData(table, settings);
    const progress: number[] = [];
    const xml = await sheet(
      await exportDataXlsx(table, result.indexes, settings, new AbortController().signal, (n) =>
        progress.push(n)
      )
    );
    expect(xml.match(/<row /g)).toHaveLength(401);
    expect(xml).toContain('<c r="A2" t="n"><v>699</v></c>');
    expect(xml).toContain('<c r="A401" t="n"><v>300</v></c>');
    expect(xml).toContain('r="CV401"');
    expect(xml).toContain('ref="A1:CV401"');
    expect(progress).toEqual([256, 400]);
  });

  it("allows header-only results and preserves an empty string cell", async () => {
    const table = fixture();
    const xml = await sheet(
      await exportDataXlsx(table, [], initialDataSettings(table), new AbortController().signal)
    );
    expect(xml.match(/<row /g)).toHaveLength(1);
    expect(xml).toContain('ref="A1:D1"');
  });

  it("rejects oversized cells and XML-incompatible characters without truncation", async () => {
    for (const value of ["x".repeat(32768), "bad\u0000cell", "bad\ud800cell", "bad\ufffecell"]) {
      const table = { delimiter: ",", headers: ["value"], rows: [[value]] };
      await expect(
        exportDataXlsx(table, [0], initialDataSettings(table), new AbortController().signal)
      ).rejects.toThrow(/XLSX/);
    }
  });

  it("cancels a large export between chunks and rejects invalid selection indexes", async () => {
    const table = {
      delimiter: ",",
      headers: ["id"],
      rows: Array.from({ length: 1000 }, (_, i) => [String(i)])
    };
    const controller = new AbortController();
    await expect(
      exportDataXlsx(
        table,
        table.rows.map((_, i) => i),
        initialDataSettings(table),
        controller.signal,
        () => controller.abort()
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      exportDataXlsx(table, [1000], initialDataSettings(table), new AbortController().signal)
    ).rejects.toThrow("выборка");
    await expect(
      exportDataXlsx(table, [-1], initialDataSettings(table), new AbortController().signal)
    ).rejects.toThrow("выборка");
  });

  it("enforces the expanded XML budget before producing any workbook", async () => {
    const table = {
      delimiter: ",",
      headers: ["value"],
      rows: Array.from({ length: 250 }, () => ["&".repeat(32000)])
    };
    await expect(
      exportDataXlsx(
        table,
        table.rows.map((_, i) => i),
        initialDataSettings(table),
        new AbortController().signal
      )
    ).rejects.toThrow("32 МБ");
  });
});
