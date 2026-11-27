import { expect, it } from "vitest";
import { compileSpecialization } from "../src/specialization-compiler.js";

it("compiles an owner specialization into an inert SkillDraft", () => {
  const draft = compileSpecialization({
    name: "Отчёт по закупкам",
    summary: "Сравнение предложений с проверкой источников",
    goal: "Подготовить сравнение поставщиков по разрешённым данным",
    scope: "закупки малого объёма",
    examples: ["Два предложения с валютой и сроками"],
    style: "Коротко, с таблицей и явными пробелами",
    sources: ["разрешённый прайс v3"],
    tools: ["supplier-comparison"],
    criteria: ["все суммы имеют валюту", "неизвестные расходы помечены"]
  });
  expect(draft.format).toBe("kosmora.specialization-draft.v1");
  expect(draft.accepted).toBe(false);
  expect(draft.instructions).toContain("supplier-comparison");
  expect(draft.instructions).toContain("не выдумывай факты");
  expect(draft.not_granted).toContain("tool execution rights");
});
