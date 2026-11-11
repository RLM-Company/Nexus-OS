"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { findText } = require("../browser/find-text.cjs");
const action = (query, extra = {}) => ({ query, case_sensitive: false, offset_utf16: 0, ...extra });

test("literal find preserves original Unicode offsets instead of lowercased-string indices", () => {
  const text = "İ 🌙 00123. [a]+? Цена ЦЕНА";
  for (const query of ["00123", "[a]+?", "цена", "🌙"]) {
    const result = findText(text, action(query), {});
    assert.ok(result.matches.length > 0);
    for (const match of result.matches)
      assert.equal(text.slice(match.start_utf16, match.end_utf16), match.quote);
  }
  assert.equal(findText(text, action("00123"), {}).matches[0].start_utf16, text.indexOf("00123"));
  assert.equal(findText(text, action("ЦЕНА", { case_sensitive: true }), {}).matches.length, 1);
  assert.equal(findText(text, action("цена"), {}).matches.length, 2);
  assert.equal(findText(text, action(".*"), {}).matches.length, 0);
});

test("find pages every retained match with progress and bounded serialized UTF-8", () => {
  const query = '"\\\u0001🌙'.repeat(20);
  const text = (query + "\n").repeat(63);
  let offset = 0,
    count = 0,
    pages = 0;
  do {
    const result = findText(text, action(query, { offset_utf16: offset }), {
      url: "https://example.test/?" + "x".repeat(3000)
    });
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 10000);
    assert.ok(result.matches.length <= 20);
    count += result.matches.length;
    if (result.next_offset !== null) {
      assert.ok(result.next_offset > offset);
      assert.equal(result.complete_scan_from_offset, false);
    } else assert.equal(result.complete_scan_from_offset, true);
    offset = result.next_offset;
    pages++;
  } while (offset !== null);
  assert.equal(count, 63);
  assert.ok(pages > 3);
});
