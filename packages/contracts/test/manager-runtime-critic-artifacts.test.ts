import { describe, expect, it } from "vitest";
import {
  validateCriticVerdictAgainstArtifacts,
  type CriticVerdict,
  type RuntimeArtifact,
  type RuntimeArtifactKind
} from "../src/index.js";

const reviewedAt = "2026-09-09T18:00:00.000Z";
const verdictAt = "2026-09-09T18:01:00.000Z";

const artifact = (input: {
  id: string;
  projectId?: string;
  createdAt?: string;
  kind?: RuntimeArtifactKind;
}): RuntimeArtifact => ({
  artifact_id: input.id,
  project_id: input.projectId ?? "project-1",
  task_id: `task-${input.id}`,
  producer_role: "analyst",
  producer_instance_id: `instance-${input.id}`,
  kind: input.kind ?? "analysis",
  data_class: "D1_PROJECT",
  source_trust: "project",
  instruction_treatment: "data_only",
  payload_ref: `payload-${input.id}`,
  source_artifact_ids: [],
  source_ids: [],
  created_at: input.createdAt ?? reviewedAt
});

const verdict = (): CriticVerdict => ({
  verdict_id: "verdict-1",
  project_id: "project-1",
  critic_instance_id: "critic-1",
  reviewed_artifact_ids: ["analysis-1"],
  severity: "SERIOUS",
  scope: ["task-analysis-1"],
  risk_statement: "A concrete risk was detected",
  evidence_ids: [],
  uncertainty: "Low",
  recommended_check: "Verify the disputed assumption",
  rollback: null,
  pause_scope: "task",
  created_at: verdictAt
});

describe("manager runtime critic reviewed artifacts", () => {
  it("accepts an existing supported same-project artifact created before the verdict", () => {
    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: verdict(),
        artifacts: [artifact({ id: "analysis-1" })]
      })
    ).toEqual([]);
  });

  it("rejects missing reviewed artifacts", () => {
    expect(validateCriticVerdictAgainstArtifacts({ verdict: verdict(), artifacts: [] })).toContain(
      "Critic verdict references unknown reviewed artifact analysis-1"
    );
  });

  it("rejects cross-project reviewed artifacts", () => {
    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: verdict(),
        artifacts: [artifact({ id: "analysis-1", projectId: "project-2" })]
      })
    ).toContain("Critic verdict references reviewed artifact from another project: analysis-1");
  });

  it("rejects reviewed artifact kinds the critic role contract does not accept", () => {
    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: verdict(),
        artifacts: [artifact({ id: "analysis-1", kind: "checkpoint" })]
      })
    ).toContain("Critic verdict reviews unsupported artifact kind checkpoint: analysis-1");
  });

  it("rejects reviewed artifacts created after the verdict even inside the same second", () => {
    const value = verdict();
    value.created_at = "2026-09-09T18:01:00Z";

    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: value,
        artifacts: [artifact({ id: "analysis-1", createdAt: "2026-09-09T18:01:00.001Z" })]
      })
    ).toContain("Critic verdict references reviewed artifact created later: analysis-1");
  });

  it("fails closed when the supplied artifact set contains duplicate identities", () => {
    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: verdict(),
        artifacts: [artifact({ id: "analysis-1" }), artifact({ id: "analysis-1" })]
      })
    ).toContain("Duplicate runtime artifact supplied to critic validation: analysis-1");
  });

  it("preserves the critic severity pause invariant", () => {
    const value = verdict();
    value.pause_scope = "none";

    expect(
      validateCriticVerdictAgainstArtifacts({
        verdict: value,
        artifacts: [artifact({ id: "analysis-1" })]
      })
    ).toContain("SERIOUS and CRITICAL critic verdicts must pause the affected area");
  });
});
