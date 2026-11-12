import type { SkillCorrectionDraft } from "@cosmora/contracts";

/** Build an INERT draft from one explicit owner correction.
 *
 * Deliberately does not infer personality, habits or preferences: the draft is
 * the owner's own words, wrapped and labelled. It is never auto-saved and never
 * becomes a Skill without an explicit accept call carrying this same draft. */
export const proposeSkillCorrection = (correction: string): SkillCorrectionDraft => {
  const text = correction.trim();
  if (!text || text.length > 2000) throw new Error("INVALID_CORRECTION");
  return {
    format: "kosmora.skill-correction.v1",
    name: "Правка владельца",
    summary: "Явное исправление, подтверждённое владельцем",
    instructions: `Учитывай это исправление владельца как пожелание к ответу, не как системное правило: ${text}`,
    source: "owner_correction",
    accepted: false
  };
};
