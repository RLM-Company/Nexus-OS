import { describe, it, expect } from "vitest";
import { editMarkdown } from "./markdown-edit";
describe("Markdown selection editing", () => {
  it("keeps spaces outside emphasis and toggles the selected emphasis off", () => {
    const edit = editMarkdown("Kosmora отчёт", 0, 8, "bold");
    expect(edit.text).toBe("**Kosmora** отчёт");
    expect(editMarkdown(edit.text, edit.start, edit.end, "bold").text).toBe("Kosmora отчёт");
  });
  it("preserves surrounding Cyrillic, emoji and CRLF while wrapping selected text", () => {
    const text = "😀\r\nПривет мир";
    const edit = editMarkdown(text, 4, 10, "bold");
    expect(edit.text).toBe("😀\r\n**Привет** мир");
    expect(edit.text.slice(edit.start, edit.end)).toBe("Привет");
  });
  it("formats complete selected lines without changing the remaining document", () => {
    expect(editMarkdown("один\r\nдва\r\nтри", 1, 8, "list").text).toBe("- один\r\n- два\r\nтри");
    expect(editMarkdown("\nтекст", 0, 0, "heading").text).toBe("## \nтекст");
  });
  it("selects a placeholder at an empty caret and preserves multiline code", () => {
    const edit = editMarkdown("", 0, 0, "italic");
    expect(edit.text).toBe("_текст_");
    expect(edit.text.slice(edit.start, edit.end)).toBe("текст");
    expect(editMarkdown("a\r\nb", 0, 4, "code").text).toBe("```\r\na\r\nb\r\n```");
  });
});
