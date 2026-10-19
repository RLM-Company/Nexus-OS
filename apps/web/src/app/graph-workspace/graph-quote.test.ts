import { describe, expect, it } from "vitest";
import { resolveGraphQuote } from "./graph-quote";
describe("exact original-source quote selection", () => {
  it("preserves literal Unicode, spacing, HTML and replacement symbols", () => {
    const source = "Начало 😀 <b> $&  цитата конец";
    expect(resolveGraphQuote(source, "😀 <b> $&  цитата")).toBe("😀 <b> $&  цитата");
    expect(resolveGraphQuote(source, "😀 <b> $& цитата")).toBeNull();
  });
  it("restores original CRLF after the textarea normalizes line endings", () => {
    const source = "Начало\r\n😀 точная\r\nцитата\r\nконец";
    expect(resolveGraphQuote(source, "😀 точная\nцитата")).toBe("😀 точная\r\nцитата");
    expect(resolveGraphQuote(source, "\n😀 точная\n")).toBe("\r\n😀 точная\r\n");
  });
  it("handles mixed CR/LF without substituting other characters", () => {
    expect(resolveGraphQuote("a\rb\r\nc\nd", "a\nb\nc\nd")).toBe("a\rb\r\nc\nd");
    expect(resolveGraphQuote("Цитата", "цитата")).toBeNull();
  });
  it("rejects empty, absent and oversize fragments", () => {
    expect(resolveGraphQuote("Source", " ")).toBeNull();
    expect(resolveGraphQuote("Source", "Missing")).toBeNull();
    expect(resolveGraphQuote("x".repeat(1001), "x")).toBeNull();
  });
});
