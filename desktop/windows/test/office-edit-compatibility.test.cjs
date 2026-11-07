"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { input, docxFixture, ops } = require("./fixtures/office-edit-brief.cjs");
const { zip } = require("../workspace/office-document.cjs");
const { unpack, extractOfficeText, xml, attr } = require("../workspace/office-text.cjs");
const { editOffice, inspectOffice } = require("../workspace/office-edit.cjs");
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function values(bytes) {
  const cells = [],
    dimensions = [];
  xml(bytes, (e) => {
    if (e.event !== "open" || e.uri !== S) return;
    if (e.local === "c") cells.push(attr(e, "r"));
    if (e.local === "dimension") dimensions.push(attr(e, "ref"));
  });
  return { cells, dimensions };
}
function worksheet(source, rewrite) {
  const entries = unpack(source, 16000000).entries;
  const part = "xl/worksheets/sheet1.xml";
  entries.set(part, Buffer.from(rewrite(entries.get(part).toString())));
  return zip([...entries]);
}
test("existing XLSX dimension grows without losing styles, numbers or untouched parts", () => {
  const source = worksheet(input("xlsx"), (s) =>
    s.replace("<sheetData>", '<dimension ref="A1:D1"/><sheetData>')
  );
  const result = editOffice("offer.xlsx", source, [
    { kind: "set_cell", target: "sheet:1", address: "B3", value: "00123" },
    { kind: "set_cell", target: "sheet:1", address: "F2", value: { formula: "SUM(B1:B1)" } }
  ]);
  const before = unpack(source, 16000000).entries,
    after = unpack(result.buffer, 16000000).entries;
  const parsed = values(after.get("xl/worksheets/sheet1.xml"));
  assert.deepEqual(parsed.dimensions, ["A1:F3"]);
  assert.deepEqual(parsed.cells, ["A1", "B1", "C1", "D1", "F2", "B3"]);
  assert.ok(extractOfficeText("offer.xlsx", result.buffer).text.includes('"cached_value":null'));
  for (const [part, bytes] of before)
    if (part !== "xl/worksheets/sheet1.xml") assert.deepEqual(after.get(part), bytes);
});
test("empty sheetData and self-closing rows become real typed cells", () => {
  for (const body of [
    '<dimension ref="A1"/><sheetData/>',
    '<dimension ref="A1"/><sheetData><row r="2" s="1" customFormat="1"/></sheetData>'
  ]) {
    const source = worksheet(input("xlsx"), (s) =>
      s.replace(/<sheetData>[\s\S]*?<\/sheetData>/, body)
    );
    const result = editOffice("offer.xlsx", source, [
      { kind: "set_cell", target: "sheet:1", address: "B2", value: "00123" }
    ]);
    const sheet = unpack(result.buffer, 16000000).entries.get("xl/worksheets/sheet1.xml");
    assert.deepEqual(values(sheet), { cells: ["B2"], dimensions: ["A1:B2"] });
    assert.ok(extractOfficeText("offer.xlsx", result.buffer).text.includes("00123"));
    if (body.includes("customFormat"))
      assert.ok(sheet.includes(Buffer.from('s="1" customFormat="1"')));
  }
});
test("new cells remain in SpreadsheetML when a row shadows the parent prefix", () => {
  const source = worksheet(
    input("xlsx"),
    () =>
      `<x:worksheet xmlns:x="${S}"><x:dimension ref="A1"/><x:sheetData><s:row xmlns:s="${S}" xmlns:x="urn:untrusted-alias" r="1"/></x:sheetData></x:worksheet>`
  );
  const result = editOffice("offer.xlsx", source, [
    { kind: "set_cell", target: "sheet:1", address: "B1", value: "00123" }
  ]);
  const sheet = unpack(result.buffer, 16000000).entries.get("xl/worksheets/sheet1.xml");
  assert.deepEqual(values(sheet), { cells: ["B1"], dimensions: ["A1:B1"] });
  assert.ok(extractOfficeText("offer.xlsx", result.buffer).text.includes("00123"));
});
test("malformed dimensions and out-of-order cell coordinates fail before a result", () => {
  for (const ref of ["XFE1", "A0", "A1:Z0", "D2:A1", "A1:B2:C3"]) {
    const source = worksheet(input("xlsx"), (s) =>
      s.replace("<sheetData>", `<dimension ref="${ref}"/><sheetData>`)
    );
    assert.throws(() =>
      editOffice("offer.xlsx", source, [
        { kind: "set_cell", target: "sheet:1", address: "B2", value: 1 }
      ])
    );
  }
  const source = worksheet(input("xlsx"), (s) => s.replace('r="B1"', 'r="B2"'));
  assert.throws(() =>
    editOffice("offer.xlsx", source, [
      { kind: "set_cell", target: "sheet:1", address: "B2", value: 1 }
    ])
  );
});
for (const encoding of ["utf16le", "utf16be", "utf8bom"])
  test(`edits preserve ${encoding} XML encoding and untouched Office parts`, () => {
    const bom = Buffer.from(
      encoding === "utf16le"
        ? [0xff, 0xfe]
        : encoding === "utf16be"
          ? [0xfe, 0xff]
          : [0xef, 0xbb, 0xbf]
    );
    for (const format of ["docx", "xlsx", "pptx"]) {
      const entries = unpack(format === "docx" ? docxFixture() : input(format), 16000000).entries;
      for (const [name, bytes] of entries)
        if (/\.(xml|rels)$/.test(name)) {
          const source = bytes
            .toString()
            .replace(
              /encoding="UTF-8"/,
              `encoding="${encoding === "utf8bom" ? "UTF-8" : "UTF-16"}"`
            );
          const encoded = Buffer.from(source, encoding === "utf8bom" ? "utf8" : "utf16le");
          if (encoding === "utf16be") encoded.swap16();
          entries.set(name, Buffer.concat([bom, encoded]));
        }
      const source = zip([...entries]);
      const result = editOffice("offer." + format, source, ops[format]);
      const after = unpack(result.buffer, 16000000).entries;
      const touched =
        format === "docx"
          ? ["word/document.xml"]
          : format === "pptx"
            ? ["ppt/slides/slide1.xml"]
            : ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"];
      for (const part of touched) assert.deepEqual(after.get(part).subarray(0, bom.length), bom);
      for (const [part, bytes] of entries)
        if (!touched.includes(part)) assert.deepEqual(after.get(part), bytes);
      const text = extractOfficeText("offer." + format, result.buffer).text;
      for (const value of ["00123", "07.11.2026", "кроме доставки"])
        assert.ok(text.includes(value));
      assert.ok(inspectOffice("offer." + format, result.buffer).targets.length);
    }
  });
