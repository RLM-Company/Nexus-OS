import { describe, expect, it } from "vitest";
import {
  validateRuntimeContextMaterialization,
  type RuntimeArtifact,
  type RuntimeContextEnvelope,
  type RuntimeTaskNode
} from "../src/index.js";

const createdAt = "2026-08-31T18:00:00.000Z";

const task = (): RuntimeTaskNode => ({
  task_id: "analysis-task",
  project_id: "project-1",
  assigned_role: "analyst",
  status: "ready",
  depends_on: ["research-task"],
  input_artifact_ids: ["artifact-1"],
  expected_output_kinds: ["analysis"],
  memory_scope: {
    read_mode: "project_segments",
    source_ids: ["memory-1", "memory-2"],
    write_back: "result_only"
  },
  max_iterations: 3,
  timeout_ms: 30_000,
  created_at: createdAt
});

const context = (): RuntimeContextEnvelope => ({
  contract_version: 1,
  project_id: "project-1",
  task_id: "analysis-task",
  role: "analyst",
  memory_scope: {
    read_mode: "project_segments",
    source_ids: ["memory-1"],
    write_back: "result_only"
  },
  artifact_ids: ["artifact-1"],
  source_ids: ["source-1"],
  allowed_data_classes: ["D1_PROJECT", "D2_CONFIDENTIAL"],
  max_input_tokens: 20_000,
  max_artifacts: 10,
  max_memory_segments: 10,
  global_memory_scope_ids: [],
  cross_project_scope_ids: [],
  untrusted_instruction_treatment: "data_only",
  private_chat_persistence: "forbidden"
});

const artifact = (artifactId = "artifact-1"): RuntimeArtifact => ({
  artifact_id: artifactId,
  project_id: "project-1",
  task_id: "research-task",
  producer_role: "researcher",
  producer_instance_id: "researcher-1",
  kind: "evidence",
  data_class: "D1_PROJECT",
  source_trust: "project",
  instruction_treatment: "data_only",
  payload_ref: `payload-${artifactId}`,
  source_artifact_ids: [],
  source_ids: ["source-1"],
  created_at: createdAt
});

describe("runtime context materialization validation", () => {
  it("accepts a narrowed task-bound context with exactly declared artifacts", () => {
    expect(
      validateRuntimeContextMaterialization({
        context: context(),
        task: task(),
        artifacts: [artifact()]
      })
    ).toEqual([]);
  });

  it("rejects task, role and memory-scope widening", () => {
    const widened = context();
    widened.task_id = "other-task";
    widened.role = "researcher";
    widened.memory_scope = {
      read_mode: "handoff",
      source_ids: ["memory-3"],
      write_back: "result_and_evidence"
    };

    const issues = validateRuntimeContextMaterialization({
      context: widened,
      task: task(),
      artifacts: [artifact()]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Context task_id does not match the materialized task",
        "Context role does not match the task assigned role",
        "Context memory read mode differs from the task contract",
        "Context memory write-back mode differs from the task contract",
        "Context memory source is not declared by the task: memory-3"
      ])
    );
  });

  it("rejects cross-project, disallowed-class, undeclared-source and self provenance", () => {
    const unsafeArtifact = artifact();
    unsafeArtifact.project_id = "project-2";
    unsafeArtifact.data_class = "D3_RESTRICTED";
    unsafeArtifact.source_ids = ["source-2"];
    unsafeArtifact.source_artifact_ids = [unsafeArtifact.artifact_id];

    const issues = validateRuntimeContextMaterialization({
      context: context(),
      task: task(),
      artifacts: [unsafeArtifact]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Artifact artifact-1 crosses the context project boundary",
        "Artifact artifact-1 uses a data class not allowed by the context",
        "Artifact artifact-1 references itself as provenance",
        "Artifact artifact-1 uses an undeclared context source: source-2"
      ])
    );
  });

  it("requires an exact set of declared materialized artifact identities", () => {
    const declared = context();
    declared.artifact_ids = ["artifact-1", "artifact-2"];

    const issues = validateRuntimeContextMaterialization({
      context: declared,
      task: task(),
      artifacts: [artifact("artifact-1"), artifact("artifact-1"), artifact("artifact-3")]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        "Duplicate materialized artifact: artifact-1",
        "Materialized artifact is not declared by the context: artifact-3",
        "Declared context artifact was not materialized: artifact-2"
      ])
    );
  });

  it("preserves the D4 no-persistence invariant during materialization", () => {
    const privateContext = context();
    privateContext.allowed_data_classes = ["D4_PRIVATE_CHAT"];

    const privateArtifact = artifact();
    privateArtifact.data_class = "D4_PRIVATE_CHAT";

    expect(
      validateRuntimeContextMaterialization({
        context: privateContext,
        task: task(),
        artifacts: [privateArtifact]
      })
    ).toContain("D4 private chat context cannot write back to persistent memory");
  });
});
