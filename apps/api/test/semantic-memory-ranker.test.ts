import { describe, expect, it } from "vitest";
import { LocalMemoryRanker } from "../src/semantic-memory/local-ranker.js";
import { resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

describe("local semantic encoder runtime", () => {
  it("requires an absolute model path and a bounded deadline", () => {
    expect(() => new LocalMemoryRanker("relative")).toThrow("INVALID_SEMANTIC_CONFIG");
    expect(() => new LocalMemoryRanker(resolve("missing"), 60001)).toThrow(
      "INVALID_SEMANTIC_CONFIG"
    );
  });
  it("fails closed for a corrupt local model before accepting private passages", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kosmora-semantic-"));
    await writeFile(resolve(directory, "config.json"), "{}");
    const ranker = new LocalMemoryRanker(directory);
    try {
      expect(await ranker.warmup()).toBe(false);
      await expect(ranker.rank("private query", ["private source"])).rejects.toThrow(
        "SEMANTIC_UNAVAILABLE"
      );
    } finally {
      await ranker.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("propagates cancellation before loading or sending source text", async () => {
    const ranker = new LocalMemoryRanker(resolve("missing-semantic-model"));
    const controller = new AbortController();
    controller.abort();
    try {
      expect(() => ranker.rank("query", ["source"], controller.signal)).toThrow();
    } finally {
      await ranker.close();
    }
  });
});
