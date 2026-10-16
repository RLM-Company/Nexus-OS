import { describe, expect, it } from "vitest";
import { canvasFileDraft } from "./canvas-file-import";

const bytes = (text: string) => new TextEncoder().encode(text);
describe("Canvas local text file import", () => {
  it("preserves exact UTF-8 bytes, BOM, CRLF and no final newline", () => {
    const original = bytes("\ufeff# Текст 🚀\r\n\r\nКонец");
    const draft = canvasFileDraft("Заметка.MD", original);
    expect(bytes(draft.content)).toEqual(original);
    expect(draft.title).toBe("Заметка.MD");
    expect(draft.format).toBe("markdown");
    expect(draft.baseVersion).toBe(0);
  });
  it("treats HTML and source code as inert formats, without executing or parsing them", () => {
    const content = "<script>globalThis.bad = true</script>";
    expect(canvasFileDraft("page.html", bytes(content))).toMatchObject({ format: "html", content });
    expect(canvasFileDraft("source.TSX", bytes(content)).format).toBe("code");
    expect(canvasFileDraft("data.csv", bytes("a,b\n=1,2")).format).toBe("text");
  });
  it("rejects binary masquerading as text, invalid encoding and unsupported extensions", () => {
    expect(() => canvasFileDraft("fake.txt", new Uint8Array([0xff, 0xfe, 0x61]))).toThrow("UTF-8");
    expect(() => canvasFileDraft("fake.txt", bytes("a\0b"))).toThrow("бинарные");
    expect(() => canvasFileDraft("file.pdf", bytes("hello"))).toThrow("текстовый");
    expect(() => canvasFileDraft("no-extension", bytes("hello"))).toThrow("текстовый");
  });
  it("checks actual byte size and safely bounds untrusted titles by UTF-8 bytes", () => {
    expect(() => canvasFileDraft("a.txt", new Uint8Array(512 * 1024 + 1))).toThrow("512");
    const draft = canvasFileDraft("../folder/" + "🚀".repeat(100) + ".md", bytes("okay"));
    expect(bytes(draft.title).length).toBeLessThanOrEqual(240);
    expect(draft.title).not.toContain("/");
    expect(draft.title).not.toContain("\ufffd");
    expect(canvasFileDraft("a\r\n.txt", bytes("")).title).toBe("a  .txt");
    expect(canvasFileDraft("empty.txt", new Uint8Array()).content).toBe("");
  });
});
