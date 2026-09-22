import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ArtifactVerificationStatusSchema,
  ManagerExecutionPhaseSchema,
  ManagerExecutionRequestSchema,
  ManagerExecutionResultSchema,
  ManagerExecutionResultStatusSchema,
  ManagerExecutionSnapshotSchema,
  RuntimeArtifactVerificationSchema
} from "../src/index.js";

const timestamp = "2026-09-22T12:00:00.000Z";

const validRequest = {
  contract_version: 1,
  execution_id: "execution-1",
  project_id: "project-1",
  owner_task_ref: "owner-task-1",
  allowed_roles: ["manager"],
  max_tasks: 10,
  max_parallel_tasks: 2,
  max_model_requests: 5,
  max_input_tokens: 50_000,
  max_output_tokens: 10_000,
  created_at: timestamp
};

const validVerification = {
  verification_id: "verification-1",
  project_id: "project-1",
  task_id: "task-1",
  artifact_id: "artifact-1",
  verifier: "contract_gate",
  status: "PASS",
  check_ids: ["shape"],
  critic_verdict_id: null,
  created_at: timestamp
};

const validResult = {
  status: "completed",
  summary_artifact_id: "artifact-1",
  deliverable_artifact_ids: ["artifact-1"],
  verified_artifact_ids: ["artifact-1"],
  unresolved_task_ids: [],
  created_at: timestamp
};

const validSnapshot = {
  contract_version: 1,
  execution_id: "execution-1",
  project_id: "project-1",
  graph_id: "graph-1",
  phase: "accepted",
  task_states: [{ task_id: "task-1", status: "pending" }],
  artifact_ids: [],
  verifications: [],
  checkpoint_id: null,
  result: null,
  updated_at: timestamp
};

