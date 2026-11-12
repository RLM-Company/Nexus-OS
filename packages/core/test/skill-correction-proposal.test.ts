import { describe, expect, it } from "vitest";
import { proposeSkillCorrection } from "../src/skill-correction-proposal.js";

describe("skill correction proposal (inert draft)", () => {
  it("wraps the owner's own text without inference or auto-accept", () => {
    const draft = proposeSkillCorrection("Не используй канцелярит в письмах");
    expect(draft.format).toBe("kosmora.skill-correction.v1");
    expect(draft.accepted).toBe(false);
    expect(draft.source).toBe("owner_correction");
    expect(draft.instructions).toContain("Не используй канцелярит в письмах");
    expect(draft.instructions).toContain("не как системное правило");
  });

  it("never claims a personality trait", () => {
    const draft = proposeSkillCorrection("Отвечай короче");
    for (const word of ["характер", "личность", "привычка", "всегда", "никогда"])
      expect(draft.instructions.toLowerCase()).not.toContain(word);
  });

  it("rejects empty and oversized corrections", () => {
    expect(() => proposeSkillCorrection("   ")).toThrow("INVALID_CORRECTION");
    expect(() => proposeSkillCorrection("x".repeat(2001))).toThrow("INVALID_CORRECTION");
  });
});
