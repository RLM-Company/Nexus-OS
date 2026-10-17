import { describe, expect, it } from "vitest";
import { compareCanvasText, compactCanvasDiff } from "./canvas-diff";

describe("literal bounded Canvas comparison", () => {
  it.each([
    ["", "", 0, 0],
    ["", "a\r\nb\n", 2, 0],
    ["one\ntwo\n", "one\nthree\n", 1, 1],
    ["one\ntwo\nthree\n", "one\nthree\n", 0, 1],
    ["  a\n", " a\n", 1, 1],
    ["a\n", "a\r\n", 1, 1],
    ["a\r", "a", 1, 1],
    ["a", "a\n", 1, 1],
    ["a\n\n", "a\n", 0, 1],
    ["Повтор\nПовтор\n🍋\n", "Повтор\n🍋\nПовтор\n", 1, 1]
  ])("preserves exact content %j → %j", (before, after, added, removed) => {
    const result = compareCanvasText(before, after);
    expect(result.limited).toBe(false);
    if (result.limited) throw new Error("Unexpected limit");
    expect(result.added).toBe(added);
    expect(result.removed).toBe(removed);
    if (before !== after) {
      expect(
        result.rows
          .filter((r) => r.kind !== "add")
          .map((r) => r.text)
          .join("")
      ).toBe(before);
      expect(
        result.rows
          .filter((r) => r.kind !== "remove")
          .map((r) => r.text)
          .join("")
      ).toBe(after);
      expect(result.rows.filter((r) => r.before !== null).map((r) => r.before)).toEqual(
        Array.from({ length: result.rows.filter((r) => r.before !== null).length }, (_, i) => i + 1)
      );
      expect(result.rows.filter((r) => r.after !== null).map((r) => r.after)).toEqual(
        Array.from({ length: result.rows.filter((r) => r.after !== null).length }, (_, i) => i + 1)
      );
    }
  });
  it("is deterministic with repeated lines and preserves both inputs across generated edits", () => {
    const tokens = ["a\n", "b\r\n", "\n", "🚀\r", "Конец"];
    for (let i = 0; i < 120; i++) {
      const before = Array.from({ length: i % 13 }, (_, j) => tokens[(j * 7 + i) % 5]).join("");
      const after = Array.from({ length: i % 17 }, (_, j) => tokens[(j * 3 + i) % 5]).join("");
      const diff = compareCanvasText(before, after);
      expect(diff).toEqual(compareCanvasText(before, after));
      if (diff.limited) throw new Error("Unexpected limit");
      if (before === after) continue;
      expect(
        diff.rows
          .filter((r) => r.kind !== "add")
          .map((r) => r.text)
          .join("")
      ).toBe(before);
      expect(
        diff.rows
          .filter((r) => r.kind !== "remove")
          .map((r) => r.text)
          .join("")
      ).toBe(after);
    }
  });
  it("bounds UTF-8 bytes, line count and quadratic work independently", () => {
    expect(compareCanvasText("🍋".repeat(70000), "x")).toEqual({ limited: true, reason: "bytes" });
    expect(compareCanvasText("\n".repeat(4000), "x")).toEqual({ limited: true, reason: "lines" });
    expect(compareCanvasText("a\n".repeat(800), "b\n".repeat(800))).toEqual({
      limited: true,
      reason: "complexity"
    });
    expect(compareCanvasText("x".repeat(512 * 1024), "x".repeat(512 * 1024))).toEqual({
      limited: false,
      rows: [],
      added: 0,
      removed: 0
    });
  });
  it("trims unchanged edges before allocating a comparison matrix", () => {
    const prefix = "same\n".repeat(1500);
    const suffix = "same too\n".repeat(400);
    const result = compareCanvasText(prefix + "old\n" + suffix, prefix + "new\n" + suffix);
    if (result.limited) throw new Error("Unexpected limit");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    const compact = compactCanvasDiff(result.rows);
    expect(compact.filter((row) => row.kind === "fold")).toEqual([
      { kind: "fold", count: 1498 },
      { kind: "fold", count: 398 }
    ]);
    expect(compact.filter((row) => row.kind === "add" || row.kind === "remove")).toHaveLength(2);
  });
});
