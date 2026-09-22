import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ManagerExecutionRequestSchema,
  ManagerExecutionSnapshotSchema,
  validateManagerExecutionRequest,
  validateManagerExecutionSnapshot,
  type ManagerExecutionRequest,
  type ManagerExecutionSnapshot,
  type RuntimeArtifact,
  type RuntimeTaskGraph,
  type RuntimeTaskNode
} from "../src/index.js";

const timestamp = "2026-09-22T12:00:00.000Z";

const task = (
  taskId: string,
  assignedRole: RuntimeTaskNode["assigned_role"],
  expectedKind: RuntimeTaskNode["expected_output_kinds"][number],
  dependsOn: string[] = [],
  inputArtifactIds: string[] = []
): RuntimeTaskNode => ({
  task_id: taskId,
  project_id: "project-1",
  assigned_role: assignedRole,
  status: "completed",
  depends_on: dependsOn,
  input_artifact_ids: inputArtifactIds,
  expected_output_kinds: [expectedKind],
  memory_scope: { read_mode: "task", source_ids: [], write_back: "none" },
  max_iterations: 1,
  timeout_ms: 30_000,
  created_at: timestamp
});

const graph: RuntimeTaskGraph = {
  contract_version: 1,
  graph_id: "graph-1",
  project_id: "project-1",
  root_task_id: "plan-task",
  nodes: [
    task("plan-task", "manager", "plan"),
    task("research-task", "researcher", "evidence", ["plan-task"], ["plan-artifact"]),
    task("analysis-task", "analyst", "analysis", ["research-task"], ["evidence-artifact"]),
    task("critic-task", "critic", "critic_verdict", ["analysis-task"], ["analysis-artifact"]),
    task("result-task", "manager", "decision", ["critic-task"], ["critic-artifact"])
  ],
  created_at: timestamp
};

const artifact = (
  artifactId: string,
  taskId: string,
  role: RuntimeArtifact["producer_role"],
  kind: RuntimeArtifact["kind"],
  sourceArtifactIds: string[] = []
): RuntimeArtifact => ({
  artifact_id: artifactId,
  project_id: "project-1",
  task_id: taskId,
  producer_role: role,
  producer_instance_id: `${role}-instance-1`,
  kind,
  data_class: "D1_PROJECT",
  source_trust: "project",
  instruction_treatment: "data_only",
  payload_ref: `${artifactId}-payload`,
  source_artifact_ids: sourceArtifactIds,
  source_ids: [],
  created_at: timestamp
});

const artifacts: RuntimeArtifact[] = [
  artifact("plan-artifact", "plan-task", "manager", "plan"),
  artifact("evidence-artifact", "research-task", "researcher", "evidence", ["plan-artifact"]),
  artifact("analysis-artifact", "analysis-task", "analyst", "analysis", ["evidence-artifact"]),
  artifact("critic-artifact", "critic-task", "critic", "critic_verdict", ["analysis-artifact"]),
  artifact("result-artifact", "result-task", "manager", "decision", ["critic-artifact"])
];

const request: ManagerExecutionRequest = {
  contract_version: 1,
  execution_id: "execution-1",
  project_id: "project-1",
  owner_task_ref: "owner-task-1",
  allowed_roles: ["manager", "researcher", "analyst", "critic"],
  max_tasks: 10,
  max_parallel_tasks: 2,
  max_model_requests: 5,
  max_input_tokens: 50_000,
  max_output_tokens: 10_000,
  created_at: timestamp
};

const completedSnapshot = (): ManagerExecutionSnapshot => ({
  contract_version: 1,
  execution_id: "execution-1",
  project_id: "project-1",
  graph_id: "graph-1",
  phase: "completed",
  task_states: graph.nodes.map((node) => ({
    task_id: node.task_id,
    status: "completed"
  })),
  artifact_ids: artifacts.map((candidate) => candidate.artifact_id),
  verifications: [
    {
      verification_id: "verification-result",
      project_id: "project-1",
      task_id: "result-task",
      artifact_id: "result-artifact",
      verifier: "contract_gate",
      status: "PASS",
      check_ids: ["result-shape", "provenance-complete"],
      critic_verdict_id: null,
      created_at: timestamp
    }
  ],
  checkpoint_id: "checkpoint-final",
  result: {
    status: "completed",
    summary_artifact_id: "result-artifact",
    deliverable_artifact_ids: ["result-artifact"],
    verified_artifact_ids: ["result-artifact"],
    unresolved_task_ids: [],
    created_at: timestamp
  },
  updated_at: timestamp
});

