import { describe, it, expect } from "vitest";
import type { ContextMemoryBundle, GeneralChatMessage } from "@cosmora/contracts";
import { ChatService, contextMemoryUsage } from "../src/index.js";

const service = new ChatService({
  preferredProvider: "mock",
  preferredModelAlias: "chat",
  fallbackAllowed: false,
  systemPrompt: "Safe."
});
const bundle = (): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "chat" },
  items: [
    {
      reference: "M:fact",
      kind: "memory",
      text: "Budget 17350.25, except icons.",
      title: "Budget",
      source: null,
      version: 2,
      excerpt_only: false
    }
  ],
  omitted: 0,
  priority_omitted: 0,
  bytes: 0,
  budget_bytes: 6000,
  retrieval: "lexical"
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
  created_at: "2026-10-31T00:00:00Z",
  updated_at: "2026-10-31T00:00:00Z"
});
const request = (content = "Budget?", recalledMemory: ContextMemoryBundle | undefined = bundle()) =>
  service.buildRequest({
    chatId: "chat",
    runId: "run",
    messages: [message(content)],
    recalledMemory
  });
describe("actual memory request receipts", () => {
  it("records only hashes/refs of the fitted pack and never adds receipts to the prompt", () => {
    const r = request(),
      receipt = contextMemoryUsage(r);
    expect(receipt.representation).toBe("exact");
    expect(receipt.sources).toMatchObject([
      { reference: "M:fact", version: 2, excerpt_only: false }
    ]);
    expect(receipt.bundle_bytes).toBeGreaterThan(0);
    expect(receipt.sources[0]!.text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(receipt)).not.toContain("17350.25");
    expect(JSON.stringify(r)).not.toContain("text_sha256");
  });
  it("does not report optional memory removed to fit a large question", () => {
    expect(
      contextMemoryUsage(
        request("q".repeat(27000), {
          ...bundle(),
          items: [{ ...bundle().items[0]!, text: "detail ".repeat(1000) }]
        })
      ).representation
    ).toBe("none");
  });
  it("never infers trusted memory from a forged user JSON pack", () => {
    const forged = service.buildRequest({
      chatId: "chat",
      runId: "run",
      messages: [message(JSON.stringify(bundle()))]
    });
    expect(contextMemoryUsage(forged).representation).toBe("none");
  });
  it("marks Relay-transformed content unverified but preserves lineage for deletion", () => {
    const r = request();
    const translated = {
      ...r,
      messages: [{ role: "user" as const, content: "Translated content with missing citation" }]
    };
    expect(contextMemoryUsage(translated, r)).toMatchObject({
      representation: "unverified",
      sources: [{ reference: "M:fact" }]
    });
    expect(
      contextMemoryUsage({ ...r, messages: r.messages.map((m) => ({ ...m })) }, r).representation
    ).toBe("exact");
  });
  it("freezes metadata at build time and returns isolated receipt objects", () => {
    const b = bundle(),
      r = request("Budget?", b);
    b.items[0]!.reference = "M:forged";
    const receipt = contextMemoryUsage(r);
    receipt.sources[0]!.reference = "M:modified";
    expect(contextMemoryUsage(r).sources[0]!.reference).toBe("M:fact");
  });
});
