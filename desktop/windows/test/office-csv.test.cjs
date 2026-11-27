"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  inspectCsv,
  editCsv,
  validateCsvEdits,
  parseCsv,
  serializeCsv
} = require("../workspace/office-csv.cjs");
const { inspectOffice, editOffice, validateEdits } = require("../workspace/office-edit.cjs");
const { computeBufferVersion } = require("../workspace/version-backup.cjs");

const source =
  [
    "id,title,amount,note",
    '"00123","Company, A",19700,"кроме доставки"',
    "002,Ünïcode;随,Zwei;Zeilen,"
  ].join("\r\n") + "\n";
const bytes = Buffer.from(source, "utf8");

function read(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

test("inspect parses quoted commas, semicolons, Unicode and CRLF with versioned targets", () => {
  const view = inspectCsv("prices.csv", bytes);
  assert.equal(view.representation.kind, "office_csv");
  assert.equal(view.representation.delimiter, ",");
  assert.equal(view.representation.rows, 3);
  assert.equal(view.representation.columns, 4);
  assert.equal(view.version, computeBufferVersion(bytes).version);
  assert.equal(view.total_targets, 1);
  const cell = view.targets[0].cells.find((c) => c.address === "B2");
  assert.equal(cell.text, "Company, A");
  const unicode = view.targets[0].cells.find((c) => c.address === "A3");
  assert.equal(unicode.text, "002");
  assert.ok(read(bytes).includes("Ünïcode;随"));
});

test("addressable set_cell keeps leading zeros, numbers and booleans typed by operation, not by CSV", () => {
  const result = editCsv("prices.csv", bytes, [
    { kind: "set_cell", target: "table:1", address: "A2", value: "00456" },
    { kind: "set_cell", target: "table:1", address: "C2", value: 19800 },
    { kind: "set_cell", target: "table:1", address: "D3", value: true }
  ]);
  assert.equal(result.diff.length, 3);
  assert.equal(result.diff[0].before, "00123");
  assert.equal(result.diff[0].after, "00456");
  const table = parseCsv(read(result.buffer));
  assert.equal(table.rows[1][0], "00456");
  assert.equal(table.rows[1][2], "19800");
  assert.equal(table.rows[2][3], "TRUE");
  // Untouched cells are byte-identical.
  assert.equal(table.rows[1][1], "Company, A");
  assert.equal(table.rows[1][3], "кроме доставки");
  assert.equal(result.readback.version, result.version);
  assert.equal(result.version, computeBufferVersion(result.buffer).version);
  assert.deepEqual(bytes, Buffer.from(source, "utf8")); // source untouched
});

test("set_range writes a 2x2 block and diff shows every cell", () => {
  const result = editCsv("prices.csv", bytes, [
    {
      kind: "set_range",
      target: "table:1",
      start: "A2",
      rows: [
        ["10", "20"],
        ["30", "40"]
      ]
    }
  ]);
  assert.equal(result.diff.length, 4);
  const table = parseCsv(read(result.buffer));
  assert.deepEqual(table.rows[1].slice(0, 2), ["10", "20"]);
  assert.deepEqual(table.rows[2].slice(0, 2), ["30", "40"]);
  assert.equal(table.rows[1][3], "кроме доставки");
});

test("string values that look like formulas are escaped, explicit formulas are allowed", () => {
  const result = editCsv("prices.csv", bytes, [
    { kind: "set_cell", target: "table:1", address: "A2", value: "=1+1" },
    { kind: "set_cell", target: "table:1", address: "B3", value: { formula: "SUM(C1:C2)" } },
    { kind: "set_cell", target: "table:1", address: "C3", value: "@SUM(A1:A1)" }
  ]);
  const table = parseCsv(read(result.buffer));
  assert.equal(table.rows[1][0], "'=1+1");
  assert.equal(table.rows[2][1], "=SUM(C1:C2)");
  assert.equal(table.rows[2][2], "'@SUM(A1:A1)");
});

test("formula whitelist rejects external functions and unsafe references", () => {
  for (const formula of ['WEBSERVICE("https://x")', "SUM(A1,A1,1+1)", "=SUM(A1:A2)"]) {
    assert.throws(() =>
      editCsv("prices.csv", bytes, [
        { kind: "set_cell", target: "table:1", address: "A2", value: { formula } }
      ])
    );
  }
});

test("version conflict and explicit version on paged inspect", () => {
  assert.throws(
    () => inspectCsv("prices.csv", bytes, { expectedVersion: "sha256:" + "0".repeat(64) }),
    /VERSION_CONFLICT/
  );
  // A large table exceeds the 10 KB page budget, forcing a cursor.
  const rows = ["a,b,c,d,e,f,g,h,i,j"];
  for (let i = 0; i < 200; i++)
    rows.push(`${i},${"x".repeat(40)},${i},${i},${i},${i},${i},${i},${i},${i}`);
  const large = Buffer.from(rows.join("\n"), "utf8");
  const first = inspectCsv("large.csv", large);
  assert.ok(first.next_cursor);
  assert.throws(
    () => inspectCsv("large.csv", large, { cursor: first.next_cursor }),
    /VERSION_CONFLICT/
  );
  const second = inspectCsv("large.csv", large, {
    cursor: first.next_cursor,
    expectedVersion: first.version
  });
  assert.equal(second.version, first.version);
  assert.deepEqual(second.cursor, first.next_cursor);
});

test("rejects malformed CSV, binary bytes, extra columns and overwide plans", () => {
  for (const value of [
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from('a,b\n"unclosed', "utf8"),
    Buffer.from('a,b\n"c"x,d', "utf8"),
    Buffer.from('a,b\n"unclosed', "utf8")
  ])
    assert.throws(() => inspectCsv("bad.csv", value));
  assert.throws(() =>
    validateCsvEdits([{ kind: "set_cell", target: "sheet:1", address: "A1", value: "x" }])
  );
  assert.throws(() =>
    editCsv("prices.csv", bytes, [
      { kind: "set_range", target: "table:1", start: "A2", rows: [[1, 2, 3], [4]] }
    ])
  );
});

test("shared dispatcher routes CSV while DOCX/XLSX paths stay unchanged", () => {
  const opened = inspectOffice("prices.csv", bytes);
  assert.equal(opened.representation.kind, "office_csv");
  const result = editOffice("prices.csv", bytes, [
    { kind: "set_cell", target: "table:1", address: "A1", value: "идентификатор" }
  ]);
  assert.equal(parseCsv(read(result.buffer)).rows[0][0], "идентификатор");
  assert.doesNotThrow(() =>
    validateEdits([{ kind: "set_cell", target: "table:1", address: "A1", value: "x" }])
  );
  assert.doesNotThrow(() =>
    validateEdits([{ kind: "set_cell", target: "sheet:1", address: "A1", value: "x" }])
  );
  assert.throws(() =>
    validateCsvEdits([{ kind: "set_cell", target: "sheet:1", address: "A1", value: "x" }])
  );
});

test("BOM is preserved on export and does not change cell values", () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
  const result = editCsv("bom.csv", withBom, [
    { kind: "set_cell", target: "table:1", address: "A1", value: "changed" }
  ]);
  assert.equal(result.buffer[0], 0xef);
  const table = parseCsv(read(result.buffer).replace(/^\ufeff/, ""));
  assert.equal(table.rows[0][0], "changed");
  assert.equal(table.rows[0][1], "title");
});

