import type { GeneralChatMessage } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { ChatService } from "../src/index.js";

const message = (role: "user" | "assistant", content: string): GeneralChatMessage => ({
  id: `${role}-${content}`,
  chat_id: "chat-1",
  role,
  content_type: "text",
  content,
  status: "completed",
  run_id: "run-1",
  error_code: null,
  created_at: "2026-09-16T10:00:00.000Z",
  updated_at: "2026-09-16T10:00:00.000Z"
});

describe("ChatService", () => {
  it("builds an ordinary-chat request without Manager authority", () => {
    const chat = new ChatService({
      preferredProvider: "mock",
      preferredModelAlias: "manager",
      fallbackAllowed: true
    });
    const request = chat.buildRequest({
      chatId: "chat-1",
      runId: "run-2",
      messages: [message("user", "Привет"), message("assistant", "Здравствуйте")]
    });

    expect(request).toMatchObject({
      project_id: "chat-1",
      role: "assistant",
      task_type: "chat_response",
      idempotency_key: "chat-run:run-2"
    });
    expect(request.messages.slice(1)).toEqual([
      { role: "user", content: "Привет" },
      { role: "assistant", content: "Здравствуйте" }
    ]);
    expect(request.messages[0]?.content).toContain("Обычный чат не является проектом");
    expect(request.messages[0]?.content).toContain(
      "внешние действия из обычного чата не выполняются"
    );
  });
});
