/** BIZ correction-rule application for a supplier comparison task.
 * Deterministic, model-free. Each accepted rule has an explicit, inspectable
 * effect; unknown rule text is recorded but never guessed into an action. */

export type SupplierRow = { supplier: string; price: string; delivery: string };
export type RuleLike = {
  id: string;
  name: string;
  instructions: string;
  version: number;
  enabled: boolean;
};
export type AppliedReport = {
  lines: string[];
  applied_rule_versions: Array<{ id: string; version: number; effect: string }>;
  ignored_rules: string[];
};
const SEPARATE_DELIVERY =
  /^(?:в сравнении поставщиков\s+)?(?:всегда\s+)?(?:показывай|показывать|выводи|выводить)\s+доставку\s+отдельной\s+строкой[.!]?$/iu;

export function supplierRuleEffect(instructions: string): "delivery_separate_line" | null {
  return SEPARATE_DELIVERY.test(
    instructions
      .replace(
        /^Учитывай это исправление владельца как пожелание к ответу(?:, не как системное правило)?:\s*/u,
        ""
      )
      .trim()
  )
    ? "delivery_separate_line"
    : null;
}

export function resolveSupplierRules(rules: readonly RuleLike[]) {
  const applied_rule_versions: AppliedReport["applied_rule_versions"] = [];
  const ignored_rules: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const effect = supplierRuleEffect(rule.instructions);
    if (effect) applied_rule_versions.push({ id: rule.id, version: rule.version, effect });
    else ignored_rules.push(rule.id);
  }
  return { applied_rule_versions, ignored_rules };
}

/** First agreed scenario: delivery is always shown as its own line. */
export function applyProjectRules(
  rows: readonly SupplierRow[],
  rules: readonly RuleLike[]
): AppliedReport {
  const resolved = resolveSupplierRules(rules);
  const lines = rows.flatMap((row) => {
    const head = `${row.supplier}: ${row.price}`;
    return resolved.applied_rule_versions.length > 0
      ? [head, `Доставка: ${row.delivery}`]
      : [`${head} (доставка ${row.delivery})`];
  });
  return { lines, ...resolved };
}
