import { describe, expect, it } from "vitest";
import { validateRuntimeArtifactProvenance, type RuntimeArtifact } from "../src/index.js";

const artifact = (input: {
  id: string;
  createdAt: string;
  sources?: string[];
  projectId?: string;
}): RuntimeArtifact => ({
  artifact_id: input.id,
  project_id: input.projectId ?? "project-1",
  task_id: `task-${input.id}`,
  producer_role: "analyst",
  producer_instance_id: `instance-${input.id}`,
  kind: "analysis",
  data_class: "D1_PROJECT",
  source_trust: "project",
  instruction_treatment: "data_only",
  payload_ref: `payload-${input.id}`,
  source_artifact_ids: input.sources ?? [],
  source_ids: [],
  created_at: input.createdAt
});

const t0 = "2026-08-31T20:00:00.000Z";
const t1 = "2026-08-31T20:01:00.000Z";
const t2 = "2026-08-31T20:02:00.000Z";

describe("manager runtime artifact provenance", () => {
  it("accepts an acyclic same-project provenance graph ordered in time", () => {
    const issues = validateRuntimeArtifactProvenance({
      projectId: "project-1",
      artifacts: [
        artifact({ id: "evidence", createdAt: t0 }),
        artifact({ id: "analysis", createdAt: t1, sources: ["evidence"] }),
        artifact({ id: "decision", createdAt: t2, sources: ["analysis", "evidence"] })
      ]
    });

    expect(issues).toEqual([]);
  });

  it("rejects duplicate, unknown and self-referential provenance", () => {
    const issues = validateRuntimeArtifactProvenance({
      projectId: "project-1",
      artifacts: [
        artifact({ id: "a", createdAt: t1, sources: ["a", "missing"] }),
        artifact({ id: "a", createdAt: t1 })
      ]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Duplicate runtime artifact: a",
        "Artifact a references itself as provenance",
        "Artifact a references unknown source artifact missing"
      ])
    );
  });

  it("rejects cross-project provenance and project-boundary violations", () => {
    const issues = validateRuntimeArtifactProvenance({
      projectId: "project-1",
      artifacts: [
        artifact({ id: "foreign", createdAt: t0, projectId: "project-2" }),
        artifact({ id: "derived", createdAt: t1, sources: ["foreign"] })
      ]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Artifact foreign belongs to another project",
        "Artifact derived references cross-project provenance foreign"
      ])
    );
  });

  it("rejects provenance from artifacts created later", () => {
    const issues = validateRuntimeArtifactProvenance({
      projectId: "project-1",
      artifacts: [
        artifact({ id: "future", createdAt: t2 }),
        artifact({ id: "derived", createdAt: t1, sources: ["future"] })
      ]
    });

    expect(issues).toContain("Artifact derived references source artifact created later: future");
  });

  it("rejects provenance cycles", () => {
    const issues = validateRuntimeArtifactProvenance({
      projectId: "project-1",
      artifacts: [
        artifact({ id: "a", createdAt: t1, sources: ["b"] }),
        artifact({ id: "b", createdAt: t1, sources: ["a"] })
      ]
    });

    expect(issues.some((issue) => issue.includes("provenance contains a cycle"))).toBe(true);
  });
});
