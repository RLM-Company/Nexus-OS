import { describe, expect, it } from "vitest";
import type {
  ManagerExecutionRequest,
  RuntimeTaskGraph,
  RuntimeTaskNode
} from "@cosmora/contracts";
import { preflightManagerExecution } from "../src/index.js";

const timestamp = "2026-09-22T12:00:00.000Z";

const task = (
  taskId: string,
  role: RuntimeTaskNode["assigned_role"],
  dependsOn: string[] = [],
  status: RuntimeTaskNode["status"] = "pending"
): RuntimeTaskNode => ({
  task_id: taskId,
  project_id: "project-1",
  assigned_role: role,
  status,
  depends_on: dependsOn,
  input_artifact_ids: [],
  expected_output_kinds: [role === "analyst" ? "analysis" : "plan"],
  memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
  max_iterations: 1,
  timeout_ms: 30_000,
  created_at: timestamp
});

const graph = (
  rootStatus: RuntimeTaskNode["status"] = "pending",
  analysisStatus: RuntimeTaskNode["status"] = "pending"
): RuntimeTaskGraph => ({
  contract_version: 1,
  graph_id: "graph-1",
  project_id: "project-1",
  root_task_id: "root",
  nodes: [
    task("root", "manager", [], rootStatus),
    task("analysis", "analyst", ["root"], analysisStatus)
  ],
  created_at: timestamp
});

const request = (overrides: Partial<ManagerExecutionRequest> = {}): ManagerExecutionRequest => ({
  contract_version: 1,
  execution_id: "execution-1",
  project_id: "project-1",
  owner_task_ref: "owner-task-1",
  allowed_roles: ["manager", "analyst"],
  max_tasks: 2,
  max_parallel_tasks: 2,
  max_model_requests: 2,
  max_input_tokens: 50_000,
  max_output_tokens: 10_000,
  created_at: timestamp,
  ...overrides
});

describe("Manager execution preflight", () => {
  it("accepts a bounded graph and exposes only dependency-ready tasks", () => {
    const result = preflightManagerExecution({
      request: request(),
      graph: graph(),
      evaluatedAt: timestamp
    });

    expect(result).toEqual({
      executionId: "execution-1",
      projectId: "project-1",
      accepted: true,
      issues: [],
      readyTaskIds: ["root"],
      waitingTaskIds: ["analysis"],
      runningTaskIds: [],
      blockedTaskIds: [],
      terminalTaskIds: [],
      evaluatedAt: timestamp
    });
  });

  it("makes a dependent task ready after its prerequisite completes", () => {
    const result = preflightManagerExecution({
      request: request(),
      graph: graph("completed"),
      evaluatedAt: timestamp
    });

    expect(result.accepted).toBe(true);
    expect(result.readyTaskIds).toEqual(["analysis"]);
    expect(result.waitingTaskIds).toEqual([]);
    expect(result.terminalTaskIds).toEqual(["root"]);
  });

  it("fails closed when owner-approved role or execution budgets do not cover the graph", () => {
    const result = preflightManagerExecution({
      request: request({
        allowed_roles: ["manager"],
        max_tasks: 1,
        max_parallel_tasks: 1,
        max_model_requests: 1
      }),
      graph: graph(),
      evaluatedAt: timestamp
    });

    expect(result.accepted).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "Task graph exceeds the execution request max_tasks budget",
        "Task analysis uses role outside the execution request allowlist",
        "Task graph can exceed the total model request budget"
      ])
    );
  });

  it("fails closed on an invalid graph before any task can be treated as executable", () => {
    const invalidGraph = graph();
    invalidGraph.nodes[1] = {
      ...invalidGraph.nodes[1]!,
      depends_on: ["missing-task"]
    };

    const result = preflightManagerExecution({
      request: request(),
      graph: invalidGraph,
      evaluatedAt: timestamp
    });

    expect(result.accepted).toBe(false);
    expect(result.issues).toContain("Task analysis depends on missing task missing-task");
    expect(result.readyTaskIds).toEqual([]);
    expect(result.blockedTaskIds).toEqual(["analysis", "root"]);
  });

  it("classifies already-running, blocked and terminal tasks without executing them", () => {
    const targetGraph: RuntimeTaskGraph = {
      ...graph(),
      nodes: [
        task("root", "manager", [], "running"),
        task("analysis", "analyst", ["root"], "blocked"),
        task("done", "manager", [], "completed")
      ]
    };
    const targetRequest = request({
      max_tasks: 3,
      max_parallel_tasks: 3,
      max_model_requests: 3
    });

    const result = preflightManagerExecution({
      request: targetRequest,
      graph: targetGraph,
      evaluatedAt: timestamp
    });

    expect(result.accepted).toBe(true);
    expect(result.runningTaskIds).toEqual(["root"]);
    expect(result.blockedTaskIds).toEqual(["analysis"]);
    expect(result.terminalTaskIds).toEqual(["done"]);
    expect(result.readyTaskIds).toEqual([]);
  });
});
