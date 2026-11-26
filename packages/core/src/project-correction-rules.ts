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
const SEPARATE_DELIVERY = /доставк\p{L}*\s+отдельн\p{L}*\s+строк\p{L}*/iu;

/** First agreed scenario: delivery is always shown as its own line. */
export function applyProjectRules(
  rows: readonly SupplierRow[],
  rules: readonly RuleLike[]
): AppliedReport {
  const active = rules.filter((rule) => rule.enabled);
  const separateDelivery = active.some((rule) => SEPARATE_DELIVERY.test(rule.instructions));
  const applied_rule_versions = active
    .filter((rule) => SEPARATE_DELIVERY.test(rule.instructions))
    .map((rule) => ({ id: rule.id, version: rule.version, effect: "delivery_separate_line" }));
  const ignored_rules = active
    .filter((rule) => !SEPARATE_DELIVERY.test(rule.instructions))
    .map((rule) => rule.id);
  const lines = rows.flatMap((row) => {
    const head = `${row.supplier}: ${row.price}`;
    return separateDelivery
      ? [head, `Доставка: ${row.delivery}`]
      : [`${head} (доставка ${row.delivery})`];
  });
  return { lines, applied_rule_versions, ignored_rules };
}
