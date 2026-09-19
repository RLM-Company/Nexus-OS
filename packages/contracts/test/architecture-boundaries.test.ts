import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "../../../apps/web/src");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });

describe("architecture boundaries", () => {
  it("keeps provider adapters and credentials out of the web application", () => {
    const forbidden = [
      /@cosmora\/model-gateway/,
      /@cosmora\/db/,
      /@cosmora\/policy-engine/,
      /@cosmora\/tool-runtime/,
      /(?:^|["'])\.\.\/\.\.\/api(?:\/|["'])/,
      /apps\/api/,
      /openai-compatible-adapter/,
      /anthropic-compatible-adapter/,
      /MODEL_API_KEY/,
      /\/chat\/completions/,
      /x-api-key/i,
      /authorization\s*:/i
    ];

    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
