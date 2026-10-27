import { describe, expect, it } from "vitest";
import { codeAgentUnifiedDiff } from "./unified-diff";

describe("minimal editable diff preview", () => {
  it("uses a small hunk instead of replacing distant unchanged lines", () => {
    const before = Array.from({ length: 500 }, (_, i) => `line ${i}\n`).join("");
    const diff = codeAgentUnifiedDiff([
      { path: "src/a.js", before, content: before.replace("line 250\n", "fixed\n") }
    ]);
    expect(diff.limited).toBe(false);
    expect(diff.text).toContain("@@ -248,7 +248,7 @@");
    expect(diff.text.length).toBeLessThan(300);
    expect(diff.text).not.toContain("line 1\n");
  });
  it("represents newline-only edits and quotes UTF8/spaces exactly", () => {
    const diff = codeAgentUnifiedDiff([
      { path: "папка/имя.js", before: "same", content: "same\n" }
    ]);
    expect(diff.text).toContain("-same\n\\ No newline at end of file\n+same\n");
    expect(diff.text).toContain('diff --git "a/');
  });
  it("refuses quota overflow rather than showing a silently truncated patch", () => {
    expect(
      codeAgentUnifiedDiff(
        Array.from({ length: 9 }, (_, i) => ({ path: `${i}.js`, before: "a", content: "b" }))
      ).limited
    ).toBe(true);
  });
});
