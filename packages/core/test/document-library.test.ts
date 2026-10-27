import { describe, expect, it } from "vitest";
import { chunkLibraryPages, libraryCitation, rankLibraryChunks } from "../src/document-library.js";

describe("document library", () => {
  it("retains physical PDF page and lines across multiple pages", () => {
    const chunks = chunkLibraryPages([
      { page: 1, text: "first\nsecond" },
      { page: 2, text: "third" }
    ]);
    expect(chunks.map((c) => [c.page, c.line_start, c.line_end])).toEqual([
      [1, 1, 2],
      [2, 1, 1]
    ]);
    expect(libraryCitation({ name: "a.pdf", ...chunks[1]! })).toBe("a.pdf, стр. 2, строки 1–1");
  });
  it("never silently clips long unbroken lines", () => {
    const text = "x".repeat(4501);
    const chunks = chunkLibraryPages([{ page: null, text }], 1000);
    expect(chunks.map((c) => c.content).join("")).toBe(text);
  });
  it("finds independent Russian terms and excludes unrelated fragments", () => {
    const chunks = chunkLibraryPages([
      { page: null, text: "история Рима\n\n" },
      { page: null, text: "экономика России" }
    ]);
    expect(rankLibraryChunks(chunks, "экономика России")[0]?.content).toContain("экономика");
    expect(rankLibraryChunks(chunks, "квантовый двигатель")).toEqual([]);
  });
});
