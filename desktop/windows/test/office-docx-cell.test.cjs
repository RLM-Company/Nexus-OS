"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { unpack, extractOfficeText } = require("../workspace/office-text.cjs");
const { editOffice, inspectOffice } = require("../workspace/office-edit.cjs");
const { zip } = require("../workspace/office-document.cjs");
const { docxFixture } = require("./fixtures/office-edit-brief.cjs");

function fixture() {
  const { entries } = unpack(docxFixture(), 16000000);
  let source = entries.get("word/document.xml").toString();
  // Replace the first table with a richer one: multi-run and multi-paragraph cells.
  source = source.replace(
    /<w:tbl>[\s\S]*?<\/w:tbl>/,
    "<w:tbl>" +
      "<w:tr>" +
      '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Старая</w:t></w:r><w:r><w:t xml:space="preserve"> цена</w:t></w:r></w:p><w:p><w:r><w:t>вторая строка</w:t></w:r></w:p></w:tc>' +
      "<w:tc><w:p><w:r><w:t>00123</w:t></w:r></w:p></w:tc>" +
      "</w:tr>" +
      "</w:tbl>"
  );
  entries.set("word/document.xml", Buffer.from(source));
  return zip([...entries]);
}

test("set_docx_cell replaces a whole table cell, keeps run style and all other parts", () => {
  const source = fixture();
  const before = unpack(source, 16000000).entries;
  const result = editOffice("offer.docx", source, [
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: "Новая цена" }
  ]);
  const after = unpack(result.buffer, 16000000).entries;
  assert.deepEqual(result.diff, [
    {
      kind: "set_docx_cell",
      target: "table:1/row:1/cell:1",
      value: "Новая цена",
      before: "Старая ценавторая строка",
      after: "Новая цена"
    }
  ]);
  // Style node of the first run survives; obsolete runs are blanked.
  const doc = after.get("word/document.xml").toString();
  assert.ok(doc.includes("<w:rPr><w:b/></w:rPr>"));
  assert.ok(doc.includes("Новая цена"));
  assert.ok(!doc.includes("Старая"));
  assert.ok(!doc.includes("вторая строка"));
  // Untouched neighbour cell and every other package part are byte-identical.
  assert.ok(doc.includes("00123"));
  for (const [part, bytes] of before) {
    if (part === "word/document.xml") continue;
    assert.deepEqual(after.get(part), bytes, part);
  }
  const text = extractOfficeText("offer.docx", result.buffer).text;
  assert.ok(text.includes("Новая цена"));
  assert.ok(text.includes("00123"));
  assert.equal(inspectOffice("offer.docx", result.buffer).version, result.version);
});

test("set_docx_cell rejects wrong targets, unsupported objects and invalid values", () => {
  const source = fixture();
  for (const [index, operation] of [
    { kind: "set_docx_cell", target: "paragraph:1", value: "x" },
    { kind: "set_docx_cell", target: "table:9/row:1/cell:1", value: "x" },
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: "line\nbreak" },
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: { formula: "SUM(A1)" } },
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1" }
  ].entries())
    assert.throws(() => editOffice("offer.docx", source, [operation]), `op ${index}`);
});

test("multiple cells can be changed in one versioned plan", () => {
  const source = fixture();
  const result = editOffice("offer.docx", source, [
    { kind: "set_docx_cell", target: "table:1/row:1/cell:1", value: "Итого" },
    { kind: "set_docx_cell", target: "table:1/row:1/cell:2", value: "00456" },
    { kind: "replace_text", target: "paragraph:3", find: "Компания А", replace: "Компания Б" }
  ]);
  assert.equal(result.diff.length, 3);
  const text = extractOfficeText("offer.docx", result.buffer).text;
  assert.ok(text.includes("Итого"));
  assert.ok(text.includes("00456"));
  assert.ok(text.includes("Компания Б"));
  assert.ok(text.includes("19 700"));
});
