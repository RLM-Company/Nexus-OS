import test from "node:test";
import assert from "node:assert/strict";
import { splitHighlights } from "./highlight.ts";

test("safe plain-text highlighting; HTML-like corpus stays text", () => {
  const parts = splitHighlights(
    "<script>alert(1)</script> секретный <img src=x onerror=bad>",
    "секретный"
  );
  assert.deepEqual(
    parts.filter((part) => part.matched).map((part) => part.text),
    ["секретный"]
  );
  assert.equal(
    parts.map((part) => part.text).join(""),
    "<script>alert(1)</script> секретный <img src=x onerror=bad>"
  );
});
test("case insensitive Russian and regex control characters are literals", () => {
  const parts = splitHighlights("СЕКРЕТЫ [a+b] (foo)", "секреты [a+b]");
  assert.equal(parts.map((p) => p.text).join(""), "СЕКРЕТЫ [a+b] (foo)");
  assert.equal(parts.filter((p) => p.matched).length, 3);
});
test("empty query and markup only give unmodified text", () => {
  assert.deepEqual(splitHighlights("abc", ""), [{ text: "abc", matched: false }]);
  assert.deepEqual(splitHighlights("abc", "**()"), [{ text: "abc", matched: false }]);
});