test("shared-string preview shows actual leading-zero text and leaves the shared source intact", () => {
  const entries = unpack(input("xlsx"), 16000000).entries;
  const sheetPart = "xl/worksheets/sheet1.xml",
    relPart = "xl/_rels/workbook.xml.rels";
  entries.set(
    sheetPart,
    Buffer.from(
      `<worksheet xmlns="${S}"><dimension ref="A1:B1"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>`
    )
  );
  entries.set(
    "xl/sharedStrings.xml",
    Buffer.from(`<sst xmlns="${S}" count="2" uniqueCount="1"><si><t>00123</t></si></sst>`)
  );
  entries.set(
    relPart,
    Buffer.from(
      entries
        .get(relPart)
        .toString()
        .replace(
          "</Relationships>",
          '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
        )
    )
  );
  const source = zip([...entries]);
  const result = editOffice("offer.xlsx", source, [
    { kind: "set_cell", target: "sheet:1", address: "A1", value: "Код обновлён" }
  ]);
  assert.equal(result.diff[0].before, "00123");
  const after = unpack(result.buffer, 16000000).entries;
  assert.deepEqual(after.get("xl/sharedStrings.xml"), entries.get("xl/sharedStrings.xml"));
  const cells = inspectOffice("offer.xlsx", result.buffer).targets[0].cells;
  assert.equal(cells.find((c) => c.address === "B1").text, "00123");
  assert.equal(cells.find((c) => c.address === "A1").text, "Код обновлён");
});
test("adding a sheet chooses a free relationship ID and refuses malformed sheet IDs", () => {
  const entries = unpack(input("xlsx"), 16000000).entries;
  const rel = "xl/_rels/workbook.xml.rels",
    book = "xl/workbook.xml";
  entries.set(
    rel,
    Buffer.from(
      entries
        .get(rel)
        .toString()
        .replace(
          "</Relationships>",
          '<Relationship Id="koswork2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>'
        )
    )
  );
  const result = editOffice("brief.xlsx", zip([...entries]), [
    { kind: "add_sheet", name: "Added" }
  ]);
  assert.equal(inspectOffice("brief.xlsx", result.buffer).total_targets, 2);
  assert.ok(
    unpack(result.buffer, 16000000).entries.get(rel).includes(Buffer.from('Id="koswork2_1"'))
  );
  for (const id of ["bad", "0", "2147483647"]) {
    const bad = new Map(entries);
    bad.set(
      book,
      Buffer.from(entries.get(book).toString().replace('sheetId="1"', `sheetId="${id}"`))
    );
    assert.throws(() =>
      editOffice("brief.xlsx", zip([...bad]), [{ kind: "add_sheet", name: "Added" }])
    );
  }
});
test("selected text containing comments or CDATA is refused instead of deleting untouched markup", () => {
  for (const replacement of ["Компания<!--retain--> А", "<![CDATA[Компания А]]>"]) {
    const entries = unpack(input("docx"), 16000000).entries;
    entries.set(
      "word/document.xml",
      Buffer.from(entries.get("word/document.xml").toString().replace("Компания А", replacement))
    );
    const source = zip([...entries]),
      original = Buffer.from(source);
    assert.throws(
      () =>
        editOffice("brief.docx", source, [
          { kind: "replace_text", target: "paragraph:3", find: "Компания А", replace: "Компания Б" }
        ]),
      /UNSUPPORTED/
    );
    assert.deepEqual(source, original);
  }
});
