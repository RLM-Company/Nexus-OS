"use strict";
const { zip, esc } = require("../../workspace/office-document.cjs");
const { unpack } = require("../../workspace/office-text.cjs");
const { input } = require("./office-edit-brief.cjs");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function pagedWord({ paragraphs = 420, long = true } = {}) {
  const texts = Array.from(
    { length: paragraphs },
    (_, i) => `Раздел ${i + 1}: 19 700 ₽; 00123; 07.11.2026; кроме доставки. 🌙`
  );
  if (long) texts.unshift("😀".repeat(6000) + " 00123; 19 700 ₽; кроме доставки");
  const entries = unpack(input("docx"), 16000000).entries;
  entries.set(
    "word/document.xml",
    Buffer.from(
      `<w:document xmlns:w="${W}"><w:body>${texts.map((t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`
    )
  );
  return { buffer: zip([...entries]), texts };
}
function pagedSheet({ rows = 500 } = {}) {
  const entries = unpack(input("xlsx"), 16000000).entries;
  const data = Array.from(
    { length: rows },
    (_, i) =>
      `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Товар ${i + 1}: 00123, кроме доставки</t></is></c><c r="B${i + 1}" t="n"><v>19700</v></c><c r="C${i + 1}" t="b"><v>1</v></c></row>`
  ).join("");
  entries.set(
    "xl/worksheets/sheet1.xml",
    Buffer.from(
      `<worksheet xmlns="${S}"><dimension ref="A1:C${rows}"/><sheetData>${data}</sheetData></worksheet>`
    )
  );
  return { buffer: zip([...entries]), cellCount: rows * 3 };
}
module.exports = { pagedWord, pagedSheet };
