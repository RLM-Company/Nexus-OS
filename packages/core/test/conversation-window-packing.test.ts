import type { ModelMessage } from "@cosmora/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  conversationWindow,
  estimateInputTokensUpperBound,
  ContextTooLargeError
} from "../src/conversation-window.js";
import { legacyConversationWindow } from "./fixtures/context-packing-reference.js";

const prefix = (): ModelMessage[] => [
  { role: "system", content: "System" },
  { role: "user", content: "Pinned requirements" }
];
const outcome = (fn: () => unknown) => {
  try {
    return { value: fn() };
  } catch (error) {
    return { error: (error as Error).name };
  }
};

describe("linear conversation selection", () => {
  it("retains the newest complete tool exchange and the original input objects", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "old".repeat(3000) },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }
        ]
      },
      { role: "tool", content: "file contents", tool_call_id: "call_1" },
      { role: "assistant", content: "Summary" },
      { role: "user", content: "Continue" }
    ];
    const fixed = prefix();
    input.forEach(Object.freeze);
    Object.freeze(input);
    Object.freeze(fixed);
    const result = conversationWindow(fixed, input, 1500);
    expect(result.slice(fixed.length)).toEqual(input.slice(2));
    expect(result.at(-1)).toBe(input.at(-1));
    expect(result[0]!.content).toContain("Ранние сообщения");
    expect(fixed[0]!.content).toBe("System");
    expect(estimateInputTokensUpperBound(result)).toBeLessThanOrEqual(1500);
    const warning = result[0]!.content.slice(fixed[0]!.content.length);
    // The existing Russian warning fits its legacy 256-byte reserve: no claim
    // that it already overflowed, and no second subtraction of that reserve.
    expect(new TextEncoder().encode(warning).length).toBeLessThanOrEqual(256);
  });
  it("rejects an oversized prefix even when conversation is empty", () => {
    const fixed: ModelMessage[] = [{ role: "system", content: "Pinned ".repeat(1000) }];
    expect(estimateInputTokensUpperBound(legacyConversationWindow(fixed, [], 100))).toBeGreaterThan(
      100
    );
    expect(() => conversationWindow(fixed, [], 100)).toThrow(ContextTooLargeError);
    expect(conversationWindow([], [], 0)).toEqual([]);
  });
  it("never removes part of the latest group or a current image to fit", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "Current" },
      { role: "assistant", content: "x".repeat(5000) }
    ];
    expect(() => conversationWindow(prefix(), input, 1000)).toThrow(ContextTooLargeError);
    expect(() =>
      conversationWindow(
        [],
        [
          {
            role: "user",
            content: "Photo",
            images: [{ media_type: "image/png", data_base64: "synthetic" }]
          }
        ],
        1000
      )
    ).toThrow(ContextTooLargeError);
  });
  it("matches the old contiguous-history behavior for varied budgets", () => {
    for (let trial = 0; trial < 40; trial++) {
      const input: ModelMessage[] = Array.from({ length: 1 + trial }, (_, i) => [
        { role: "user" as const, content: `${i}:` + "а😀\\\n".repeat((i * 13 + trial) % 91) },
        { role: "assistant" as const, content: `Answer ${i}` }
      ]).flat();
      for (const budget of [512, 1000, 2000, 8000, 100000]) {
        const actual = outcome(() => conversationWindow(prefix(), input, budget));
        expect(actual).toEqual(outcome(() => legacyConversationWindow(prefix(), input, budget)));
        if ("value" in actual)
          expect(estimateInputTokensUpperBound(actual.value as ModelMessage[])).toBeLessThanOrEqual(
            budget
          );
      }
    }
  });
  it("does not encode unreachable older groups after the first excluded turn", () => {
    const input: ModelMessage[] = [
      { role: "user", content: "UNVISITED".repeat(10000) },
      { role: "user", content: "too large".repeat(1000) },
      { role: "user", content: "latest" }
    ];
    const encode = TextEncoder.prototype.encode.bind(new TextEncoder());
    let encodedUnvisited = false;
    const spy = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      text?: string
    ) {
      encodedUnvisited ||= text?.includes("UNVISITED") ?? false;
      return encode(text);
    });
    try {
      expect(conversationWindow(prefix(), input, 1000).at(-1)!.content).toBe("latest");
    } finally {
      spy.mockRestore();
    }
    expect(encodedUnvisited).toBe(false);
  });
  it("keeps long full histories in original order", () => {
    const input: ModelMessage[] = Array.from({ length: 20000 }, (_, i) => ({
      role: "user",
      content: `Turn ${i}`
    }));
    const result = conversationWindow([], input, 1000000);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
  it("rejects malformed budgets", () => {
    for (const budget of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => conversationWindow([], [], budget)).toThrow(RangeError);
  });
});
