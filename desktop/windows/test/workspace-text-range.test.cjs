"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { selectTextRange } = require("../workspace/text-range.cjs");
const { validateComputerAction } = require("../computer-policy.cjs");

test("line excerpts preserve literal mixed line endings, numbers and source boundaries", () => {
  const text = "Заголовок\r\nЦена: ١٢٣ ₽\rУсловие: не всегда\nконец\n";
  const result = selectTextRange(text, { startLine: 2, endLine: 3 });
  assert.equal(result.content, "Цена: ١٢٣ ₽\rУсловие: не всегда");
  assert.ok(text.includes(result.content));
  assert.deepEqual(
    { ...result, content: undefined },
    {
      content: undefined,
      start_line: 2,
      end_line: 3,
      total_lines: 5,
      next_start_line: 4,
      excerpt_only: true,
      content_bytes: Buffer.byteLength(result.content)
    }
  );
  assert.equal(selectTextRange(text, { startLine: 1, endLine: 120 }).content, text);
  assert.equal(selectTextRange(text, { startLine: 1, endLine: 120 }).excerpt_only, false);
  assert.equal(selectTextRange(text, { startLine: 5, endLine: 5 }).content, "");
  assert.equal(selectTextRange("", { startLine: 1, endLine: 1 }).excerpt_only, false);
});
test("UTF-8 and escaped JSON bytes are bounded without clipping a line", () => {
  for (const text of ["Ж".repeat(5000), "\t".repeat(5000), "🚀".repeat(2500)])
    assert.throws(
      () => selectTextRange(text, { startLine: 1, endLine: 1 }),
      (e) => e.code === "WORKSPACE_FILE_TOO_LARGE"
    );
  assert.equal(
    selectTextRange("Ж".repeat(4999), { startLine: 1, endLine: 1 }).content.length,
    4999
  );
});
test("malformed, excessive and missing ranges fail closed in both the parser and native action gate", () => {
  const base = {
    kind: "workspace_read_lines",
    path: "отчёт с пробелом.txt",
    start_line: 1,
    end_line: 120,
    expected_version: null
  };
  assert.deepEqual(validateComputerAction(base), base);
  for (const edit of [
    { start_line: 0 },
    { end_line: 121 },
    { start_line: 3, end_line: 2 },
    { end_line: 1.5 },
    { expected_version: "invented" },
    { end_line: 2097154 },
    { extra: "ignore guard" }
  ])
    assert.throws(() => validateComputerAction({ ...base, ...edit }), /COMPUTER_ACTION_INVALID/);
  for (const range of [
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 1 },
    { startLine: 1, endLine: 121 },
    { startLine: 1.1, endLine: 2 },
    { startLine: 4, endLine: 8 }
  ])
    assert.throws(
      () => selectTextRange("one\ntwo\nthree", range),
      (e) => e.code === "WORKSPACE_RANGE_INVALID"
    );
});

test("document pagination fills the wire budget with the longest whole-Unicode prefix", () => {
  const { fitDocumentExcerpt } = require("../workspace/text-range.cjs");
  for (const text of ["Ж".repeat(12000), '🚀\t"\\'.repeat(4000), "a".repeat(13000)]) {
    let offset = 0,
      reconstructed = "",
      pages = 0;
    do {
      const r = fitDocumentExcerpt(text, offset, { version: "sha256:" + "a".repeat(64) });
      assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 10000);
      assert.ok(r.content.isWellFormed());
      assert.ok(r.end_utf16 > offset);
      if (r.end_utf16 < Math.min(text.length, offset + 6000)) {
        const extra = text.codePointAt(r.end_utf16) > 0xffff ? 2 : 1;
        const end = r.end_utf16 + extra;
        const larger = {
          ...r,
          end_utf16: end,
          content: text.slice(offset, end),
          next_offset: end < text.length ? end : null,
          excerpt_only: offset > 0 || end < text.length
        };
        assert.ok(Buffer.byteLength(JSON.stringify(larger)) > 10000);
      }
      reconstructed += r.content;
      offset = r.next_offset;
      pages++;
    } while (offset !== null);
    assert.equal(reconstructed, text);
    if (text.startsWith("Ж")) assert.equal(pages, 3);
  }
});
test("document pagination retains an empty final page and rejects oversized metadata", () => {
  const { fitDocumentExcerpt } = require("../workspace/text-range.cjs");
  assert.equal(fitDocumentExcerpt("", 0, {}).next_offset, null);
  assert.throws(
    () => fitDocumentExcerpt("value", 0, { path: "x".repeat(10000) }),
    (e) => e.code === "WORKSPACE_FILE_TOO_LARGE"
  );
});
