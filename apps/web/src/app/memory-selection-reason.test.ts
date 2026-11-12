import { describe, expect, it } from "vitest";
import type { ContextMemoryEvidence } from "@cosmora/contracts/context-memory";
import { selectionReason } from "./memory-selection-reason.js";

const evidence = (extra: Partial<ContextMemoryEvidence> = {}): ContextMemoryEvidence => ({
  reference: "M:entry-1",
  kind: "memory",
  title: "Бюджет",
  text: "19 700 ₽, кроме доставки.",
  source: null,
  excerpt_only: false,
  ...extra
});

describe("memory source selection diagnostics (slice B)", () => {
  it("explains a matched source with a real quote and retrieval rank", () => {
    const reason = selectionReason(
      evidence({
        matched: true,
        retrieval_rank: 1,
        source: {
          kind: "chat_message",
          message_id: "m1",
          chat_id: "c1",
          project_id: null,
          role: "user",
          quote: "19 700 ₽",
          sha256: "a".repeat(64)
        }
      })
    );
    expect(reason).toContain("совпало с запросом");
    expect(reason).toContain("порядок поиска 1");
    expect(reason).toContain("источник: сообщение владельца");
    expect(reason).toContain("точная цитата сохранена");
    expect(reason).not.toContain("ответ ИИ");
  });

  it("marks a mandatory constraint as context, never as an answer", () => {
    const reason = selectionReason(
      evidence({ kind: "memory", memory_kind: "constraint", priority: true, matched: false })
    );
    expect(reason).toContain("обязательная запись, не ответ на вопрос");
    expect(reason).not.toContain("совпало с запросом");
    expect(reason).toContain("без привязки к исходному сообщению");
  });

  it("labels an assistant claim honestly and an excerpt as incomplete", () => {
    const reason = selectionReason(
      evidence({
        excerpt_only: true,
        source: {
          kind: "chat_message",
          message_id: "m2",
          chat_id: "c1",
          project_id: null,
          role: "assistant",
          quote: "",
          sha256: "b".repeat(64)
        }
      })
    );
    expect(reason).toContain("источник: ответ ИИ");
    expect(reason).toContain("неполная выдержка");
    expect(reason).toContain("тематический контекст, не ответ на вопрос");
  });

  it("never invents a score, confidence or permission", () => {
    const reason = selectionReason(evidence());
    for (const forbidden of ["уверенность", " Confidence", "разрешение", "процент", "0.9"])
      expect(reason).not.toContain(forbidden);
  });
});
