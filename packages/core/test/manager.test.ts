import type { Message } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { ManagerService } from "../src/index.js";

const message = (overrides: Partial<Message>): Message => ({
  id: "message-1",
  project_id: "project-1",
  chat_id: "chat-1",
  role: "user",
  content_type: "text",
  content: "Начни работу",
  status: "completed",
  reply_to_message_id: null,
  run_id: "run-1",
  error_code: null,
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-20T10:00:00.000Z",
  ...overrides
});

describe("ManagerService", () => {
  it("builds a provider-neutral request with durable conversation history", () => {
    const manager = new ManagerService({
      preferredProvider: "primary",
      preferredModelAlias: "manager-model",
      fallbackAllowed: true,
      timeoutMs: 45_000,
      maxOutputTokens: 900
    });
    const result = manager.buildRequest({
      projectId: "project-1",
      runId: "run-2",
      messages: [
        message({ content: "Первая задача" }),
        message({ id: "message-2", role: "assistant", content: "Первый ответ" }),
        message({ id: "message-3", run_id: "run-2", content: "Уточнение" }),
        message({ id: "event-1", role: "system_event", content: "internal" })
      ]
    });

    expect(result.messages[0]).toMatchObject({ role: "system" });
    expect(result.messages.slice(1)).toEqual([
      { role: "user", content: "Первая задача" },
      { role: "assistant", content: "Первый ответ" },
      { role: "user", content: "Уточнение" }
    ]);
    expect(result.routing).toEqual({
      preferred_provider: "primary",
      preferred_model_alias: "manager-model",
      fallback_allowed: true
    });
    expect(result.constraints).toEqual({ timeout_ms: 45_000, max_output_tokens: 900 });
    expect(result.idempotency_key).toBe("manager-run:run-2");
  });

  it("forbids false claims and requires confirmation in the default contract", () => {
    const manager = new ManagerService({
      preferredProvider: "mock",
      preferredModelAlias: "manager",
      fallbackAllowed: false
    });
    const system = manager.buildRequest({
      projectId: "project-1",
      runId: "run-1",
      messages: [message({})]
    }).messages[0]?.content;

    expect(system).toContain("Не утверждай, что действие выполнено");
    expect(system).toContain("запрашивай подтверждение");
    expect(system).toContain("ключи");
  });
});
