import { describe, expect, it } from "vitest";
import {
  aiWorkChainGoal,
  aiWorkChainSource,
  parseAiWorkChain,
  requestsAiWorkChain
} from "./ai-work-chain";

describe("AI Work chain", () => {
  const steps = [
    { title: "Бриф", goal: "Сохранить перечень требований." },
    { title: "Проверка", goal: "Сверить итог с брифом." }
  ];

  it("wraps and recovers the goal without mistaking ordinary work for planning", () => {
    const goal = "Работай до конца задачи: подготовь итог";
    expect(aiWorkChainSource(aiWorkChainGoal(goal))).toBe(goal);
    expect(aiWorkChainSource(goal)).toBeNull();
    expect(requestsAiWorkChain(goal)).toBe(true);
    expect(requestsAiWorkChain("Работай до конца лимитов. Сделай отчёт")).toBe(true);
    expect(requestsAiWorkChain("Не работай до конца лимитов")).toBe(false);
    expect(requestsAiWorkChain("Объясни команду «работай до конца задачи»")).toBe(false);
  });

  it("uses server-compatible sequential dependencies and strips model-supplied authority", () => {
    const plan = parseAiWorkChain(
      JSON.stringify({
        title: "Проверенный итог",
        steps: [{ ...steps[0], depends_on: ["step-2"], approve: true }, steps[1]]
      })
    );
    expect(plan.nodes).toEqual([
      { ...steps[0], id: "step-1", depends_on: [] },
      { ...steps[1], id: "step-2", depends_on: ["step-1"] }
    ]);
  });

  it.each([
    "{}",
    '{"title":"Итог","steps":[]}',
    JSON.stringify({ title: "Итог", steps: [steps[0], { title: "Шаг", goal: 7 }] })
  ])("rejects incomplete or invalid proposals before import", (text) =>
    expect(() => parseAiWorkChain(text)).toThrow()
  );
});
