import { describe, expect, it } from "vitest";
import {
  roleCanArbitrateAgentConflict,
  validateAgentConflictLifecycle,
  type AgentConflict
} from "../src/index.js";

const baseConflict = (status: AgentConflict["status"]): AgentConflict => ({
  conflict_id: "conflict-1",
  project_id: "project-1",
  task_id: "decision-task",
  positions: [
    { role: "architect", artifact_id: "architecture-1", claim: "Use design A." },
    { role: "analyst", artifact_id: "analysis-1", claim: "Use design B." }
  ],
  status,
  resolution_artifact_id: null,
  unresolved_uncertainty: ["Traffic assumptions remain uncertain."],
  created_at: "2026-08-31T18:00:00.000Z",
  resolved_at: null
});

describe("manager runtime conflict semantics", () => {
  it("accepts a genuinely open conflict with distinct evidence", () => {
    expect(validateAgentConflictLifecycle(baseConflict("open"))).toEqual([]);
  });

  it("requires distinct position artifacts", () => {
    const conflict = baseConflict("open");
    conflict.positions[1] = {
      role: "analyst",
      artifact_id: "architecture-1",
      claim: "A duplicated artifact is not independent conflict evidence."
    };

    expect(validateAgentConflictLifecycle(conflict)).toContain(
      "Agent conflict requires at least two distinct position artifacts"
    );
  });

  it("requires an artifact and timestamp before marking a conflict resolved", () => {
    expect(validateAgentConflictLifecycle(baseConflict("resolved"))).toEqual(
      expect.arrayContaining([
        "Resolved agent conflict requires a resolution artifact",
        "Resolved agent conflict requires resolved_at"
      ])
    );

    const resolved: AgentConflict = {
      ...baseConflict("resolved"),
      resolution_artifact_id: "manager-decision-1",
      resolved_at: "2026-08-31T18:10:00.000Z"
    };
    expect(validateAgentConflictLifecycle(resolved)).toEqual([]);
  });

  it("does not let open or escalated conflicts carry a fake resolution", () => {
    for (const status of ["open", "escalated"] as const) {
      const conflict: AgentConflict = {
        ...baseConflict(status),
        resolution_artifact_id: "decision-1",
        resolved_at: "2026-08-31T18:10:00.000Z"
      };
      expect(validateAgentConflictLifecycle(conflict)).toEqual(
        expect.arrayContaining([
          "Open or escalated agent conflict cannot carry a resolution artifact",
          "Open or escalated agent conflict cannot carry resolved_at"
        ])
      );
    }
  });

  it("rejects impossible resolution chronology", () => {
    const conflict: AgentConflict = {
      ...baseConflict("resolved"),
      resolution_artifact_id: "decision-1",
      resolved_at: "2026-08-31T17:59:59.000Z"
    };
    expect(validateAgentConflictLifecycle(conflict)).toContain(
      "Agent conflict cannot resolve before it was created"
    );
  });

  it("orders optional milliseconds by instant instead of raw text", () => {
    const conflict: AgentConflict = {
      ...baseConflict("resolved"),
      resolution_artifact_id: "decision-1",
      created_at: "2026-08-31T18:00:00.001Z",
      resolved_at: "2026-08-31T18:00:00Z"
    };
    expect(validateAgentConflictLifecycle(conflict)).toContain(
      "Agent conflict cannot resolve before it was created"
    );
  });

  it("keeps arbitration authority exclusive to the declared role contract", () => {
    expect(roleCanArbitrateAgentConflict("manager")).toBe(true);
    for (const role of ["architect", "researcher", "analyst", "critic"] as const) {
      expect(roleCanArbitrateAgentConflict(role)).toBe(false);
    }
  });
});
