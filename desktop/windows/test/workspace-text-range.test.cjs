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