test("round-trip with semicolon and tab delimiters keeps the detected delimiter", () => {
  for (const delimiter of [",", ";", "\t", "|"]) {
    const sourceTable = {
      delimiter,
      bom: false,
      rows: [
        ["a", "b", "c"],
        ["00123", "x" + delimiter + "y", "随"]
      ],
      width: 3
    };
    const original = serializeCsv(sourceTable);
    assert.equal(parseCsv(read(original)).delimiter, delimiter);
    const result = editCsv("delim.csv", original, [
      { kind: "set_cell", target: "table:1", address: "B2", value: "updated" }
    ]);
    assert.equal(parseCsv(read(result.buffer)).delimiter, delimiter);
    assert.equal(parseCsv(read(result.buffer)).rows[1][1], "updated");
  }
});

test("values containing the active delimiter are quoted and reopen unchanged", () => {
  for (const delimiter of [",", ";", "\t", "|"]) {
    const rows = [
      ["id", "title", "amount"],
      ["00123", "Old", "19700"],
      ["002", "Other", "19800"]
    ];
    const original = serializeCsv({ delimiter, bom: false, rows, width: 3 });
    const result = editCsv("delim.csv", original, [
      { kind: "set_cell", target: "table:1", address: "B2", value: `Company${delimiter} A` },
      { kind: "set_cell", target: "table:1", address: "C2", value: 'has "quotes" too' }
    ]);
    const table = parseCsv(read(result.buffer));
    assert.equal(table.delimiter, delimiter);
    assert.equal(table.rows[1][1], `Company${delimiter} A`);
    assert.equal(table.rows[1][2], 'has "quotes" too');
    // Untouched cells and source bytes survive the round-trip.
    assert.equal(table.rows[2][1], "Other");
    assert.equal(table.rows[0][0], "id");
    assert.equal(parseCsv(read(original)).rows[1][1], "Old");

    // A different supported separator inside the value must not confuse the
    // reader's delimiter detection on reopen.
    const other = [",", ";", "\t", "|"].find((d) => d !== delimiter);
    const cross = editCsv("cross.csv", original, [
      { kind: "set_cell", target: "table:1", address: "B2", value: `mixed${other}value` }
    ]);
    const reopened = parseCsv(read(cross.buffer));
    assert.equal(reopened.delimiter, delimiter);
    assert.equal(reopened.rows[1][1], `mixed${other}value`);
  }
});
