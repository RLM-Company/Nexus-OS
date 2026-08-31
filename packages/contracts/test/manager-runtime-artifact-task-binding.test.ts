import { describe, expect, it } from "vitest";
import {
  validateRuntimeArtifactTaskBinding,
  type RuntimeArtifact,
  type RuntimeTaskGraph,
  type RuntimeTaskNode
} from "../src/index.js";

const graphCreatedAt = "2026-08-31T21:20:00.000Z";
const taskCreatedAt = "2026-08-31T21:20:00.001Z";
const artifactCreatedAt = "2026-08-31T21:20:00.002Z";

const task = (overrides: Partial<RuntimeTaskNode> = {}): RuntimeTaskNode => ({
  task_id: "research-task",
  project_id: "project-1",
  assigned_role: "researcher",
  status: "completed",
  depends_on: [],
  input_artifact_ids: ["brief-1"],
  expected_output_kinds: ["evidence"],
  memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
  max_iterations: 3,
  timeout_ms: 30_000,
  created_at: taskCreatedAt,
  ...overrides
});

const graph = (nodes: RuntimeTaskNode[] = [task()]): RuntimeTaskGraph => ({
  contract_version: 1,
  graph_id: "graph-1",
  project_id: "project-1",
  root_task_id: nodes[0]?.task_id ?? "missing-root",
  nodes,
  created_at: graphCreatedAt
});

const artifact = (overrides: Partial<RuntimeArtifact> = {}): RuntimeArtifact => ({
  artifact_id: "evidence-1",
  project_id: "project-1",
  task_id: "research-task",
  producer_role: "researcher",
  producer_instance_id: "researcher-instance-1",
  kind: "evidence",
  data_class: "D1_PROJECT",
  source_trust: "project",
  instruction_treatment: "data_only",
  payload_ref: "payload-1",
  source_artifact_ids: ["brief-1"],
  source_ids: [],
  created_at: artifactCreatedAt,
  ...overrides
});

describe("manager runtime artifact task binding", () => {
  it("accepts a project-bound artifact emitted by its assigned task role", () => {
    expect(validateRuntimeArtifactTaskBinding({ artifact: artifact(), graph: graph() })).toEqual(
      []
    );
  });

  it("rejects artifacts attributed to an unknown task", () => {
    const value = artifact({ task_id: "missing-task" });

    expect(validateRuntimeArtifactTaskBinding({ artifact: value, graph: graph() })).toContain(
      "Artifact evidence-1 references unknown task missing-task"
    );
  });

  it("rejects cross-project, wrong-role and unexpected task outputs", () => {
    const value = artifact({
      project_id: "project-2",
      producer_role: "analyst",
      kind: "plan"
    });
    const issues = validateRuntimeArtifactTaskBinding({ artifact: value, graph: graph() });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Artifact evidence-1 belongs to another task graph project",
        "Artifact evidence-1 task belongs to another project",
        "Artifact evidence-1 producer role does not match task research-task",
        "Artifact evidence-1 kind is not declared by task research-task",
        "Role analyst cannot emit artifact kind plan"
      ])
    );
  });

  it("rejects provenance that was not declared as a task input", () => {
    const value = artifact({ source_artifact_ids: ["hidden-source"] });

    expect(validateRuntimeArtifactTaskBinding({ artifact: value, graph: graph() })).toContain(
      "Artifact evidence-1 cites undeclared task input hidden-source"
    );
  });

  it("orders graph and task chronology by parsed instant", () => {
    const targetGraph = graph([
      task({
        created_at: "2026-08-31T21:20:00.001Z"
      })
    ]);
    targetGraph.created_at = "2026-08-31T21:20:00.001Z";
    const value = artifact({ created_at: "2026-08-31T21:20:00Z" });
    const issues = validateRuntimeArtifactTaskBinding({ artifact: value, graph: targetGraph });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Artifact evidence-1 cannot predate its task graph",
        "Artifact evidence-1 cannot predate task research-task"
      ])
    );
  });

  it("fails closed when the supplied task graph is invalid", () => {
    const duplicated = task();
    const issues = validateRuntimeArtifactTaskBinding({
      artifact: artifact(),
      graph: graph([task(), duplicated])
    });

    expect(issues).toContain("Duplicate task_id: research-task");
  });
});
