import { describe, expect, it } from "vitest";
import type { ChatSkillSnapshot } from "@cosmora/contracts";
import { ChatService } from "../src/chat.js";

const service = new ChatService({
  preferredProvider: "mock",
  preferredModelAlias: "chat",
  fallbackAllowed: false
});
const skill = (
  name: string,
  instructions: string,
  scope: ChatSkillSnapshot["scope"] | undefined
): ChatSkillSnapshot => ({
  skill_id: name,
  version: 1,
  name,
  summary: name,
  instructions,
  ...(scope ? { scope } : {})
});
const request = (skills?: ChatSkillSnapshot[]) => {
  const result = service.buildRequest({
    chatId: "chat",
    runId: "run",
    messages: [
      {
        id: "m1",
        chat_id: "chat",
        role: "user",
        content: "Сделай отчёт",
        content_type: "text",
        status: "completed",
        run_id: null,
        error_code: null,
        created_at: "2026-11-12T10:00:00Z",
        updated_at: "2026-11-12T10:00:00Z"
      }
    ],
    ...(skills ? { skills } : {})
  });
  const last = result.messages.findLast((m) => m.role === "user");
  return last?.content ?? "";
};

describe("skill precedence and explicit source", () => {
  it("renders skills in fixed precedence with visible scope", () => {
    const text = request([
      skill("OwnerRule", "пиши кратко", "owner"),
      skill("ProjectRule", "используй таблицы", "project"),
      skill("ChatRule", "отвечай по-русски", "chat"),
      skill("TaskRule", "только факты", "task")
    ]);
    expect(text).toContain("Приоритет: task > chat > project > owner");
    const positions = ["[task]", "[chat]", "[project]", "[owner]"].map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain("только факты");
    expect(text).toContain("Сделай отчёт");
  });

  it("keeps the owner's message and marks skills as non-system data", () => {
    const text = request([skill("Rule", "будь краток", "chat")]);
    expect(text).toContain("не системные правила");
    expect(text).toContain("не дают прав или инструментов");
    expect(text.endsWith("Сделай отчёт")).toBe(true);
  });

  it("disabling skills removes every rule (no hidden learning)", () => {
    const text = request([]);
    expect(text).not.toContain("Приоритет:");
    expect(text).not.toContain("[chat]");
    expect(text).not.toContain("Выбранные пользователем Skills");
  });

  it("older snapshots without scope default to owner, never to a higher priority", () => {
    const legacy: ChatSkillSnapshot = {
      skill_id: "Legacy",
      version: 1,
      name: "Legacy",
      summary: "Legacy",
      instructions: "старое правило"
    };
    const text = request([legacy, skill("ChatRule", "новое правило", "chat")]);
    expect(text.indexOf("[chat]")).toBeLessThan(text.indexOf("[owner]"));
    expect(text).toContain("[owner] Legacy v1: старое правило");
  });
});
