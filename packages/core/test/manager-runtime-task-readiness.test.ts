import { describe, expect, it } from "vitest";
import { type RuntimeTaskGraph, type RuntimeTaskNode } from "@cosmora/contracts";
import { deriveRuntimeTaskReadiness } from "../src/index.js";

const evaluatedAt = "2026-08-31T20:40:00.000Z";
const createdAt = "2026-08-31T20:30:00.000Z";

const task = (
  taskId: string,
  status: RuntimeTaskNode["status"],
  dependsOn: string[] = []
): RuntimeTaskNode => ({
  task_id: taskId,
  project_id: "project-1",
  assigned_role: "manager",
  status,
  depends_on: dependsOn,
  input_artifact_ids: [],
  expected_output_kinds: ["plan"],
  memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
  max_iterations: 3,
  timeout_ms: 30_000,
  created_at: createdAt
});

const graph = (nodes: RuntimeTaskNode[]): RuntimeTaskGraph => ({
  contract_version: 1,
  graph_id: "graph-1",
  project_id: "project-1",
  root_task_id: "root",
  nodes,
  created_at: createdAt
});

describe("manager runtime task readiness", () => {
  it("marks dependency-free pending tasks ready", () => {
    const result = deriveRuntimeTaskReadiness({
      graph: graph([task("root", "pending")]),
      evaluatedAt
    });

    expect(result.valid_graph).toBe(true);
    expect(result.decisions[0]).toMatchObject({
      task_id: "root",
      current_status: "pending",
      derived_status: "ready",
      reason: "dependencies_satisfied",
      blocking_dependency_ids: []
    });
  });

  it("keeps tasks pending while dependencies are unfinished", () => {
    const result = deriveRuntimeTaskReadiness({
      graph: graph([task("root", "running"), task("analysis", "pending", ["root"])]),
      evaluatedAt
    });

    expect(result.decisions.find((item) => item.task_id === "analysis")).toMatchObject({
      derived_status: "pending",
      reason: "waiting_for_dependencies",
      blocking_dependency_ids: ["root"]
    });
  });

  it("blocks dependants after failed or cancelled dependencies", () => {
    const result = deriveRuntimeTaskReadiness({
      graph: graph([
        task("root", "completed"),
        task("failed-dependency", "failed", ["root"]),
        task("cancelled-dependency", "cancelled", ["root"]),
        task("after-failure", "pending", ["failed-dependency"]),
        task("after-cancel", "ready", ["cancelled-dependency"])
      ]),
      evaluatedAt
    });

    expect(result.decisions.find((item) => item.task_id === "after-failure")).toMatchObject({
      derived_status: "blocked",
      reason: "dependency_failed",
      blocking_dependency_ids: ["failed-dependency"]
    });
    expect(result.decisions.find((item) => item.task_id === "after-cancel")).toMatchObject({
      derived_status: "blocked",
      reason: "dependency_cancelled",
      blocking_dependency_ids: ["cancelled-dependency"]
    });
  });

  it("never clears an explicit blocked state", () => {
    const result = deriveRuntimeTaskReadiness({
      graph: graph([task("root", "completed"), task("critic-blocked", "blocked", ["root"])]),
      evaluatedAt
    });

    expect(result.decisions.find((item) => item.task_id === "critic-blocked")).toMatchObject({
      current_status: "blocked",
      derived_status: "blocked",
      reason: "already_blocked"
    });
  });

  it("preserves running and terminal states", () => {
    const result = deriveRuntimeTaskReadiness({
      graph: graph([
        task("root", "running"),
        task("done", "completed", ["root"]),
        task("failed", "failed", ["root"]),
        task("cancelled", "cancelled", ["root"])
      ]),
      evaluatedAt
    });

    expect(result.decisions.find((item) => item.task_id === "root")).toMatchObject({
      derived_status: "running",
      reason: "already_running"
    });
    for (const taskId of ["done", "failed", "cancelled"]) {
      expect(result.decisions.find((item) => item.task_id === taskId)).toMatchObject({
        reason: "already_terminal"
      });
    }
  });

  it("fails closed on an invalid graph instead of scheduling partial work", () => {
    const invalid = graph([
      task("root", "pending", ["missing"]),
      task("child", "pending", ["root"])
    ]);
    const result = deriveRuntimeTaskReadiness({ graph: invalid, evaluatedAt });

    expect(result.valid_graph).toBe(false);
    expect(result.graph_issues.some((issue) => issue.includes("missing"))).toBe(true);
    expect(result.decisions.every((decision) => decision.derived_status === "blocked")).toBe(true);
    expect(result.decisions.every((decision) => decision.reason === "invalid_graph")).toBe(true);
  });
});
