import { describe, expect, it } from "vitest";
import { parseGraphImportAttempt, graphImportAttemptSlot } from "./import-attempt";
describe("graph import attempt metadata", () => {
  it("stores only key and digest in a project-specific slot", () => {
    const saved = { creation_key: "attempt_0123456789abcdef", sha256: "a".repeat(64) };
    expect(parseGraphImportAttempt(JSON.stringify(saved))).toEqual(saved);
    expect(parseGraphImportAttempt(null)).toBeNull();
    expect(graphImportAttemptSlot("a/b")).not.toBe(graphImportAttemptSlot("a%2Fb"));
  });
  it.each([
    "{}",
    '{"creation_key":"short","sha256":"x"}',
    JSON.stringify({
      creation_key: "attempt_0123456789abcdef",
      sha256: "a".repeat(64),
      package: "private text"
    }),
    "x".repeat(513)
  ])("rejects corrupt or content-bearing metadata %s", (value) => {
    expect(() => parseGraphImportAttempt(value)).toThrow();
  });
});
