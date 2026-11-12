import type {
  SkillResultCheck,
  SkillResultEvaluation,
  SkillResultReport
} from "@cosmora/contracts";

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/m;

/** Deterministic, model-free evaluation of an answer against EXPLICIT criteria.
 *
 * Deliberately conservative: it never judges truth, never normalizes numbers
 * (so "19 700" and "19700" are different literals), and never invents a score.
 * Style fidelity is reported separately from correctness — see `not_checked`. */
export const evaluateSkillResult = (input: SkillResultEvaluation): SkillResultReport => {
  const checks: SkillResultCheck[] = [];

  const listLike = BULLET.test(input.answer);
  const formatOk = input.format === "any" || (input.format === "bullets" ? listLike : !listLike);
  checks.push({
    criterion: "format",
    passed: formatOk,
    detail: formatOk
      ? `Формат «${input.format}» соблюдён.`
      : `Формат «${input.format}» нарушен: ${input.format === "bullets" ? "нет маркеров списка" : "обнаружены маркеры списка"}.`
  });

  const missingFacts = input.required_facts.filter((fact) => !input.answer.includes(fact));
  checks.push({
    criterion: "facts_preserved",
    passed: missingFacts.length === 0,
    detail:
      missingFacts.length === 0
        ? `Все ${input.required_facts.length} обязательных фактов найдены в ответе.`
        : `Не найдены факты исходника: ${missingFacts.map((f) => JSON.stringify(f)).join(", ")}.`
  });

  const violated = input.forbidden.filter((rule) => input.answer.includes(rule));
  checks.push({
    criterion: "constraints_followed",
    passed: violated.length === 0,
    detail:
      violated.length === 0
        ? `Все ${input.forbidden.length} явных ограничений соблюдены.`
        : `Нарушены ограничения: ${violated.map((r) => JSON.stringify(r)).join(", ")}.`
  });

  return {
    format: "kosmora.skill-result-evaluation.v1",
    passed: checks.every((check) => check.passed),
    checks,
    not_checked: ["truth", "intelligence", "benchmark_gain"]
  };
};
