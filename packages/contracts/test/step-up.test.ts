import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { StepUpProofSchema, StepUpPurposeSchema } from "../src/index.js";

describe("step-up proof contracts", () => {
  it("keeps proof records provider-neutral and secret-free", () => {
    const proof = {
      proof_id: "proof-1",
      owner_id: "owner-1",
      actor_id: "owner-actor-1",
      session_id: "session-1",
      purpose: "critical_tool_confirmation",
      challenge_hash: "a".repeat(64),
      status: "active",
      issued_at: "2026-08-27T12:00:00.000Z",
      expires_at: "2026-08-27T12:02:00.000Z",
      consumed_at: null
    };

    expect(Value.Check(StepUpProofSchema, proof)).toBe(true);
    expect(Value.Check(StepUpProofSchema, { ...proof, token: "secret" })).toBe(false);
  });

  it("allows only registered security purposes", () => {
    expect(Value.Check(StepUpPurposeSchema, "autonomy_profile_escalation")).toBe(true);
    expect(Value.Check(StepUpPurposeSchema, "arbitrary_action")).toBe(false);
  });
});