const firstVerification = (snapshot: ManagerExecutionSnapshot) => {
  const verification = snapshot.verifications[0];
  if (verification === undefined) throw new Error("Fixture requires one verification");
  return verification;
};

describe("Manager execution contracts", () => {
  it("accepts a bounded request and complete task-to-result mock trace", () => {
    const snapshot = completedSnapshot();

    expect(Value.Check(ManagerExecutionRequestSchema, request)).toBe(true);
    expect(Value.Check(ManagerExecutionSnapshotSchema, snapshot)).toBe(true);
    expect(validateManagerExecutionRequest({ request, graph })).toEqual([]);
    expect(validateManagerExecutionSnapshot({ snapshot, graph, artifacts })).toEqual([]);
  });

  it("rejects roles and graph size outside the owner-approved request", () => {
    expect(
      validateManagerExecutionRequest({
        request: { ...request, allowed_roles: ["manager"], max_tasks: 2 },
        graph
      })
    ).toEqual(
      expect.arrayContaining([
        "Task graph exceeds the execution request max_tasks budget",
        "Task research-task uses role outside the execution request allowlist",
        "Task analysis-task uses role outside the execution request allowlist",
        "Task critic-task uses role outside the execution request allowlist"
      ])
    );
  });

  it("cannot complete with unfinished tasks or an unverified deliverable", () => {
    const snapshot = completedSnapshot();
    snapshot.task_states = snapshot.task_states.map((state) =>
      state.task_id === "critic-task" ? { ...state, status: "blocked" } : state
    );
    snapshot.verifications = snapshot.verifications.map((verification) => ({
      ...verification,
      status: "FAIL"
    }));

    expect(validateManagerExecutionSnapshot({ snapshot, graph, artifacts })).toEqual(
      expect.arrayContaining([
        "Completed execution requires every task to be completed",
        "Completed execution contains unverified deliverable result-artifact"
      ])
    );
  });

  it("requires terminal results and forbids premature final results", () => {
    const withoutResult = { ...completedSnapshot(), result: null };
    expect(
      validateManagerExecutionSnapshot({
        snapshot: withoutResult,
        graph,
        artifacts
      })
    ).toContain("Terminal execution snapshot requires a result");

    const premature = { ...completedSnapshot(), phase: "executing" as const };
    expect(
      validateManagerExecutionSnapshot({
        snapshot: premature,
        graph,
        artifacts
      })
    ).toContain("Non-terminal execution snapshot cannot contain a final result");
  });

  it("fails closed on cross-project verification and invented artifacts", () => {
    const snapshot = completedSnapshot();
    snapshot.artifact_ids = [...snapshot.artifact_ids, "invented-artifact"];
    snapshot.verifications = snapshot.verifications.map((verification) => ({
      ...verification,
      project_id: "project-2",
      artifact_id: "invented-artifact"
    }));

    expect(validateManagerExecutionSnapshot({ snapshot, graph, artifacts })).toEqual(
      expect.arrayContaining([
        "Execution snapshot references unknown artifact invented-artifact",
        "Verification verification-result belongs to another project",
        "Verification verification-result references unknown artifact",
        "Completed execution contains unverified deliverable result-artifact"
      ])
    );
  });

  it("requires critic evidence only for critic verification", () => {
    const criticWithoutVerdict = completedSnapshot();
    const verification = firstVerification(criticWithoutVerdict);
    criticWithoutVerdict.verifications = [
      {
        ...verification,
        verifier: "critic",
        critic_verdict_id: null
      }
    ];
    expect(
      validateManagerExecutionSnapshot({
        snapshot: criticWithoutVerdict,
        graph,
        artifacts
      })
    ).toContain("Critic verification verification-result requires a verdict");

    const gateWithVerdict = completedSnapshot();
    firstVerification(gateWithVerdict).critic_verdict_id = "critic-artifact";
    expect(
      validateManagerExecutionSnapshot({
        snapshot: gateWithVerdict,
        graph,
        artifacts
      })
    ).toContain("Contract verification verification-result cannot claim a verdict");
  });
});
