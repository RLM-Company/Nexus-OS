"use strict";

const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { assetPath } = require("../document-reader/host.cjs");

async function module() {
  return import(
    pathToFileURL(path.join(__dirname, "..", "document-reader", "ocr-layout.mjs")).href
  );
}

// Synthetic word boxes: words are positioned on a 1000px-wide page.
function makeWord(text, x, y, width, height = 14) {
  return { text, bbox: { x0: x, y0: y, x1: x + width, y1: y + height } };
}
// Wrap visual lines into the Tesseract block hierarchy shape.
const toBlocks = (lines) => lines.map((line) => ({ paragraphs: [{ lines: [{ words: line }] }] }));

test("invoice-like aligned rows become tab-separated table rows", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  // 4 aligned rows of 4 cells; each cell has two tokens (small intra gap 8px)
  // and columns share boundaries at x=150/290/430 (boundary gap ≈42px).
  const words = [
    ["Дата Свидетельство", "Счёт Номер", "Сумма Рублей", "Поставка Условие"],
    ["01.11.2026 хозяйственный", "00123 ординарный", "19700 ноль", "кроме доставки"],
    ["02.11.2026 хозяйственный", "00124 ординарный", "0900 ноль", "предоплата товара"],
    ["03.11.2026 хозяйственный", "00125 ординарный", "19700 ноль", "кроме доставки"]
  ].map((row, rowIndex) =>
    row
      .map((cell, index) => {
        const [first, second] = cell.split(" ");
        return [
          makeWord(first, 10 + index * 140, 40 + rowIndex * 20, 50),
          makeWord(second, 68 + index * 140, 40 + rowIndex * 20, 40)
        ];
      })
      .flat()
  );
  const flat = collectOcrWords(toBlocks(words));
  assert.equal(flat.length, 32);
  const layout = layoutFromWords(flat, { maxText: 180000 });
  assert.ok(layout, "a consistent grid must be recognized");
  assert.equal(layout.kind, "table");
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 4);
  const rows = layout.text.split("\n").filter((line) => line);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const cells = row.split("\t");
    assert.equal(cells.length, 4, `row cells: ${row}`);
  }
  assert.match(layout.text, /00123 ординарный/);
  assert.match(layout.text, /19700 ноль/);
  assert.match(layout.text, /кроме доставки/);
});

test("plain paragraphs without a shared grid keep engine text (null layout)", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  const words = [
    "Космора использует локальное чтение документов.",
    "Результат содержит только текст выбранной страницы.",
    "Структура таблиц не гарантируется без координат.",
    "Handwriting remains outside the reader contract."
  ].map((sentence, index) =>
    sentence
      .split(" ")
      .map((word, position) => makeWord(word, 10 + position * 64, 40 + index * 20, 58))
  );
  const flat = collectOcrWords(toBlocks(words));
  const layout = layoutFromWords(flat, { maxText: 180000 });
  assert.equal(layout, null, "regular prose must not be re-formatted");
});

test("rows that miss a cell fall out of the grid and stay plain", async () => {
  const { layoutFromWords, collectOcrWords } = await module();
  // Three aligned rows + one shifted row whose boundary does not match.
  const rows = [
    ["Имя", "Значение"],
    ["Счёт", "19700"],
    ["Валюта", "RUB"],
    ["Смещённая строка без привязки к сетке таблицы"]
  ];
  const words = [
    ...rows
      .slice(0, 3)
      .map((cells, i) => cells.map((text, j) => makeWord(text, 10 + j * 150, 40 + i * 20, 80))),
    ["Смещённая", "строка", "без", "привязки", "к", "сетке", "таблицы"].map((text, j) =>
      makeWord(text, 10 + j * 70, 40 + 3 * 20, 60)
    )
  ];
  const flat = collectOcrWords(toBlocks(words));
  const layout = layoutFromWords(flat, { maxText: 180000 });
  assert.ok(layout, "three aligned rows still build a table");
  const rows2 = layout.text.split("\n").filter((line) => line);
  assert.equal(rows2.length, 4);
  assert.equal(rows2[3].split("\t").length, 1, "mismatched row stays plain");
});

test("a row missing one anchored column keeps empty column slots", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  // Three exact rows of four cells plus one row whose third column produced
  // no word: its remaining runs anchor to boundaries 150/290/430, so the row
  // keeps its slots with one empty column. Nothing is merged or invented.
  const gridRows = [
    ["Дата Свидетельство", "Счёт Номер", "Сумма Рублей", "Поставка Условие"],
    ["01.11.2026 хозяйственный", "00123 ординарный", "19700 ноль", "кроме доставки"],
    ["02.11.2026 хозяйственный", "00124 ординарный", "0900 ноль", "предоплата товара"]
  ].map((row, rowIndex) =>
    row
      .map((cell, index) => {
        const [first, second] = cell.split(" ");
        return [
          makeWord(first, 10 + index * 140, 40 + rowIndex * 20, 50),
          makeWord(second, 68 + index * 140, 40 + rowIndex * 20, 40)
        ];
      })
      .flat()
  );
  const sparse = [
    makeWord("Итог", 10, 100, 60),
    makeWord("Счёт", 150, 100, 60),
    makeWord("Доставка", 430, 100, 60)
  ];
  const flat = collectOcrWords(toBlocks([...gridRows, sparse]));
  const layout = layoutFromWords(flat, { maxText: 180000 });
  assert.ok(layout, "an anchored sparse row must stay in the grid");
  assert.equal(layout.rows, 4);
  const rows = layout.text.split("\n").filter((line) => line);
  assert.equal(rows.length, 4);
  const sparseCells = rows[3].split("\t");
  assert.deepEqual(sparseCells.slice(0, 2), ["Итог", "Счёт"]);
  assert.equal(sparseCells[2], "", "unobserved column stays empty");
  assert.equal(sparseCells[3], "Доставка");
  // No word is lost: every token of the input appears in the rebuilt text.
  for (const token of flat.map((word) => word.text)) assert.ok(layout.text.includes(token), token);
});