describe("Manager execution schema boundaries", () => {
  it.each([
    "accepted",
    "planned",
    "executing",
    "verifying",
    "completed",
    "blocked",
    "failed",
    "cancelled"
  ])("accepts execution phase %s", (phase) => {
    expect(Value.Check(ManagerExecutionPhaseSchema, phase)).toBe(true);
  });

  it.each(["unknown", "", "running", null, 1])("rejects execution phase %j", (phase) => {
    expect(Value.Check(ManagerExecutionPhaseSchema, phase)).toBe(false);
  });

  it.each(["completed", "blocked", "failed", "cancelled"])(
    "accepts result status %s",
    (status) => {
      expect(Value.Check(ManagerExecutionResultStatusSchema, status)).toBe(true);
    }
  );

  it.each(["accepted", "executing", "unknown", "", null])(
    "rejects result status %j",
    (status) => {
      expect(Value.Check(ManagerExecutionResultStatusSchema, status)).toBe(false);
    }
  );

  it.each(["PASS", "FAIL"])("accepts verification status %s", (status) => {
    expect(Value.Check(ArtifactVerificationStatusSchema, status)).toBe(true);
  });

  it.each(["pass", "fail", "UNKNOWN", "", null])("rejects verification status %j", (status) => {
    expect(Value.Check(ArtifactVerificationStatusSchema, status)).toBe(false);
  });

  it.each([
    ["max_tasks", 1, true],
    ["max_tasks", 10_000, true],
    ["max_tasks", 0, false],
    ["max_tasks", 10_001, false],
    ["max_tasks", 1.5, false],
    ["max_parallel_tasks", 1, true],
    ["max_parallel_tasks", 100, true],
    ["max_parallel_tasks", 0, false],
    ["max_parallel_tasks", 101, false],
    ["max_parallel_tasks", 1.5, false],
    ["max_model_requests", 0, true],
    ["max_model_requests", 100_000, true],
    ["max_model_requests", -1, false],
    ["max_model_requests", 100_001, false],
    ["max_model_requests", 1.5, false],
    ["max_input_tokens", 0, true],
    ["max_input_tokens", 1_000_000_000, true],
    ["max_input_tokens", -1, false],
    ["max_input_tokens", 1_000_000_001, false],
    ["max_input_tokens", 1.5, false],
    ["max_output_tokens", 0, true],
    ["max_output_tokens", 1_000_000_000, true],
    ["max_output_tokens", -1, false],
    ["max_output_tokens", 1_000_000_001, false],
    ["max_output_tokens", 1.5, false]
  ] as const)("checks request boundary %s=%s", (field, value, expected) => {
    expect(Value.Check(ManagerExecutionRequestSchema, { ...validRequest, [field]: value })).toBe(
      expected
    );
  });

  it.each([
    ["manager"],
    ["manager", "architect", "researcher", "analyst", "critic"]
  ])("accepts bounded allowed_roles %j", (allowedRoles) => {
    expect(
      Value.Check(ManagerExecutionRequestSchema, {
        ...validRequest,
        allowed_roles: allowedRoles
      })
    ).toBe(true);
  });

  it.each([
    [],
    ["manager", "manager"],
    ["manager", "unknown"],
    ["manager", "architect", "researcher", "analyst", "critic", "manager"]
  ])("rejects invalid allowed_roles %j", (allowedRoles) => {
    expect(
      Value.Check(ManagerExecutionRequestSchema, {
        ...validRequest,
        allowed_roles: allowedRoles
      })
    ).toBe(false);
  });

  it.each([
    ["execution_id", ""],
    ["execution_id", "execution 1"],
    ["execution_id", "x".repeat(129)],
    ["project_id", ""],
    ["project_id", "project 1"],
    ["owner_task_ref", ""],
    ["owner_task_ref", "owner task"]
  ] as const)("rejects invalid request identifier %s=%j", (field, value) => {
    expect(Value.Check(ManagerExecutionRequestSchema, { ...validRequest, [field]: value })).toBe(
      false
    );
  });

  it.each([
    ["2026-09-22T12:00:00Z", true],
    ["2026-09-22T12:00:00.000Z", true],
    ["2026-09-22 12:00:00Z", false],
    ["2026-09-22T12:00:00+00:00", false],
    ["", false]
  ] as const)("checks request timestamp shape %j", (createdAt, expected) => {
    expect(Value.Check(ManagerExecutionRequestSchema, { ...validRequest, created_at: createdAt })).toBe(
      expected
    );
  });

  it("rejects wrong contract version and additional request fields", () => {
    expect(
      Value.Check(ManagerExecutionRequestSchema, { ...validRequest, contract_version: 2 })
    ).toBe(false);
    expect(
      Value.Check(ManagerExecutionRequestSchema, { ...validRequest, unexpected: true })
    ).toBe(false);
  });

  it.each(["critic", "contract_gate"])("accepts verifier %s", (verifier) => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, { ...validVerification, verifier })
    ).toBe(true);
  });

  it.each(["manager", "policy", "", null])("rejects verifier %j", (verifier) => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, { ...validVerification, verifier })
    ).toBe(false);
  });

  it.each([
    ["verification_id", ""],
    ["verification_id", "verification 1"],
    ["project_id", ""],
    ["task_id", "task 1"],
    ["artifact_id", ""]
  ] as const)("rejects invalid verification identifier %s=%j", (field, value) => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, { ...validVerification, [field]: value })
    ).toBe(false);
  });

  it("rejects malformed verification timestamps", () => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        created_at: "2026-09-22 12:00:00Z"
      })
    ).toBe(false);
  });

  it("checks verification check_ids cardinality and uniqueness", () => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, { ...validVerification, check_ids: [] })
    ).toBe(false);
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        check_ids: ["shape", "shape"]
      })
    ).toBe(false);
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        check_ids: Array.from({ length: 1_000 }, (_, index) => `check-${index}`)
      })
    ).toBe(true);
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        check_ids: Array.from({ length: 1_001 }, (_, index) => `check-${index}`)
      })
    ).toBe(false);
  });

  it("accepts nullable or populated critic verdict IDs at schema level", () => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        critic_verdict_id: null
      })
    ).toBe(true);
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        critic_verdict_id: "critic-verdict-1"
      })
    ).toBe(true);
  });

  it("rejects verification additional fields", () => {
    expect(
      Value.Check(RuntimeArtifactVerificationSchema, {
        ...validVerification,
        raw_model_output: "not-allowed"
      })
    ).toBe(false);
  });

  it.each([
    ["deliverable_artifact_ids", ["artifact-1", "artifact-1"]],
    ["verified_artifact_ids", ["artifact-1", "artifact-1"]],
    ["unresolved_task_ids", ["task-1", "task-1"]]
  ] as const)("rejects duplicate result IDs in %s", (field, value) => {
    expect(Value.Check(ManagerExecutionResultSchema, { ...validResult, [field]: value })).toBe(
      false
    );
  });

  it.each([
    ["summary_artifact_id", "artifact 1"],
    ["summary_artifact_id", "x".repeat(129)]
  ] as const)("rejects invalid result identifier %s=%j", (field, value) => {
    expect(Value.Check(ManagerExecutionResultSchema, { ...validResult, [field]: value })).toBe(
      false
    );
  });

  it("rejects malformed result timestamps", () => {
    expect(
      Value.Check(ManagerExecutionResultSchema, {
        ...validResult,
        created_at: "2026-09-22T12:00:00+00:00"
      })
    ).toBe(false);
  });

  it("accepts nullable summary artifact and strict result shape", () => {
    expect(
      Value.Check(ManagerExecutionResultSchema, {
        ...validResult,
        summary_artifact_id: null
      })
    ).toBe(true);
    expect(Value.Check(ManagerExecutionResultSchema, validResult)).toBe(true);
    expect(
      Value.Check(ManagerExecutionResultSchema, { ...validResult, unexpected: true })
    ).toBe(false);
  });

  it.each([
    ["execution_id", ""],
    ["execution_id", "execution 1"],
    ["project_id", "project 1"],
    ["graph_id", ""],
    ["checkpoint_id", "checkpoint 1"]
  ] as const)("rejects invalid snapshot identifier %s=%j", (field, value) => {
    expect(Value.Check(ManagerExecutionSnapshotSchema, { ...validSnapshot, [field]: value })).toBe(
      false
    );
  });

  it("rejects malformed snapshot timestamps", () => {
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, {
        ...validSnapshot,
        updated_at: "2026-09-22T12:00Z"
      })
    ).toBe(false);
  });

  it("requires at least one snapshot task state", () => {
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, { ...validSnapshot, task_states: [] })
    ).toBe(false);
    expect(Value.Check(ManagerExecutionSnapshotSchema, validSnapshot)).toBe(true);
  });

  it("rejects duplicate snapshot artifact IDs and additional fields", () => {
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, {
        ...validSnapshot,
        artifact_ids: ["artifact-1", "artifact-1"]
      })
    ).toBe(false);
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, {
        ...validSnapshot,
        unexpected: true
      })
    ).toBe(false);
  });

  it("accepts nullable checkpoint and result fields at schema level", () => {
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, {
        ...validSnapshot,
        checkpoint_id: "checkpoint-1"
      })
    ).toBe(true);
    expect(
      Value.Check(ManagerExecutionSnapshotSchema, {
        ...validSnapshot,
        phase: "completed",
        result: validResult
      })
    ).toBe(true);
  });
});
