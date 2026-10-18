import { describe, expect, it } from "vitest";
import { formatEditorSelection } from "./editor-format";

const limit = 512 * 1024;
describe("Markdown textarea formatting", () => {
  it("preserves Unicode and surrounds only the selected text, with a reversible range", () => {
    const content = "Привет 🚀 мир";
    const result = formatEditorSelection(content, 7, 9, "bold", limit)!;
    expect(result).toEqual({ content: "Привет **🚀** мир", start: 9, end: 11 });
    expect(formatEditorSelection(result.content, result.start, result.end, "bold", limit)).toEqual({
      content,
      start: 7,
      end: 9
    });
  });
  it("inserts an editable placeholder at the caret and selects a link URL", () => {
    expect(formatEditorSelection("ab", 1, 1, "italic", limit)).toEqual({
      content: "a*текст*b",
      start: 2,
      end: 7
    });
    const link = formatEditorSelection("Документ", 0, 8, "link", limit)!;
    expect(link.content).toBe("[Документ](https://)");
    expect(link.content.slice(link.start, link.end)).toBe("https://");
  });
  it("formats complete selected lines and leaves a following line outside the range", () => {
    const result = formatEditorSelection("один\nдва\nтри", 1, 9, "numbered", limit)!;
    expect(result.content).toBe("1. один\n2. два\nтри");
    expect(
      formatEditorSelection(result.content, result.start, result.end, "numbered", limit)?.content
    ).toBe("один\nдва\nтри");
    expect(formatEditorSelection("\nдва", 0, 0, "heading", limit)?.content).toBe("## \nдва");
  });
  it("preserves carriage returns and changes a block heading without accumulating markers", () => {
    const result = formatEditorSelection("# Один\r\n### Два", 0, 15, "heading", limit)!;
    expect(result.content).toBe("Один\r\nДва");
    expect(formatEditorSelection("строка", 2, 3, "quote", limit)?.content).toBe("> строка");
  });
  it("uses a longer fence when selected code contains backticks", () => {
    const result = formatEditorSelection("```js\nx()\n```", 0, 13, "code", limit)!;
    expect(result.content).toBe("````\n```js\nx()\n```\n````");
    expect(result.content.slice(result.start, result.end)).toBe("```js\nx()\n```");
    expect(formatEditorSelection("`x`", 0, 3, "code", limit)?.content).toBe("`` `x` ``");
    expect(formatEditorSelection("before\none\ntwo\nafter", 9, 14, "code", limit)?.content).toBe(
      "before\n```\none\ntwo\n```\nafter"
    );
  });
  it("keeps selected word spaces outside emphasis and safely handles many code delimiters", () => {
    expect(formatEditorSelection("hello world ", 6, 12, "bold", limit)?.content).toBe(
      "hello **world** "
    );
    const content = "`x".repeat(100000);
    expect(
      formatEditorSelection(content, 0, content.length, "code", limit)?.content.startsWith("`` ")
    ).toBe(true);
  });
  it("checks UTF-8 byte capacity before changing any text", () => {
    expect(formatEditorSelection("я".repeat(limit / 2), 0, 1, "bold", limit)).toBeNull();
    const exact = formatEditorSelection("я", 0, 1, "bold", 6)!;
    expect(new TextEncoder().encode(exact.content).byteLength).toBe(6);
    expect(formatEditorSelection("**я**", 2, 3, "bold", 2)?.content).toBe("я");
  });
});
