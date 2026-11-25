/** Project correction rules applied to ordinary Koswork task results.
 * Deterministic and model-free: every rule has an explicit, inspectable effect.
 * Unknown text is recorded as `ignored` with a status, never guessed into an action.
 * Opposing active rules are reported as a visible conflict instead of silently
 * choosing one. */
import {
  applyProjectRules,
  type AppliedReport,
  type RuleLike,
  type SupplierRow
} from "./project-correction-rules.js";

export type RuleApplicationStatus =
  "applied" | "ignored_unknown" | "ignored_not_applicable" | "conflict";
export type RuleStatus = {
  id: string;
  version: number;
  status: RuleApplicationStatus;
  effect?: string;
  reason: string;
};
export type WorkRuleReport = {
  content: string;
  rule_statuses: RuleStatus[];
  applied_rule_versions: Array<{ id: string; version: number; effect: string }>;
  conflicts: Array<{ ids: string[]; reason: string }>;
  ignored_rules: string[];
};

const SEPARATE_DELIVERY = /доставк\p{L}*\s+отдельн\p{L}*\s+строк\p{L}*/iu;
const STYLE_RULE = /оформ\p{L}*\s+\p{L}+\s+(?:как|в стиле|по образцу)\p{L}*/iu;
const STYLE_MARKER = /^стиль:\s*(.+)$/iu;

/** Parse the first agreed task type: supplier comparison rows from a Work file. */
export function parseSupplierRows(content: string): SupplierRow[] {
  const rows: SupplierRow[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^ suppliers? |поставщик:/iu.test(line)) continue;
    const parts = line
      .split(/[;|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 3) continue;
    rows.push({ supplier: parts[0]!, price: parts[1]!, delivery: parts[2]! });
  }
  return rows;
}

/** Apply accepted rules to a real Work artifact's text. */
export function applyProjectRulesToWorkResult(
  content: string,
  rules: readonly RuleLike[]
): WorkRuleReport {
  const active = rules.filter((rule) => rule.enabled);
  const statuses: RuleStatus[] = [];
  const deliveryRules = active.filter((rule) => SEPARATE_DELIVERY.test(rule.instructions));
  const styleRules = active.filter((rule) => STYLE_RULE.test(rule.instructions));
  const conflicts: WorkRuleReport["conflicts"] = [];
  if (deliveryRules.length > 1)
    conflicts.push({
      ids: deliveryRules.map((rule) => rule.id),
      reason: "Несколько активных правил требуют разных правил оформления доставки."
    });
  const rows = parseSupplierRows(content);
  const styleMatch = content.match(STYLE_MARKER);
  const baseline = rows.length ? applyProjectRules(rows, []).lines.join("\n") : content;
  const separate = deliveryRules.length === 1;
  const withDelivery: AppliedReport = separate
    ? applyProjectRules(rows, [deliveryRules[0]!])
    : { lines: baseline.split("\n"), applied_rule_versions: [], ignored_rules: [] };
  let lines = withDelivery.lines;
  if (styleRules.length === 1) {
    lines = [`Стиль: ${styleRules[0]!.name}`, ...lines];
    statuses.push({
      id: styleRules[0]!.id,
      version: styleRules[0]!.version,
      status: "applied",
      effect: "style_header",
      reason: "Стиль оформления добавлен заголовком."
    });
  }
  for (const rule of active) {
    if (statuses.some((status) => status.id === rule.id)) continue;
    const isDelivery = SEPARATE_DELIVERY.test(rule.instructions);
    const isStyle = STYLE_RULE.test(rule.instructions);
    const status: RuleStatus =
      isDelivery || isStyle
        ? {
            id: rule.id,
            version: rule.version,
            status: isDelivery && !rows.length ? "ignored_not_applicable" : "conflict",
            reason:
              isDelivery && !rows.length
                ? "Нет строк сравнения поставщиков."
                : "Конфликт активных правил; правило не применено."
          }
        : {
            id: rule.id,
            version: rule.version,
            status: "ignored_unknown",
            reason: "Текст правила не соответствует известным действиям."
          };
    statuses.push(status);
  }
  const applied_rule_versions = [
    ...withDelivery.applied_rule_versions,
    ...statuses
      .filter((status) => status.status === "applied" && status.effect === "style_header")
      .map((status) => ({
        id: status.id,
        version: status.version,
        effect: "style_header"
      }))
  ];
  return {
    content: lines.join("\n") + "\n",
    rule_statuses: statuses,
    applied_rule_versions,
    conflicts,
    ignored_rules: statuses
      .filter((status) => status.status.startsWith("ignored") || status.status === "conflict")
      .map((status) => status.id)
  };
}
