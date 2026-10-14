import { createHash } from "node:crypto";
import { OwnerSkillError, type SkillDraft } from "@cosmora/db";

export type OwnerSkillPackage = SkillDraft & {
  format: "kosmora.skill.v1";
  execution: "disabled";
  permissions: [];
  sha256: string;
};

const digest = (draft: SkillDraft) =>
  createHash("sha256")
    .update(JSON.stringify([draft.name, draft.summary, draft.instructions]))
    .digest("hex");

/** The hash detects accidental changes; it is not an author signature. */
export function exportOwnerSkillPackage(draft: SkillDraft): OwnerSkillPackage {
  return {
    format: "kosmora.skill.v1",
    name: draft.name,
    summary: draft.summary,
    instructions: draft.instructions,
    execution: "disabled",
    permissions: [],
    sha256: digest(draft)
  };
}

export function verifyOwnerSkillPackage(value: OwnerSkillPackage): SkillDraft {
  if (
    value.format !== "kosmora.skill.v1" ||
    value.execution !== "disabled" ||
    !Array.isArray(value.permissions) ||
    value.permissions.length !== 0 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256) ||
    value.sha256 !== digest(value)
  )
    throw new OwnerSkillError("INVALID_SKILL");
  return { name: value.name, summary: value.summary, instructions: value.instructions };
}
