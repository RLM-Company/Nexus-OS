import { describe, expect, it } from "vitest";
import {
  GeneralChatStore,
  IdempotencyConflictError,
  openDatabase,
  runMigrations
} from "../src/index.js";

describe("GeneralChatStore", () => {
  it("persists ordinary chat history independently from projects", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const store = new GeneralChatStore(database.sqlite);
      const accepted = store.createChat("Обычный вопрос", "chat-client-1");
      const duplicate = store.createChat("Обычный вопрос", "chat-client-1");

      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.chat.id).toBe(accepted.chat.id);
      expect(store.listChats()).toEqual([
        expect.objectContaining({ id: accepted.chat.id, last_message_preview: "Обычный вопрос" })
      ]);
      expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get()).toMatchObject(
        { count: 0 }
      );

      const assistant = store.startAssistantMessage(accepted.run.id);
      expect(assistant).toMatchObject({ role: "assistant", status: "streaming" });
      store.reserveModelUsage(accepted.run.id, {
        attempt: 0,
        registry_version: "registry-1",
        provider_id: "mock",
        model_id: "manager-b0.1",
        estimated_input_tokens: 20,
        max_output_tokens: 100,
        estimated_cost: { amount: 0, currency: "USD" }
      });
      store.appendAssistantDelta(assistant?.id ?? "", "Ответ готов");
      store.completeRun(
        accepted.run.id,
        "mock",
        "manager-b0.1",
        { inputTokens: 4, outputTokens: 3 },
        { attempt: 0, calculatedCost: { amount: 0, currency: "USD" } }
      );

      expect(store.getRun(accepted.run.id)).toMatchObject({ status: "succeeded" });
      expect(store.listMessages(accepted.chat.id)).toEqual([
        expect.objectContaining({ role: "user", content: "Обычный вопрос" }),
        expect.objectContaining({ role: "assistant", content: "Ответ готов", status: "completed" })
      ]);
      expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
        expect.objectContaining({ status: "committed", actual_output_tokens: 3 })
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps idempotency owner-scoped and rejects changed payloads", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const store = new GeneralChatStore(database.sqlite);
      store.createChat("Первый", "same-key", "owner-a");
      expect(() => store.createChat("Другой", "same-key", "owner-a")).toThrow(
        IdempotencyConflictError
      );
      const otherOwner = store.createChat("Независимый", "same-key", "owner-b");
      expect(otherOwner.chat.title).toBe("Независимый");
      expect(store.listChats("owner-b")).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