test("unanchored or too sparse rows fall back to plain line text", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  // Six-column grid of four exact rows plus two odd lines: one with a single
  // distant pair (too sparse for k=6) and one whose middle run anchors to no
  // boundary. Both must keep plain text.
  const gridRows = [
    ["Дата Число", "Счёт Номер", "Сумма Валюта", "Срок Дата", "Код Марка", "Прим Итог"],
    [
      "01.11.2026 осень",
      "00123 ординарный",
      "19700 ноль",
      "05.12.2026 зима",
      "К01 марка",
      "кроме доставки"
    ],
    [
      "02.11.2026 осень",
      "00124 ординарный",
      "0900 ноль",
      "06.12.2026 зима",
      "К02 марка",
      "предоплата товара"
    ],
    [
      "03.11.2026 осень",
      "00125 ординарный",
      "19700 ноль",
      "07.12.2026 зима",
      "К03 марка",
      "кроме доставки"
    ]
  ].map((row, rowIndex) =>
    row
      .map((cell, index) => {
        const [first, second] = cell.split(" ");
        return [
          makeWord(first, 10 + index * 140, 40 + rowIndex * 20, 50),
          makeWord(second, 68 + index * 140, 40 + rowIndex * 20, 40)
        ];
      })
      .flat()
  );
  const distant = [makeWord("А", 10, 120, 50), makeWord("Я", 710, 120, 50)];
  const unanchored = [
    makeWord("А", 10, 140, 50),
    makeWord("Б", 200, 140, 50),
    makeWord("Г", 430, 140, 50)
  ];
  const flat = collectOcrWords(toBlocks([...gridRows, distant, unanchored]));
  const layout = layoutFromWords(flat, { maxText: 180000 });
  assert.ok(layout, "exact rows alone must build the table");
  assert.equal(layout.columns, 6);
  assert.equal(layout.rows, 4, "sparse guesses must not count as grid rows");
  const rows = layout.text.split("\n").filter((line) => line);
  assert.equal(rows.length, 6);
  assert.ok(!rows[4].includes("\t"), "too sparse line stays plain");
  assert.ok(!rows[5].includes("\t"), "unanchored line stays plain");
});

test("collectOcrWords drops invalid entries and keeps x order", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  const blocks = [
    null,
    { paragraphs: null },
    {
      paragraphs: [
        null,
        {
          lines: [
            null,
            {},
            {
              words: [
                { text: "", bbox: { x0: 10, y0: 0, x1: 30, y1: 14 } },
                { text: "Б", bbox: { x0: 50, y0: 0, x1: 70, y1: 14 } },
                { text: "А", bbox: { x0: 20, y0: 0, x1: 40, y1: 14 } },
                { text: "NaN", bbox: { x0: NaN, y0: 0, x1: 30, y1: 14 } },
                { text: "деgenerate", bbox: { x0: 50, y0: 0, x1: 50, y1: 14 } },
                {
                  text: "В",
                  bbox: { x0: 90, y0: -1, x1: 110, y1: 14 }
                }
              ]
            }
          ]
        }
      ]
    }
  ];
  const words = collectOcrWords(blocks);
  assert.deepEqual(
    words.map((word) => word.text),
    ["А", "Б"],
    "only valid words survive"
  );
  assert.equal(layoutFromWords(words), null, "two words cannot form a table");
});

test("oversize or degenerate input is refused to keep the engine text", async () => {
  const { collectOcrWords, layoutFromWords } = await module();
  assert.equal(layoutFromWords([]), null);
  assert.equal(layoutFromWords(new Array(5001).fill(makeWord("а", 0, 0, 10))), null);
  // maxText smaller than the reconstructed text → refuse rather than drop words.
  const rows = [
    ["Имя", "Значение"],
    ["Счёт", "19700"],
    ["Валюта", "RUB"]
  ].map((cells, i) => cells.map((text, j) => makeWord(text, 10 + j * 150, 40 + i * 20, 80)));
  const layout = layoutFromWords(collectOcrWords(toBlocks(rows)), { maxText: 10 });
  assert.equal(layout, null);
});

// The reader host must serve the layout module beside reader.js, while
// unknown repository files stay blocked by the asset allowlist.
test("host serves ocr-layout.mjs from the document-reader allowlist", async () => {
  const root = path.join(__dirname, "..", "document-reader");
  const served = assetPath("kosmora-document://reader/ocr-layout.mjs", root, { files: {} });
  assert.ok(served, "ocr-layout.mjs must be whitelisted");
  assert.equal(path.basename(served), "ocr-layout.mjs");
  assert.equal(assetPath("kosmora-document://reader/secret.cjs", root, { files: {} }), null);
  assert.equal(assetPath("kosmora-document://reader/../package.json", root, { files: {} }), null);
});
