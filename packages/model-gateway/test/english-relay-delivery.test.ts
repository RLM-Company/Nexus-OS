import { describe, expect, it } from "vitest";
import { protectRelayText, inspectRelayAttachment } from "../src/english-relay/protect.js";

describe("adapted Relay protected fragments", () => {
  it("preserves nested JSON, arrays, escaped braces, commands and replacement metacharacters", () => {
    const json = JSON.stringify({
      outer: { inner: { value: 'Русский {текст} и \\"кавычки\\"' } },
      items: [{ name: "Иван" }]
    });
    const source = `Объясни ${json} и [1,{"id":"абв"}]\n$ node script.mjs --format='$& $\u0060 $\u0027 $$'`;
    const safe = protectRelayText(source);
    expect(safe.text).not.toContain("Русский");
    expect(safe.text).not.toContain('"абв"');
    expect(safe.restore(safe.text.replace("Объясни", "Explain"))).toBe(
      source.replace("Объясни", "Explain")
    );
  });
  it("preserves API paths and uppercase identifiers and rejects forged markers", () => {
    const source =
      "Проверь /api/v1/chats и SHA256:" +
      "A".repeat(64) +
      " UUID 123E4567-E89B-42D3-A456-426614174000";
    const safe = protectRelayText(source);
    expect(safe.text).not.toContain("/api/v1/chats");
    expect(safe.text).not.toContain("123E4567");
    expect(safe.restore(safe.text)).toBe(source);
    expect(() => protectRelayText("Проверь KM_PROTECTED_9999_END")).toThrow();
    expect(() => safe.restore(safe.text.replace("KM_PROTECTED_0000_END", ""))).toThrow();
  });
  it("keeps two-column CSV and semicolon tables ineligible for translation", () => {
    for (const content of ["id,name\n1,Иван", "id;name\n1;Иван"])
      expect(
        inspectRelayAttachment({ name: "notes.txt", mime_type: "text/plain", content }).translatable
      ).toBe(false);
  });
});
