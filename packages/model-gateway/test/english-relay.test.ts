import { describe, expect, it } from "vitest";
import { protectRelayText, RelayProtectionError } from "../src/english-relay/index.js";

describe("English Relay byte-sensitive content", () => {
  it("keeps code, URL, and paths byte-for-byte", () => {
    const original = "Объясни `const x=1;` в src/hello.ts и https://example.test/a?q=1";
    const protectedText = protectRelayText(original);
    expect(protectedText.text).not.toContain("const x=1;");
    expect(protectedText.restore(protectedText.text)).toBe(original);
  });
  it("rejects secrets before the translator sees text", () => {
    expect(() => protectRelayText("api_key = NOT_A_REAL_KEY_EXAMPLE")).toThrow(
      RelayProtectionError
    );
  });
  it("rejects JSON without changes", () => {
    expect(() => protectRelayText('{"a":1}')).toThrow(RelayProtectionError);
  });
  it("rejects missing or duplicated placeholder", () => {
    const protectedText = protectRelayText("Объясни `hi`");
    expect(() => protectedText.restore("Изменено, маркер отсутствует")).toThrow(
      RelayProtectionError
    );
    expect(() => protectedText.restore(`${protectedText.text} ${protectedText.text}`)).toThrow(
      RelayProtectionError
    );
  });
});
