import { describe, expect, it } from "vitest";
import {
  maskSecrets,
  pruneCodeForContext,
  MemoryHierarchyManager,
  type MemoryFact
} from "../src/index.js";

describe("Kosmora Advanced Technologies Suite", () => {
  it("redacts private keys, API keys, and bearer tokens in real-time", () => {
    const fakeKey = ["sk", "1234567890abcdef1234567890"].join("-");
    const raw = `Bearer my-token-12345678901234567890 ${fakeKey}`;
    const masked = maskSecrets(raw);
    expect(masked).toContain("[REDACTED_API_KEY]");
    expect(masked).toContain("[REDACTED_TOKEN]");
  });

  it("prunes comments from code for token economy", () => {
    const code = `// comment\nfunction f() {\n  return 1;\n}`;
    const result = pruneCodeForContext(code, "typescript");
    expect(result.content).not.toContain("// comment");
    expect(result.content).toContain("return 1;");
  });

  it("selects relevant facts for prompt context", () => {
    const facts: MemoryFact[] = [
      {
        id: "1",
        category: "stack",
        key: "БД",
        value: "SQLite FTS5",
        confidence: 1,
        updated_at: "now"
      }
    ];
    const prompt = MemoryHierarchyManager.buildPromptContext(
      {
        chat_id: "c1",
        branch_id: "b1",
        summary: "",
        facts,
        raw_notes: ""
      },
      "Как настроить БД?"
    );
    expect(prompt).toContain("SQLite FTS5");
  });
});
