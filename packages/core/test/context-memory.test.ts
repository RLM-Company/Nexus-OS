import { describe, expect, it } from "vitest";
import type { ContextMemoryBundle, GeneralChatMessage } from "@cosmora/contracts";
import { ChatService, MemoryContextIncompleteError } from "../src/index.js";

const service = new ChatService({
  preferredProvider: "mock",
  preferredModelAlias: "chat",
  fallbackAllowed: false,
  systemPrompt: "Safe system."
});
const message = (content: string): GeneralChatMessage => ({
  id: "m",
  chat_id: "chat",
  role: "user",
  content_type: "text",
  content,
  status: "completed",
  run_id: "run",
  error_code: null,
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T00:00:00Z"
});
const bundle = (required = false): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "chat" },
  omitted: 0,
  priority_omitted: 0,
  bytes: 0,
  budget_bytes: 6000,
  retrieval: "lexical",
  items: [
    {
      reference: "M:fixture",
      kind: "memory",
      title: "Old detail",
      text: "Archived detail ".repeat(300),
      memory_kind: required ? "constraint" : "fact",
      priority: required,
      source: null,
      excerpt_only: false
    }
  ]
});
describe("adaptive context packing", () => {
  it("keeps a large valid current question intact instead of rejecting it because of optional memory", () => {
    const content = "q".repeat(27000);
    const request = service.buildRequest({
      chatId: "chat",
      runId: "run",
      messages: [message(content)],
      recalledMemory: bundle()
    });
    expect(request.messages.findLast((m) => m.role === "user")?.content).toBe(content);
    expect(request.routing.estimated_input_tokens).toBeLessThanOrEqual(28000);
  });
  it("never drops mandatory memory to make the current question fit", () => {
    expect(() =>
      service.buildRequest({
        chatId: "chat",
        runId: "run",
        messages: [message("q".repeat(27000))],
        recalledMemory: bundle(true)
      })
    ).toThrow(MemoryContextIncompleteError);
  });
  it("preserves a current photo and prompt, reducing optional recalled material first", () => {
    const content = "Inspect this image. " + "q".repeat(6500);
    const current = message(content);
    current.attachments = [
      {
        kind: "image",
        name: "fixture.png",
        media_type: "image/png",
        data_base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII="
      }
    ];
    const request = service.buildRequest({
      chatId: "chat",
      runId: "run",
      messages: [current],
      recalledMemory: bundle()
    });
    const user = request.messages.findLast((m) => m.role === "user")!;
    expect(user.content).toContain(content);
    expect(user.content).not.toContain("Archived detail");
    expect(user.images).toHaveLength(1);
    expect(request.routing.required_features).toContain("vision");
    expect(request.routing.estimated_input_tokens).toBeLessThanOrEqual(28000);
  });
});
