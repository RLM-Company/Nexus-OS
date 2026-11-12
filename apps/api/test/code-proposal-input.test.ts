import { describe, expect, it } from "vitest";
import {
  applyCodeExactEdits,
  assertCodeContextContentSafe,
  codePromptFiles,
  decodeCodeProposal,
  searchCodeContextPaths,
  selectCodeContextPaths
} from "../src/code-agent/proposal-input.js";

describe("single text proposal input", () => {
  it("applies sequential exact edits while preserving other text and CRLF bytes", () => {
    const snapshot = [{ path: "src/a.js", content: "first\r\nold\r\nlast" }];
    expect(
      applyCodeExactEdits(
        [
          { path: "src/a.js", old_text: "old", new_text: "new" },
          { path: "src/a.js", old_text: "new\r\nlast", new_text: "done\r\nlast" }
        ],
        snapshot
      )
    ).toEqual([{ path: "src/a.js", content: "first\r\ndone\r\nlast" }]);
    expect(snapshot[0]!.content).toBe("first\r\nold\r\nlast");
  });
  it("refuses fuzzy, repeated, overlapping, unread and ambiguous replacement instructions", () => {
    const snapshot = [{ path: "a.js", content: "aaaa\nother\r\n" }];
    for (const [edit, error] of [
      [{ path: "a.js", old_text: "other\n", new_text: "new\n" }, "PATCH_CONTEXT"],
      [{ path: "a.js", old_text: "aa", new_text: "new" }, "PATCH_AMBIGUOUS"],
      [{ path: "other.js", old_text: "aaaa", new_text: "new" }, "FILE_NOT_READ"],
      [{ path: "a.js", old_text: "aaaa", new_text: "aaaa" }, "EMPTY_CHANGE"],
      [{ path: "a.js", old_text: "", new_text: "new" }, "INVALID_PATCH"],
      [{ path: "a.js", old_text: "aaaa", new_text: "new", execute: true }, "INVALID_PATCH"]
    ] as const)
      expect(() => applyCodeExactEdits([edit], snapshot)).toThrow(error);
    expect(() => applyCodeExactEdits([], snapshot)).toThrow("INVALID_PATCH");
    expect(() =>
      applyCodeExactEdits(
        [{ path: "a.js", old_text: "aaaa", new_text: "x".repeat(50001) }],
        snapshot
      )
    ).toThrow("INVALID_PATCH");
  });
  it("labels exact source lines without mutating canonical bytes or losing final-newline evidence", () => {
    const files = [{ path: "src/a.js", content: "same\r\nsame\r\n" }];
    const prompt = codePromptFiles(files);
    expect(prompt[0]!.numbered_lines).toBe("1: same\r\n2: same\r\n3: ");
    expect(files[0]!.content).toBe("same\r\nsame\r\n");
    expect(codePromptFiles([{ path: "src/a.js", content: "same" }])[0]!.numbered_lines).toBe(
      "1: same"
    );
  });
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
  it("searches literal safe paths deterministically with bounded results and explicit completeness", () => {
    const paths = Array.from({ length: 40 }, (_, i) => ({ path: `src/module-${i}.ts` })).reverse();
    paths.push({ path: ".npmrc" }, { path: ".ssh/module-key" });
    const result = searchCodeContextPaths({ query: " MODULE " }, paths);
    expect(result.files).toHaveLength(32);
    expect(result.total_count).toBe(40);
    expect(result.partial).toBe(true);
    expect(result.files[0]).toBe("src/module-0.ts");
    expect(result.files[31]).toBe("src/module-37.ts");
    expect(searchCodeContextPaths({ query: ".npmrc" }, paths)).toEqual({
      files: [],
      total_count: 0,
      partial: false
    });
    expect(searchCodeContextPaths({ query: "module.*" }, paths)).toEqual({
      files: [],
      total_count: 0,
      partial: false
    });
    expect(searchCodeContextPaths({ query: "module-39.ts" }, paths)).toEqual({
      files: ["src/module-39.ts"],
      total_count: 1,
      partial: false
    });
    for (const value of [
      null,
      [],
      {},
      { query: "" },
      { query: "   " },
      { query: "x".repeat(161) },
      { query: "a\n" },
      { query: 42 },
      { query: "a", limit: 100000 }
    ])
      expect(() => searchCodeContextPaths(value, paths)).toThrow("INVALID_TOOL_CALL");
  });
});

describe("embedded credential context admission", () => {
  const samples = [
    "ghp_" + "G".repeat(36),
    "github_pat_" + "F".repeat(40),
    "sk-proj-" + "O".repeat(36),
    "sk-" + "S".repeat(32),
    "AK" + "IA" + "A".repeat(16),
    "AS" + "IA" + "B".repeat(16),
    "-----BEGIN " + "PRIVATE KEY-----\nsynthetic-only\n",
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nsynthetic-only\n"
  ];
  it.each(samples.map((value, i) => ({ value, format: i })))(
    "rejects recognized format $format on repeated scans without exposing it",
    ({ value }) => {
      const content = `// ordinary file\r\nconst value = "${value}";`;
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => assertCodeContextContentSafe(content)).toThrow("CONTEXT_CONTENT_FORBIDDEN");
        try {
          codePromptFiles([{ path: "src/config.ts", content }]);
        } catch (error) {
          expect(String(error)).not.toContain(value);
          continue;
        }
        throw new Error("Credential entered model prompt");
      }
    }
  );
  it("preserves benign credential variable names and exact source bytes", () => {
    const content =
      "const apiKey = process.env.API_KEY;\r\nconst password = config.password;\r\n// 19 700; 00123; 2026-11-12; кроме доставки; not enabled";
    const file = { path: "src/config.js", content };
    expect(() => assertCodeContextContentSafe(content)).not.toThrow();
    const prompt = codePromptFiles([file]);
    expect(prompt[0]!.numbered_lines).toBe(
      content
        .split("\n")
        .map((line, i) => `${i + 1}: ${line}`)
        .join("\n")
    );
    expect(file.content).toBe(content);
  });
});
