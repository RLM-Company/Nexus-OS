import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_LIMITS,
  isValidChatAttachments
} from "@cosmora/contracts/chat-attachments";
import { decodeChatAttachment, decodeStudioDocument } from "./decode-chat-attachment";

const textFile = (name: string, content: string) =>
  new File([new TextEncoder().encode(content)], name, { type: "text/plain" });

describe("K04: честная граница чтения текстовых вложений", () => {
  it("decodeChatAttachment не усекает текст молча: содержимое возвращается целиком", async () => {
    const content = "Строка ".repeat(2000); // заведомо больше 8000 символов
    expect(content.length).toBeGreaterThan(CHAT_ATTACHMENT_LIMITS.charactersPerFile);
    const attachment = await decodeChatAttachment(textFile("draft.txt", content));
    expect("content" in attachment).toBe(true);
    if ("content" in attachment) {
      expect(attachment.content).toBe(content);
      expect(attachment.content).not.toMatch(/[.]{3}$/);
    }
  });

  it("isValidChatAttachments явно отклоняет вложение сверх лимита символов, а не обрезает его", () => {
    const tooLong = "a".repeat(CHAT_ATTACHMENT_LIMITS.charactersPerFile + 1);
    const ok = "b".repeat(CHAT_ATTACHMENT_LIMITS.charactersPerFile);
    expect(isValidChatAttachments([{ name: "ok.txt", content: ok }])).toBe(true);
    expect(isValidChatAttachments([{ name: "long.txt", content: tooLong }])).toBe(false);
  });

  it("decodeStudioDocument: boundedText отклоняет слишком большой text с явным сообщением, не усекая молча", async () => {
    const tooBig = "x".repeat(2_000_001);
    await expect(
      decodeStudioDocument(textFile("big.txt", tooBig), new AbortController().signal, () => {})
    ).rejects.toThrow(/больше 2 000 000 символов/);
  });

  it("decodeStudioDocument: текст в пределах лимита возвращается целиком", async () => {
    const content = "Содержимое ".repeat(100);
    const result = await decodeStudioDocument(
      textFile("ok.txt", content),
      new AbortController().signal,
      () => {}
    );
    expect(result).toBe(content);
  });

  it("сообщение об ошибке в UI называет лимит 8 000 символов (не молчаливое усечение)", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/chat-attachments.tsx", "utf8")
    );
    expect(source).toContain("8 000 символов");
  });
});
