import { describe, expect, it } from "vitest";
import {
  conversationWindow,
  estimateInputTokensUpperBound,
  ContextTooLargeError
} from "../src/conversation-window.js";

describe("bounded conversation context", () => {
  it("keeps complete recent turns and pinned project materials, and makes removed history explicit", () => {
    const prefix = [
      { role: "system" as const, content: "System" },
      { role: "user" as const, content: "Pinned requirements" }
    ];
    const messages = conversationWindow(prefix, [
      { role: "user", content: "x".repeat(24000) },
      { role: "assistant", content: "Old answer" },
      { role: "user", content: "y".repeat(8000) },
      { role: "assistant", content: "Recent answer" },
      { role: "user", content: "Follow up" }
    ]);
    expect(messages.map((message) => message.content)).toEqual([
      expect.stringContaining("Ранние сообщения"),
      "Pinned requirements",
      "y".repeat(8000),
      "Recent answer",
      "Follow up"
    ]);
    expect(estimateInputTokensUpperBound(messages)).toBeLessThan(28000);
    expect(prefix[0]?.content).toBe("System");
  });
  it("never silently truncates the current request or strips an image to fit", () => {
    expect(() =>
      conversationWindow(
        [{ role: "system", content: "System" }],
        [{ role: "user", content: "а".repeat(20000) }]
      )
    ).toThrow(ContextTooLargeError);
    expect(() =>
      conversationWindow(
        [],
        [
          {
            role: "user",
            content: "look",
            images: [
              { media_type: "image/png", data_base64: "image1" },
              { media_type: "image/png", data_base64: "image2" }
            ]
          }
        ]
      )
    ).toThrow(ContextTooLargeError);
  });
});
