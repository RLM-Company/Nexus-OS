"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { extractOfficeText } = require("../workspace/office-text.cjs");
const fixtures = require("./fixtures/office-import.json").files;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
test("independently generated Office originals preserve exact figures, formulas and declared slide order", () => {
  for (const f of fixtures) {
    const bytes = Buffer.from(f.base64, "base64"),
      before = Buffer.from(bytes),
      parsed = extractOfficeText(f.name, bytes);
    assert.equal(sha(bytes), f.sha256);
    assert.deepEqual(bytes, before);
    assert.equal(parsed.representation.sha256, sha(parsed.text));
    assert.match(parsed.text, /19 700 ₽|19700/);
    if (f.name.endsWith("docx")) {
      assert.ok(parsed.text.includes("00123"));
      assert.ok(parsed.text.includes("кроме доставки"));
      assert.ok(parsed.text.includes("Товар"));
      assert.equal(parsed.text.includes("Footer excluded"), false);
    }
    if (f.name.endsWith("xlsx")) {
      assert.match(parsed.text, /"formula":"SUM\(B2:B2\)","cached_value":null/);
      assert.match(parsed.text, /WEBSERVICE/);
      assert.match(parsed.text, /"type":"inlineStr"/);
    }
    if (f.name.endsWith("pptx"))
      assert.ok(parsed.text.indexOf("Второй созданный") < parsed.text.indexOf("Первый созданный"));
  }
});
// Stored ZIP fixture independent of the production deflater. Mutations below
// preserve CRC when testing XML, so parser rejection is actually exercised.
function crc(b) {
  let c = 0xffffffff;
  for (const n of b) {
    c ^= n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function archive(items) {
  const local = [],
    central = [];
  let at = 0;
  for (const [name, text] of items) {
    const n = Buffer.from(name),
      b = Buffer.from(text),
      h = Buffer.alloc(30 + n.length),
      c = Buffer.alloc(46 + n.length);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc(b), 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    n.copy(h, 30);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc(b), 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(at, 42);
    n.copy(c, 46);
    local.push(h, b);
    central.push(c);
    at += h.length + b.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(
    central.reduce((n, b) => n + b.length, 0),
    12
  );
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...local, ...central, end]);
}
const types =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const body = (text) =>
  '<q:document xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><q:body><q:p><q:r><q:t>' +
  text +
  "</q:t></q:r></q:p></q:body></q:document>";
const word = (source, extras = []) =>
  archive([["[Content_Types].xml", types], ["word/document.xml", source], ...extras]);
test("namespace aliases, XML entities and Unicode are parsed without normalizing literal numbers", () => {
  const parsed = extractOfficeText(
    "source.docx",
    word(body("&lt;данные&gt; &amp; &#x1f319; 00123"))
  );
  assert.equal(parsed.text, "<данные> & 🌙 00123\n");
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('<?xml version="1.0" encoding="UTF-16"?>' + body("Космора 🌙 00123"), "utf16le")
  ]);
  assert.equal(extractOfficeText("source.docx", word(utf16)).text, "Космора 🌙 00123\n");
});
test("DTD, unknown entities, broken XML, spoofed namespaces and payload expansion are refused", () => {
  for (const xml of [
    body("&unknown;"),
    '<!DOCTYPE q:document [<!ENTITY x SYSTEM "file:///secret">]>' + body("&x;"),
    body("text").replace("</q:t>", "</q:wrong>"),
    body("text").replace(
      'xmlns:q="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
      'xmlns:q="urn:spoof"'
    ),
    body("bad\u0000text"),
    body("x".repeat(256001))
  ])
    assert.throws(() => extractOfficeText("source.docx", word(xml)), /VAULT_DOCUMENT_/);
  assert.throws(
    () => extractOfficeText("source.docx", word(body("text")), { workLimit: 10 }),
    /VAULT_DOCUMENT_INVALID/
  );
  assert.throws(
    () => extractOfficeText("source.docx", word(body("text")), { workLimit: Number.NaN }),
    /VAULT_DOCUMENT_INVALID/
  );
  assert.throws(
    () => extractOfficeText("wrong.xlsx", word(body("text"))),
    /VAULT_DOCUMENT_INVALID/
  );
});
test("ZIP truncation, duplicate names, traversal, encryption and CRC mismatches fail before use", () => {
  const valid = word(body("valid")),
    badCRC = Buffer.from(valid),
    encrypted = Buffer.from(valid);
  badCRC[31 + Buffer.byteLength("[Content_Types].xml")] = 0;
  encrypted.writeUInt16LE(1, 6);
  for (const bytes of [
    valid.subarray(0, valid.length - 1),
    badCRC,
    encrypted,
    word(body("text"), [["word/../escape.txt", "bad"]]),
    word(body("text"), [["WORD/DOCUMENT.XML", body("duplicate")]])
  ])
    assert.throws(() => extractOfficeText("source.docx", bytes), /VAULT_DOCUMENT_INVALID/);
});
