"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { readOffice } = require("./fixtures/independent-office-reader.cjs");
const { buildOfficeDocument, zip } = require("../workspace/office-document.cjs");
const { unpack } = require("../workspace/office-text.cjs");
const { editOffice, inspectOffice } = require("../workspace/office-edit.cjs");
const { docxFixture, ops, input } = require("./fixtures/office-edit-brief.cjs");

// The full chain: source → Work request (plan) → addressable edit → readback →
// export → reopen with an independent reader that shares no code with the
// production engine (own ZIP scanner + own XML text extraction).
test("DOCX brief: source → plan → edit → readback → export → independent reopen", () => {
  const source = docxFixture();
  const plan = [
    ...ops.docx,
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: "00124" }
  ];
  const opened = inspectOffice("offer.docx", source);
  const result = editOffice("offer.docx", source, plan);
  assert.equal(result.version, "sha256:" + result.sha256);
  assert.equal(inspectOffice("offer.docx", result.buffer).version, result.version);
  const independent = readOffice("offer.docx", result.buffer);
  assert.equal(independent.sha256, result.sha256);
  for (const value of ["Компания Б", "19 700 за комплект", "00124", "кроме доставки", "07.11.2026"])
    assert.ok(independent.text.includes(value), value);
  assert.ok(!independent.text.includes("Компания А"));
  assert.ok(independent.entries.includes("word/media/test.bin"));
  assert.deepEqual(source, docxFixture()); // source untouched
  assert.ok(opened.targets.length);
});

test("XLSX multi-sheet: add, edit each sheet, readback and independent cell reopen", () => {
  const source = input("xlsx");
  const result = editOffice("offer.xlsx", source, [
    { kind: "add_sheet", name: "Итог" },
    { kind: "set_cell", target: "sheet:1", address: "A2", value: "00123" },
    { kind: "set_cell", target: "sheet:1", address: "B2", value: { formula: "SUM(B1:B1)" } },
    {
      kind: "set_range",
      target: "sheet:2",
      start: "A1",
      rows: [
        ["Позиция", 19700],
        ["Итого", true]
      ]
    }
  ]);
  const view = inspectOffice("offer.xlsx", result.buffer);
  assert.equal(view.total_targets, 2);
  assert.equal(view.version, result.version);
  const independent = readOffice("offer.xlsx", result.buffer);
  assert.equal(independent.sha256, result.sha256);
  assert.deepEqual(independent.cells.get("1!A2"), { value: "00123", formula: null });
  assert.ok(independent.cells.get("1!B2").formula);
  assert.deepEqual(independent.cells.get("2!A2"), { value: "Итого", formula: null });
  assert.equal(independent.cells.get("2!B2").value, "1"); // boolean as stored
  // Untouched source cell remains.
  assert.deepEqual(independent.cells.get("1!A1"), { value: "00123", formula: null });
  const after = unpack(result.buffer, 16000000).entries;
  assert.deepEqual(
    after.get("xl/sharedStrings.xml"),
    unpack(source, 16000000).entries.get("xl/sharedStrings.xml")
  );
});

test("PPTX edit survives independent reopen and untouched slide stays byte-identical", () => {
  const source = input("pptx");
  const result = editOffice("offer.pptx", source, ops.pptx);
  const independent = readOffice("offer.pptx", result.buffer);
  assert.equal(independent.sha256, result.sha256);
  assert.ok(independent.text.includes("Компания Б"));
  assert.ok(independent.text.includes("00123"));
  const before = unpack(source, 16000000).entries;
  const after = unpack(result.buffer, 16000000).entries;
  assert.deepEqual(after.get("ppt/slides/slide2.xml"), before.get("ppt/slides/slide2.xml"));
});

test("CSV full chain ends in an independently parsed export with every edit", () => {
  const source = Buffer.from(
    'id,title,amount\n"00123","Company, A",19700\n002,Ünïcode,19800\n',
    "utf8"
  );
  const result = editOffice("prices.csv", source, [
    { kind: "set_cell", target: "table:1", address: "A2", value: "00456" },
    { kind: "set_cell", target: "table:1", address: "C2", value: { formula: "SUM(C1:C1)" } },
    { kind: "set_cell", target: "table:1", address: "B3", value: "=1+1" }
  ]);
  const view = inspectOffice("prices.csv", result.buffer);
  assert.equal(view.version, result.version);
  const exported = result.buffer.toString("utf8");
  // Independent check: no engine parser, only a literal split with the
  // known delimiter and the exported quoting rules.
  assert.equal(exported.split("\n").length, 3);
  const lines = exported.split("\n");
  assert.ok(lines[1].startsWith("00456,"));
  assert.ok(lines[1].endsWith(",=SUM(C1:C1)"));
  assert.ok(lines[2].startsWith("002,'=1+1,"));
  assert.ok(exported.includes('"Company, A"'));
  assert.equal(result.diff.length, 3);
  assert.deepEqual(
    source.toString("utf8"),
    'id,title,amount\n"00123","Company, A",19700\n002,Ünïcode,19800\n'
  );
});
