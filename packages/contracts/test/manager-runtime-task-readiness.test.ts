import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { RuntimeTaskReadinessSnapshotSchema } from "../src/index.js";

describe("manager runtime task readiness contracts", () => {
  it("accepts bounded readiness snapshots without execution authority", () => {
    const value = {
      graph_id: "graph-1",
      project_id: "project-1",
      valid_graph: true,
      graph_issues: [],
      decisions: [
        {
          task_id: "root",
          current_status: "pending",
          derived_status: "ready",
          reason: "dependencies_satisfied",
          blocking_dependency_ids: []
        }
      ],
      evaluated_at: "2026-08-31T20:40:00.000Z"
    };

    expect(Value.Check(RuntimeTaskReadinessSnapshotSchema, value)).toBe(true);
    expect(
      Value.Check(RuntimeTaskReadinessSnapshotSchema, {
        ...value,
        execute_ready_tasks: true
      })
    ).toBe(false);
  });
});
