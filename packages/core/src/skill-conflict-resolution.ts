import { CHAT_SKILL_PRECEDENCE, type ChatSkillSnapshot } from "@cosmora/contracts";

export type ResolvedSkill = {
  rule: ChatSkillSnapshot;
  scope: NonNullable<ChatSkillSnapshot["scope"]>;
  /** Rules with the same skill_id that lost to a higher-precedence scope. */
  suppressed: ChatSkillSnapshot[];
};

/**
 * Deterministic conflict resolution for explicitly selected Skills.
 *
 * A conflict is the SAME skill_id selected at more than one scope — never two
 * different rules that merely sound alike. The higher-precedence scope wins;
 * losers are reported, not silently dropped, so the UI can show them. Rules
 * without a scope (older run snapshots) are treated as the lowest "owner" tier.
 */
export const resolveSkillConflicts = (skills: readonly ChatSkillSnapshot[]): ResolvedSkill[] => {
  const sorted = [...skills].sort(
    (a, b) =>
      CHAT_SKILL_PRECEDENCE.indexOf(a.scope ?? "owner") -
      CHAT_SKILL_PRECEDENCE.indexOf(b.scope ?? "owner")
  );
  const winners = new Map<string, ResolvedSkill>();
  for (const rule of sorted) {
    const scope = rule.scope ?? "owner";
    const existing = winners.get(rule.skill_id);
    if (!existing) {
      winners.set(rule.skill_id, { rule, scope, suppressed: [] });
      continue;
    }
    // Same skill_id at a lower/equal precedence: keep the first (higher) winner.
    existing.suppressed.push(rule);
  }
  return [...winners.values()];
};
