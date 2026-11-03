import { describe, expect, it } from "vitest";
import type { ContextMemoryBundle, GeneralChatMessage } from "@cosmora/contracts";
import { ChatService, MemoryContextIncompleteError, contextMemoryUsage } from "../src/index.js";

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
  it("uses the current question to choose optional evidence in a real chat request", () => {
    const limited = new ChatService({
      preferredProvider: "mock",
      preferredModelAlias: "chat",
      fallbackAllowed: false,
      systemPrompt: "Safe system.",
      contextWindowTokens: 6000
    });
    const source = bundle().items[0]!;
    const request = limited.buildRequest({
      chatId: "chat",
      runId: "selection",
      messages: [message("Найди договор")],
      recalledMemory: {
        ...bundle(),
        items: [
          { ...source, reference: "M:old", text: "x".repeat(1400) },
          { ...source, reference: "M:relevant", text: "Договор " + "x".repeat(1390) }
        ]
      }
    });
    expect(contextMemoryUsage(request).sources.map((e) => e.reference)).toEqual(["M:relevant"]);
    expect(request.messages.at(-1)!.content).toContain("Найди договор");
  });
  it("uses the same expanded budget for mandatory memory and a large current question", () => {
    const expanded = new ChatService({
      preferredProvider: "external",
      preferredModelAlias: "sol",
      fallbackAllowed: false,
      contextWindowTokens: 1050000
    });
    const current = "q".repeat(50000);
    const request = expanded.buildRequest({
      chatId: "chat",
      runId: "large-memory",
      messages: [message(current)],
      recalledMemory: bundle(true)
    });
    expect(request.messages.at(-1)!.content).toContain(current);
    expect(request.messages.at(-1)!.content).toContain("Archived detail");
    expect(request.routing.estimated_input_tokens).toBeGreaterThan(32000);
  });
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
