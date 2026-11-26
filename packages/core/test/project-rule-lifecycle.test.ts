import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  explainRuleApplication,
  applyProjectRulesToWorkResult,
  SKILL_SPECIALIZATIONS,
  specializationByKey,
  type RuleLike
} from "../src/index.js";

const rule = (id: string, instructions: string, version = 1): RuleLike => ({
  id,
  name: "Правка владельца",
  instructions,
  version,
  enabled: true
});

describe("rule lifecycle explanation and new inputs", () => {
  it("explains an applied delivery rule on a new supplier set", () => {
    const content = "Север;250 ₽;5 дней\nЮг;220 ₽;11 дней";
    const report = applyProjectRulesToWorkResult(content, [
      rule("r1", "В сравнении поставщиков всегда показывай доставку отдельной строкой", 3)
    ]);
    expect(report.content).toContain("Доставка: 5 дней");
    expect(report.content).toContain("Доставка: 11 дней");
    expect(report.applied_rule_versions).toEqual([
      { id: "r1", version: 3, effect: "delivery_separate_line" }
    ]);
    expect(explainRuleApplication(report)[0]).toContain("r1 v3");
  });

  it("applies a style rule to text absent from the examples and reports why", () => {
    const report = applyProjectRulesToWorkResult("Новый текст без поставщиков о сроках.", [
      rule("style-1", "Оформи документ как в стиле проекта", 2)
    ]);
    expect(report.content).toContain("Стиль: Правка владельца");
    expect(report.rule_statuses[0]).toMatchObject({ id: "style-1", version: 2, status: "applied" });
    expect(explainRuleApplication(report)[0]).toContain("style_header");
  });

  it("shows which conflict won and makes inapplicability visible", () => {
    const conflict = applyProjectRulesToWorkResult("Север;250 ₽;5 дней", [
      rule("r1", "Доставку отдельной строкой", 1),
      rule("r2", "Доставку отдельной строкой и итог", 2)
    ]);
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0]!.ids).toEqual(["r1", "r2"]);
    expect(explainRuleApplication(conflict).join(" ")).toContain("Ни одно из них не применено");
    const inapplicable = applyProjectRulesToWorkResult("Свободный текст без таблицы.", [
      rule("r3", "Доставку отдельной строкой", 1)
    ]);
    expect(inapplicable.rule_statuses[0]!.status).toBe("ignored_not_applicable");
    expect(explainRuleApplication(inapplicable).join(" ")).toContain("Нет строк сравнения");
  });

  it("exposes three specializations with full deliverable cards", () => {
    expect(SKILL_SPECIALIZATIONS.map((pack) => pack.key)).toEqual([
      "document-analyst",
      "procurement-assistant",
      "project-style-editor"
    ]);
    for (const pack of SKILL_SPECIALIZATIONS) {
      expect(pack.task.length).toBeGreaterThan(10);
      expect(pack.inputs.length).toBeGreaterThan(0);
      expect(pack.procedure.length).toBeGreaterThan(0);
      expect(pack.tools.length).toBeGreaterThan(0);
      expect(pack.result_format.length).toBeGreaterThan(0);
      expect(pack.check_criteria.length).toBeGreaterThan(0);
    }
    expect(specializationByKey("procurement-assistant")!.title).toBe("Помощник закупок");
  });

  it("writes three comparable runs with snapshots and explanations", () => {
    const dir = join(
      process.cwd(),
      "..",
      "..",
      "docs",
      "team",
      "operation-2026-11-26",
      "rules-lifecycle"
    );
    const content = "Север;250 ₽;5 дней\nЮг;220 ₽;11 дней";
    const accepted = rule(
      "delivery-rule",
      "В сравнении поставщиков всегда показывай доставку отдельной строкой",
      4
    );
    for (const [name, rules] of [
      ["run-1-no-rule.txt", []],
      ["run-2-rule-accepted.txt", [accepted]],
      ["run-3-rule-disabled.txt", [{ ...accepted, enabled: false }]]
    ] as const) {
      const report = applyProjectRulesToWorkResult(content, rules);
      writeFileSync(
        join(dir, name),
        [
          "Вход: Север 250 ₽ / 5 дней; Юг 220 ₽ / 11 дней",
          "",
          report.content.trimEnd(),
          "",
          "Снимок версий: " + JSON.stringify(report.applied_rule_versions),
          "Объяснение:",
          ...explainRuleApplication(report).map((line) => "- " + line),
          ""
        ].join("\n"),
        "utf8"
      );
    }
  });
});
