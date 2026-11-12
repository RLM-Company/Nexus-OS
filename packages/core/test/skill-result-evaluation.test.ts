import { describe, expect, it } from "vitest";
import type { SkillResultEvaluation } from "@cosmora/contracts";
import { evaluateSkillResult } from "../src/skill-result-evaluation.js";

const base = (extra: Partial<SkillResultEvaluation> = {}): SkillResultEvaluation => ({
  source: "Бюджет 19 700 ₽, код 00123, кроме доставки.",
  answer: "- Сумма 19 700 ₽\n- Код 00123\n- Кроме доставки",
  required_facts: ["19 700 ₽", "00123"],
  forbidden: ["21 000"],
  format: "bullets",
  ...extra
});

describe("skill result evaluation (style/structure only)", () => {
  it("passes when format, facts and constraints hold", () => {
    const report = evaluateSkillResult(base());
    expect(report.passed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
    expect(report.format).toBe("kosmora.skill-result-evaluation.v1");
  });

  it("always declares what it does NOT check", () => {
    const report = evaluateSkillResult(base());
    expect(report.not_checked).toEqual(["truth", "intelligence", "benchmark_gain"]);
    expect(JSON.stringify(report)).not.toContain("score");
    expect(JSON.stringify(report)).not.toContain("confidence");
  });

  it("reports a missing source fact without normalizing numbers", () => {
    const report = evaluateSkillResult(base({ answer: "- Сумма 19700\n- Код 00123" }));
    expect(report.passed).toBe(false);
    const facts = report.checks.find((c) => c.criterion === "facts_preserved")!;
    expect(facts.passed).toBe(false);
    expect(facts.detail).toContain("19 700 ₽");
  });

  it("reports a violated explicit constraint", () => {
    const report = evaluateSkillResult(base({ answer: "- Итого 21 000 ₽" }));
    const constraints = report.checks.find((c) => c.criterion === "constraints_followed")!;
    expect(constraints.passed).toBe(false);
    expect(constraints.detail).toContain("21 000");
  });

  it("checks plain format separately from style correctness", () => {
    const report = evaluateSkillResult(base({ format: "plain" }));
    const format = report.checks.find((c) => c.criterion === "format")!;
    expect(format.passed).toBe(false);
    // The answer can be stylistically fine and still fail the format criterion.
    expect(report.checks.find((c) => c.criterion === "facts_preserved")!.passed).toBe(true);
  });

  it("never judges truth: a false answer with all literals present still passes", () => {
    const report = evaluateSkillResult(
      base({ answer: "- Сумма 19 700 ₽\n- Код 00123\n- Доставка включена" })
    );
    expect(report.passed).toBe(true);
    expect(report.not_checked).toContain("truth");
  });
});
