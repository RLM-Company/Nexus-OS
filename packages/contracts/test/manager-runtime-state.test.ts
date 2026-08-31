import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  RuntimeCheckpointSchema,
  RuntimeContextEnvelopeSchema,
  validateRuntimeArtifactExchange,
  validateRuntimeContextEnvelope,
  type RuntimeArtifact,
  type RuntimeCheckpoint,
  type RuntimeContextEnvelope
} from "../src/index.js";

const timestamp = "2026-08-31T15:30:00.000Z";

const context = (overrides: Partial<RuntimeContextEnvelope> = {}): RuntimeContextEnvelope => ({
  contract_version: 1,
  project_id: "project-1",
  task_id: "research-task",
  role: "researcher",
  memory_scope: {
    read_mode: "project_segments",
    source_ids: ["project-memory-segment-1"],
    write_back: "result_and_evidence"
  },
  artifact_ids: ["brief-1"],
  source_ids: ["source-1"],
  allowed_data_classes: ["D0_PUBLIC", "D1_PROJECT"],
  max_input_tokens: 50_000,
  max_artifacts: 10,
  max_memory_segments: 5,
  global_memory_scope_ids: [],
  cross_project_scope_ids: [],
  untrusted_instruction_treatment: "data_only",
  private_chat_persistence: "forbidden",
  ...overrides
});

const artifact: RuntimeArtifact = {
  artifact_id: "evidence-1",
  project_id: "project-1",
  task_id: "research-task",
  producer_role: "researcher",
  producer_instance_id: "researcher-instance-1",
  kind: "evidence",
  data_class: "D1_PROJECT",
  source_trust: "external_untrusted",
  instruction_treatment: "data_only",
  payload_ref: "payload-evidence-1",
  source_artifact_ids: [],
  source_ids: ["source-1"],
  created_at: timestamp
};

const checkpoint: RuntimeCheckpoint = {
  contract_version: 1,
  checkpoint_id: "checkpoint-1",
  project_id: "project-1",
  graph_id: "graph-1",
  task_states: [
    { task_id: "research-task", status: "completed" },
    { task_id: "analysis-task", status: "ready" }
  ],
  artifact_ids: ["evidence-1"],
  open_conflict_ids: [],
  restores_permissions: false,
  restores_sessions: false,
  restores_autonomy_escalation: false,
  created_at: timestamp
};

describe("Manager runtime context and recovery contracts", () => {
  it("keeps context explicitly bounded and instruction-safe", () => {
    const value = context();
    expect(Value.Check(RuntimeContextEnvelopeSchema, value)).toBe(true);
    expect(validateRuntimeContextEnvelope(value)).toEqual([]);
    expect(
      Value.Check(RuntimeContextEnvelopeSchema, {
        ...value,
        untrusted_instruction_treatment: "execute"
      })
    ).toBe(false);
  });

  it("blocks D4 write-back and detects context budget overflow", () => {
    const privateChat = context({
      allowed_data_classes: ["D4_PRIVATE_CHAT"],
      memory_scope: {
        read_mode: "task",
        source_ids: ["private-chat-segment"],
        write_back: "result_only"
      }
    });
    expect(validateRuntimeContextEnvelope(privateChat)).toContain(
      "D4 private chat context cannot write back to persistent memory"
    );

    const overflow = context({
      artifact_ids: ["artifact-1", "artifact-2"],
      max_artifacts: 1,
      max_memory_segments: 0
    });
    expect(validateRuntimeContextEnvelope(overflow)).toEqual(
      expect.arrayContaining([
        "Context artifact count exceeds max_artifacts",
        "Context memory segment count exceeds max_memory_segments"
      ])
    );
  });

  it("checks the receiving role and project before artifact exchange", () => {
    expect(
      validateRuntimeArtifactExchange({
        artifact,
        targetRole: "analyst",
        targetProjectId: "project-1"
      })
    ).toEqual([]);

    expect(
      validateRuntimeArtifactExchange({
        artifact: { ...artifact, kind: "checkpoint" },
        targetRole: "researcher",
        targetProjectId: "project-2"
      })
    ).toEqual(
      expect.arrayContaining([
        "Artifact exchange crosses the target project boundary",
        "Role researcher does not accept artifact kind checkpoint"
      ])
    );
  });

  it("allows checkpoint recovery data but never restores authority", () => {
    expect(Value.Check(RuntimeCheckpointSchema, checkpoint)).toBe(true);
    expect(
      Value.Check(RuntimeCheckpointSchema, {
        ...checkpoint,
        restores_permissions: true
      })
    ).toBe(false);
    expect(
      Value.Check(RuntimeCheckpointSchema, {
        ...checkpoint,
        permission_ids: ["permission-1"]
      })
    ).toBe(false);
    expect(
      Value.Check(RuntimeCheckpointSchema, {
        ...checkpoint,
        session_tokens: ["secret-session-token"]
      })
    ).toBe(false);
  });
});
