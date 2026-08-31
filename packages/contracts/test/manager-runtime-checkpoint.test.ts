import { describe, expect, it } from "vitest";
import {
  validateRuntimeCheckpointAgainstGraph,
  type RuntimeCheckpoint,
  type RuntimeTaskGraph,
  type RuntimeTaskNode
} from "../src/index.js";

const createdAt = "2026-08-31T18:20:00.000Z";
const checkpointAt = "2026-08-31T18:30:00.000Z";

const task = (taskId: string): RuntimeTaskNode => ({
  task_id: taskId,
  project_id: "project-1",
  assigned_role: "manager",
  status: "pending",
  depends_on: [],
  input_artifact_ids: [],
  expected_output_kinds: ["plan"],
  memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
  max_iterations: 3,
  timeout_ms: 30_000,
  created_at: createdAt
});

const graph = (): RuntimeTaskGraph => ({
  contract_version: 1,
  graph_id: "graph-1",
  project_id: "project-1",
  root_task_id: "root",
  nodes: [task("root"), task("analysis")],
  created_at: createdAt
});

const checkpoint = (): RuntimeCheckpoint => ({
  contract_version: 1,
  checkpoint_id: "checkpoint-1",
  project_id: "project-1",
  graph_id: "graph-1",
  task_states: [
    { task_id: "root", status: "completed" },
    { task_id: "analysis", status: "pending" }
  ],
  artifact_ids: ["plan-1"],
  open_conflict_ids: [],
  restores_permissions: false,
  restores_sessions: false,
  restores_autonomy_escalation: false,
  created_at: checkpointAt
});

describe("manager runtime checkpoint semantics", () => {
  it("accepts a complete project-bound checkpoint for its graph", () => {
    expect(validateRuntimeCheckpointAgainstGraph({ checkpoint: checkpoint(), graph: graph() })).toEqual(
      []
    );
  });

  it("rejects cross-project or wrong-graph checkpoints", () => {
    const value = checkpoint();
    value.project_id = "project-2";
    value.graph_id = "graph-2";

    expect(validateRuntimeCheckpointAgainstGraph({ checkpoint: value, graph: graph() })).toEqual(
      expect.arrayContaining([
        "Runtime checkpoint belongs to another project",
        "Runtime checkpoint belongs to another task graph"
      ])
    );
  });

  it("requires every graph task exactly once", () => {
    const value = checkpoint();
    value.task_states = [
      { task_id: "root", status: "completed" },
      { task_id: "root", status: "completed" },
      { task_id: "foreign-task", status: "pending" }
    ];

    expect(validateRuntimeCheckpointAgainstGraph({ checkpoint: value, graph: graph() })).toEqual(
      expect.arrayContaining([
        "Runtime checkpoint duplicates task state root",
        "Runtime checkpoint contains unknown task foreign-task",
        "Runtime checkpoint is missing task state analysis"
      ])
    );
  });

  it("rejects checkpoints created before their graph", () => {
    const value = checkpoint();
    value.created_at = "2026-08-31T18:19:59.000Z";

    expect(validateRuntimeCheckpointAgainstGraph({ checkpoint: value, graph: graph() })).toContain(
      "Runtime checkpoint cannot predate its task graph"
    );
  });
});
