"use strict";
const { buildOfficeDocument, zip } = require("../../workspace/office-document.cjs");
const { unpack } = require("../../workspace/office-text.cjs");
const brief = "19 700 ₽; 00123; 07.11.2026; кроме доставки";
const input = (format) =>
  buildOfficeDocument(
    format === "docx"
      ? {
          kind: "workspace_create_docx",
          path: "offer.docx",
          title: "Предложение",
          sections: [{ heading: "Реквизиты", text: "Компания А — " + brief }]
        }
      : format === "xlsx"
        ? {
            kind: "workspace_create_xlsx",
            path: "offer.xlsx",
            sheets: [
              { name: "Предложение", rows: [["00123", 19700, "кроме доставки", "07.11.2026"]] }
            ]
          }
        : {
            kind: "workspace_create_pptx",
            path: "offer.pptx",
            title: "Предложение",
            slides: [
              { title: "Компания А", text: brief },
              { title: "Без правок", text: brief }
            ]
          }
  ).buffer;
function docxFixture() {
  const { entries } = unpack(input("docx"), 16000000);
  let source = entries.get("word/document.xml").toString();
  source = source.replace(
    "Компания А",
    'Компания</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> А'
  );
  source = source.replace(
    "<w:sectPr>",
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>00123</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>19 700 ₽</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr>`
  );
  entries.set("word/document.xml", Buffer.from(source));
  entries.set("word/media/test.bin", Buffer.from([0, 128, 255]));
  return zip([...entries]);
}
const ops = {
  docx: [
    { kind: "replace_text", target: "paragraph:3", find: "Компания А", replace: "Компания Б" },
    {
      kind: "replace_text",
      target: "table:1/row:1/cell:2",
      find: "19 700",
      replace: "19 700 за комплект"
    }
  ],
  xlsx: [
    { kind: "add_sheet", name: "Итог" },
    { kind: "set_cell", target: "sheet:2", address: "A1", value: "00123" },
    { kind: "set_cell", target: "sheet:2", address: "B1", value: 19700 },
    { kind: "set_cell", target: "sheet:2", address: "B2", value: { formula: "SUM(B1:B1)" } }
  ],
  pptx: [
    { kind: "replace_text", target: "slide:1/shape:2", find: "Компания А", replace: "Компания Б" }
  ]
};

module.exports = { input, docxFixture, ops };
