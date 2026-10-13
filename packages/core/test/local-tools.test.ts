import { describe, expect, it } from "vitest";
import {
  computeLineDiff,
  extractEntitiesLocal,
  analyzeTextMetrics,
  convertJsonToMarkdownTable
} from "../src/index.js";

describe("Kosmora Zero-API Local Tools", () => {
  it("computes line-by-line LCS diff without external API calls", () => {
    const diff = computeLineDiff(
      "line 1\nline 2\nline 3",
      "line 1\nline 2 modified\nline 3\nline 4"
    );
    expect(diff.unchanged).toBe(2);
    expect(diff.deletions).toBe(1);
    expect(diff.additions).toBe(2);
  });

  it("extracts URLs, emails, IPs, dates, and code block count locally", () => {
    const entities = extractEntitiesLocal(
      "Visit https://kosmora.io or mail dev@kosmora.io from 10.0.0.1 on 2026-10-13. ```ts\nconst x = 1;\n```"
    );
    expect(entities.urls).toEqual(["https://kosmora.io"]);
    expect(entities.emails).toEqual(["dev@kosmora.io"]);
    expect(entities.ips).toEqual(["10.0.0.1"]);
    expect(entities.dates).toEqual(["2026-10-13"]);
    expect(entities.codeBlocksCount).toBe(1);
  });

  it("analyzes text metrics and converts JSON to Markdown table", () => {
    const metrics = analyzeTextMetrics("Hello world\nSecond line");
    expect(metrics.words).toBe(4);
    expect(metrics.lines).toBe(2);
    expect(metrics.estimatedTokens).toBeGreaterThan(0);

    const mdTable = convertJsonToMarkdownTable(
      JSON.stringify([
        { name: "Alpha", score: 9 },
        { name: "Product", score: 10 }
      ])
    );
    expect(mdTable).toContain("| name | score |");
    expect(mdTable).toContain("| Alpha | 9 |");
  });
});
