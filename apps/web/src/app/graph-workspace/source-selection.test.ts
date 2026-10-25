import { describe, expect, it } from "vitest";
import { sourceSelectionExcerpt, sourceSelectionText } from "./source-selection";

describe("literal source selections from a textarea", () => {
  it("maps UTF-16 offsets back to original mixed line endings and Unicode", () => {
    const text = "До\r\n🙂е\u0301\rстрока\n<script>$&</script>\r\nПосле";
    const displayed = sourceSelectionText(text);
    const start = displayed.indexOf("🙂"),
      end = displayed.indexOf("После");
    expect(sourceSelectionExcerpt(text, start, end)).toBe(
      "🙂е\u0301\rстрока\n<script>$&</script>\r\n"
    );
    expect(sourceSelectionExcerpt(text, 0, displayed.length)).toBe(text);
  });
  it.each([
    [0, 0],
    [-1, 1],
    [0, 1.5],
    [0, Number.NaN],
    [2, 1],
    [0, 20]
  ])("rejects invalid offsets %s..%s", (start, end) => {
    expect(() => sourceSelectionExcerpt("text", start, end)).toThrow();
  });
  it("rejects partial surrogate pairs, blank excerpts and quotes beyond the server limit", () => {
    expect(() => sourceSelectionExcerpt("🙂x", 1, 3)).toThrow("целиком");
    expect(() => sourceSelectionExcerpt("x🙂", 0, 2)).toThrow("целиком");
    expect(() => sourceSelectionExcerpt(" \r\n ", 0, 3)).toThrow("с текстом");
    expect(() => sourceSelectionExcerpt("a".repeat(1001), 0, 1001)).toThrow("1000");
    expect(sourceSelectionExcerpt("a".repeat(1000), 0, 1000)).toHaveLength(1000);
  });
  it("accounts for original CRLF bytes when checking quote size", () => {
    expect(() => sourceSelectionExcerpt("a\r\n".repeat(334), 0, 668)).toThrow("1000");
  });
});
