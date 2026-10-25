import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { SafeXlsxZip, inspectXlsx, importXlsxSheet } from "./studio-data-xlsx-import";
import { exportDataXlsx } from "./studio-data-xlsx";
import { initialDataSettings } from "./studio-data-core";

const header = '<?xml version="1.0" encoding="UTF-8"?>';
const relBase = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function fixture(
  worksheet: string,
  names = ["Первый", "Второй"],
  extra: Record<string, string> = {}
) {
  const sheets = names
    .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  const rels = names
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${relBase}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`${header}<Types/>`),
    "_rels/.rels": strToU8(
      `${header}<Relationships><Relationship Id="rId1" Type="${relBase}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `${header}<workbook xmlns:r="${relBase}"><sheets>${sheets}</sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(`${header}<Relationships>${rels}</Relationships>`),
    ...Object.fromEntries(
      names.map((_, i) => [
        `xl/worksheets/sheet${i + 1}.xml`,
        strToU8(`${header}<worksheet><sheetData>${worksheet}</sheetData></worksheet>`)
      ])
    ),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)]))
  };
  return zipSync(files, { level: 1 });
}
const sample = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><r><t>дубль</t></r></is></c></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="inlineStr"><is><r><t>А&amp;Б</t></r><r><t>✨</t></r></is></c></row>
<row r="4"><c r="A4"><f>7+9</f><v>16</v></c><c r="C4"><f>UNKNOWN()</f></c></row>`;
const extra = {
  "xl/sharedStrings.xml": `<sst><si><t>дубль</t></si><si><r><t>ID001</t></r><r><t>_x005F_x0041_</t></r></si></sst>`
};

describe("local XLSX import", () => {
  it("requires sheet selection for multisheet, preserves gaps, rich/escaped Unicode, duplicate headers and cache-only formulas", () => {
    const zip = new SafeXlsxZip(fixture(sample, ["Первый", "Второй"], extra));
    const index = inspectXlsx(zip);
    expect(index.sheets.map((s) => s.name)).toEqual(["Первый", "Второй"]);
    const data = importXlsxSheet(zip, index, 1, 1);
    expect(data.table.headers).toEqual(["дубль", "Столбец 2", "дубль"]);
    expect(data.table.rows).toEqual([
      ["ID001_x0041_", "TRUE", "А&Б✨"],
      ["", "", ""],
      ["16", "", "=UNKNOWN()"]
    ]);
    expect([data.formulaCached, data.formulaUncached]).toEqual([1, 1]);
  });
  it("changes header row and rejects out-of-range selection without truncation", () => {
    const zip = new SafeXlsxZip(fixture(sample, ["Данные"], extra));
    const index = inspectXlsx(zip);
    expect(importXlsxSheet(zip, index, 0, 2).table.rows).toHaveLength(2);
    expect(() => importXlsxSheet(zip, index, 1, 1)).toThrow();
    expect(() => importXlsxSheet(zip, index, 0, 80_001)).toThrow();
  });
  it("rejects encrypted, duplicated, unsafe and oversized XML ZIP packages", () => {
    const basic = fixture(sample, ["Данные"], extra);
    const duplicated = new Uint8Array(basic);
    const view = new DataView(duplicated.buffer);
    // Altered local header flags contradict central directory.
    view.setUint16(6, 1, true);
    expect(() => new SafeXlsxZip(duplicated)).toThrow();
    const forbidden = fixture(sample, ["Данные"], {
      ...extra,
      "xl/externalLinks/externalLink1.xml": "evil"
    });
    expect(() => new SafeXlsxZip(forbidden)).toThrow();
    const dtd = fixture(sample, ["Данные"], {
      "xl/sharedStrings.xml": '<!DOCTYPE x [<!ENTITY boom "data">]><sst/>'
    });
    const zip = new SafeXlsxZip(dtd);
    expect(() => importXlsxSheet(zip, inspectXlsx(zip), 0, 1)).toThrow(/DTD/);
  });
  it("makes a roundtrip through the existing Excel exporter", async () => {
    const table = {
      delimiter: ",",
      headers: ["ID", "Сумма", "Сумма"],
      rows: [
        ["ID001", "12,5", "12,5"],
        ["0002", "", "-7"]
      ]
    };
    const settings = initialDataSettings(table);
    settings.types[1] = "number";
    settings.types[2] = "number";
    const blob = await exportDataXlsx(table, [0, 1], settings, new AbortController().signal);
    const zip = new SafeXlsxZip(await blob.arrayBuffer());
    const parsed = importXlsxSheet(zip, inspectXlsx(zip), 0, 1);
    expect(parsed.table.headers).toEqual(table.headers);
    expect(parsed.table.rows).toEqual([
      ["ID001", "12.5", "12.5"],
      ["0002", "", "-7"]
    ]);
  });
});
