import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyProjectRules,
  type RuleLike,
  type SupplierRow
} from "../src/project-correction-rules.js";

/** Сопоставимые данные для трёх прогонов. */
const suppliers: SupplierRow[] = [
  { supplier: "Поставщик А", price: "100 ₽", delivery: "3 дня" },
  { supplier: "Поставщик Б", price: "90 ₽", delivery: "7 дней" }
];
const accepted: RuleLike = {
  id: "rule-1",
  name: "Правка владельца",
  instructions:
    "Учитывай это исправление владельца как пожелание к ответу: в сравнении поставщиков всегда показывай доставку отдельной строкой",
  version: 1,
  enabled: true
};

describe("project rule application — three comparable runs", () => {
  it("run 1: no rule — delivery stays in the same line", () => {
    const report = applyProjectRules(suppliers, []);
    expect(report.lines).toEqual([
      "Поставщик А: 100 ₽ (доставка 3 дня)",
      "Поставщик Б: 90 ₽ (доставка 7 дней)"
    ]);
    expect(report.applied_rule_versions).toEqual([]);
  });

  it("run 2: accepted rule — separate delivery line with saved version", () => {
    const report = applyProjectRules(suppliers, [accepted]);
    expect(report.lines).toEqual([
      "Поставщик А: 100 ₽",
      "Доставка: 3 дня",
      "Поставщик Б: 90 ₽",
      "Доставка: 7 дней"
    ]);
    expect(report.applied_rule_versions).toEqual([
      { id: "rule-1", version: 1, effect: "delivery_separate_line" }
    ]);
  });

  it("run 3: after disable — original output, version stays in history of run 2", () => {
    const report = applyProjectRules(suppliers, [{ ...accepted, enabled: false }]);
    expect(report.lines).toEqual([
      "Поставщик А: 100 ₽ (доставка 3 дня)",
      "Поставщик Б: 90 ₽ (доставка 7 дней)"
    ]);
    expect(report.applied_rule_versions).toEqual([]);
    expect(accepted.version).toBe(1);
  });

  it("writes comparable artifacts so the change is visible in files", () => {
    const dir = join(
      process.cwd(),
      "..",
      "..",
      "docs",
      "team",
      "operation-2026-11-25",
      "correction-rules"
    );
    for (const [name, rules, versions] of [
      ["run-1-no-rule.txt", [], []],
      ["run-2-rule-accepted.txt", [accepted], [{ id: "rule-1", version: 1 }]],
      ["run-3-rule-disabled.txt", [{ ...accepted, enabled: false }], []]
    ] as const) {
      const report = applyProjectRules(suppliers, rules);
      writeFileSync(
        join(dir, name),
        [
          "Сравнение поставщиков",
          ...report.lines,
          `применённые версии правил: ${JSON.stringify(report.applied_rule_versions)}`,
          ""
        ].join("\n"),
        "utf8"
      );
      expect(report.applied_rule_versions).toHaveLength(versions.length);
    }
  });
});
