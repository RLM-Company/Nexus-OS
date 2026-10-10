import { describe, expect, it } from "vitest";
import { decodeCodeProposal, selectCodeContextPaths } from "../src/code-agent/proposal-input.js";

describe("single text proposal input", () => {
  it("accepts JSON, raw and one fenced diff without changing its bytes", () => {
    const diff = "--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n";
    for (const text of [diff, `\u0060\u0060\u0060diff\n${diff}\u0060\u0060\u0060`])
      expect(decodeCodeProposal(text)).toEqual({ summary: "Предложен текстовый патч", diff });
    expect(decodeCodeProposal(JSON.stringify({ summary: "fix", diff }))).toEqual({
      summary: "fix",
      diff
    });
  });
  it("refuses truncated fences, surrounding prose and oversized responses locally", () => {
    for (const text of [
      "\u0060\u0060\u0060diff\n--- a/a",
      "Here is a patch:\n--- a/a",
      "{}\n\u0060\u0060\u0060"
    ])
      expect(() => decodeCodeProposal(text)).toThrow("PATCH_FORMAT");
    expect(() => decodeCodeProposal("я".repeat(100_001))).toThrow("PATCH_LIMIT");
  });
  it("uses explicit filenames and deterministic related stems without a selection call", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ path: `src/unrelated${i}.ts` }));
    entries.push(
      { path: "packages/model-gateway/src/router.ts" },
      { path: "packages/model-gateway/test/router.test.ts" }
    );
    expect(selectCodeContextPaths("Исправь ModelRouter", [], entries)).toEqual([
      "packages/model-gateway/src/router.ts",
      "packages/model-gateway/test/router.test.ts"
    ]);
    expect(selectCodeContextPaths("Исправь src/unrelated1.ts", [], entries)).toEqual([
      "src/unrelated1.ts"
    ]);
    expect(selectCodeContextPaths("Исправь ModelRouter", ["src/unrelated2.ts"], entries)).toEqual([
      "src/unrelated2.ts"
    ]);
  });
  it("asks for bounded context before dispatch rather than starting a paid file-selection round", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({ path: `src/module${i}.ts` }));
    expect(() => selectCodeContextPaths("Исправь ошибку", [], entries)).toThrow(
      "CONTEXT_FILES_REQUIRED"
    );
    expect(selectCodeContextPaths("Исправь ошибку", [], entries.slice(0, 8))).toHaveLength(8);
    const many = Array.from({ length: 33 }, (_, i) => ({ path: `src/item${i}.ts` }));
    expect(() => selectCodeContextPaths(many.map((e) => e.path).join(" "), [], many)).toThrow(
      "WORKSPACE_LIMIT"
    );
  });
});
