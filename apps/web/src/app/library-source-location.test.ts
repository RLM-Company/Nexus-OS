import { describe, it, expect } from "vitest";
import { PREVIEW_PART_SIZE, previewPart, sourceLineRange } from "./library-source-location";
describe("source page line locations", () => {
  it("preserves offsets for mixed line endings and Unicode", () => {
    const text = "Заголовок\r\n😀 Бюджет\rСрок\nКонец";
    const range = sourceLineRange(text, 2, 3)!;
    expect(text.slice(range.start, range.end)).toBe("😀 Бюджет\rСрок\n");
    const final = sourceLineRange(text, 4, 4)!;
    expect(text.slice(final.start, final.end)).toBe("Конец");
  });
  it("does not invent missing lines or accept invalid ranges", () => {
    expect(sourceLineRange("одна", 2, 2)).toBeNull();
    expect(sourceLineRange("одна", 1, 5)).toBeNull();
    expect(sourceLineRange("одна", 0, 1)).toBeNull();
    expect(sourceLineRange("a\n", 2, 2)).toEqual({ start: 2, end: 2 });
  });
  it("paginates long previews without dropping or splitting surrogate pairs", () => {
    const text = "x".repeat(PREVIEW_PART_SIZE - 1) + "😀" + "y".repeat(50);
    const first = previewPart(text, 0),
      second = previewPart(text, 1);
    expect(first.end).toBe(second.start);
    expect(text.slice(first.start, first.end) + text.slice(second.start, second.end)).toBe(text);
    expect(text.slice(second.start, second.end)).toMatch(/^😀/);
  });
});
