import { Type, type Static } from "typebox";
import {
  MANAGER_RUNTIME_CONTRACT_VERSION,
  ManagerRuntimeRoleSchema,
  RuntimeTaskStatusSchema,
  type RuntimeArtifact,
  type RuntimeTaskGraph
} from "./manager-runtime.js";
import { validateRuntimeArtifactTaskBinding } from "./manager-runtime-artifact-task-binding.js";
import { validateRuntimeArtifactProvenance } from "./manager-runtime-artifact-provenance.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const ManagerExecutionPhaseSchema = Type.Union([
  Type.Literal("accepted"),
  Type.Literal("planned"),
  Type.Literal("executing"),
  Type.Literal("verifying"),
  Type.Literal("completed"),
  Type.Literal("blocked"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type ManagerExecutionPhase = Static<typeof ManagerExecutionPhaseSchema>;

export const ManagerExecutionRequestSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    execution_id: EntityIdSchema,
    project_id: EntityIdSchema,
    owner_task_ref: EntityIdSchema,
    allowed_roles: Type.Array(ManagerRuntimeRoleSchema, {
      minItems: 1,
      maxItems: 5,
      uniqueItems: true
    }),
    max_tasks: Type.Integer({ minimum: 1, maximum: 10_000 }),
    max_parallel_tasks: Type.Integer({ minimum: 1, maximum: 100 }),
    max_model_requests: Type.Integer({ minimum: 0, maximum: 100_000 }),
    max_input_tokens: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
    max_output_tokens: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ManagerExecutionRequest = Static<typeof ManagerExecutionRequestSchema>;

export const ArtifactVerificationStatusSchema = Type.Union([
  Type.Literal("PASS"),
  Type.Literal("FAIL")
]);
export type ArtifactVerificationStatus = Static<typeof ArtifactVerificationStatusSchema>;

export const RuntimeArtifactVerificationSchema = Type.Object(
  {
    verification_id: EntityIdSchema,
    project_id: EntityIdSchema,
    task_id: EntityIdSchema,
    artifact_id: EntityIdSchema,
    verifier: Type.Union([Type.Literal("critic"), Type.Literal("contract_gate")]),
    status: ArtifactVerificationStatusSchema,
    check_ids: Type.Array(EntityIdSchema, { minItems: 1, maxItems: 1_000, uniqueItems: true }),
    critic_verdict_id: Type.Union([EntityIdSchema, Type.Null()]),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeArtifactVerification = Static<typeof RuntimeArtifactVerificationSchema>;

export const ManagerExecutionResultStatusSchema = Type.Union([
  Type.Literal("completed"),
  Type.Literal("blocked"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type ManagerExecutionResultStatus = Static<typeof ManagerExecutionResultStatusSchema>;

export const ManagerExecutionResultSchema = Type.Object(
  {
    status: ManagerExecutionResultStatusSchema,
    summary_artifact_id: Type.Union([EntityIdSchema, Type.Null()]),
    deliverable_artifact_ids: Type.Array(EntityIdSchema, {
      maxItems: 10_000,
      uniqueItems: true
    }),
    verified_artifact_ids: Type.Array(EntityIdSchema, {
      maxItems: 10_000,
      uniqueItems: true
    }),
    unresolved_task_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ManagerExecutionResult = Static<typeof ManagerExecutionResultSchema>;

export const ManagerExecutionSnapshotSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    execution_id: EntityIdSchema,
    project_id: EntityIdSchema,
    graph_id: EntityIdSchema,
    phase: ManagerExecutionPhaseSchema,
    task_states: Type.Array(
      Type.Object(
        {
          task_id: EntityIdSchema,
          status: RuntimeTaskStatusSchema
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: 10_000 }
    ),
    artifact_ids: Type.Array(EntityIdSchema, { maxItems: 100_000, uniqueItems: true }),
    verifications: Type.Array(RuntimeArtifactVerificationSchema, { maxItems: 100_000 }),
    checkpoint_id: Type.Union([EntityIdSchema, Type.Null()]),
    result: Type.Union([ManagerExecutionResultSchema, Type.Null()]),
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ManagerExecutionSnapshot = Static<typeof ManagerExecutionSnapshotSchema>;

const TERMINAL_PHASES: readonly ManagerExecutionPhase[] = [
  "completed",
  "blocked",
  "failed",
  "cancelled"
];

export const validateManagerExecutionRequest = (input: {
  request: ManagerExecutionRequest;
  graph: RuntimeTaskGraph;
}): string[] => {
  const issues: string[] = [];

  if (input.request.project_id !== input.graph.project_id) {
    issues.push("Execution request belongs to another task graph project");
  }
  if (input.graph.nodes.length > input.request.max_tasks) {
    issues.push("Task graph exceeds the execution request max_tasks budget");
  }
  if (input.request.max_parallel_tasks > input.request.max_tasks) {
    issues.push("Parallel task budget cannot exceed max_tasks");
  }

  const allowedRoles = new Set(input.request.allowed_roles);
  if (!allowedRoles.has("manager")) {
    issues.push("Execution request must allow the manager role");
  }
  const rootTask = input.graph.nodes.find((task) => task.task_id === input.graph.root_task_id);
  if (rootTask !== undefined && rootTask.assigned_role !== "manager") {
    issues.push("Execution root task must be assigned to the manager role");
  }
  for (const task of input.graph.nodes) {
    if (!allowedRoles.has(task.assigned_role)) {
      issues.push(`Task ${task.task_id} uses role outside the execution request allowlist`);
    }
  }
  const maximumGraphModelRequests = input.graph.nodes.reduce(
    (total, task) => total + task.max_iterations,
    0
  );
  if (maximumGraphModelRequests > input.request.max_model_requests) {
    issues.push("Task graph can exceed the total model request budget");
  }

  return [...new Set(issues)];
};

export const validateManagerExecutionSnapshot = (input: {
  snapshot: ManagerExecutionSnapshot;
  graph: RuntimeTaskGraph;
  artifacts: readonly RuntimeArtifact[];
}): string[] => {
  const { snapshot, graph, artifacts } = input;
  const issues: string[] = [];

  if (snapshot.project_id !== graph.project_id) {
    issues.push("Execution snapshot belongs to another task graph project");
  }
  if (snapshot.graph_id !== graph.graph_id) {
    issues.push("Execution snapshot belongs to another task graph");
  }

  const graphTasks = new Map(graph.nodes.map((task) => [task.task_id, task]));
  const snapshotTaskIds = new Set<string>();
  for (const taskState of snapshot.task_states) {
    if (snapshotTaskIds.has(taskState.task_id)) {
      issues.push(`Execution snapshot duplicates task state ${taskState.task_id}`);
    }
    snapshotTaskIds.add(taskState.task_id);
    if (!graphTasks.has(taskState.task_id)) {
      issues.push(`Execution snapshot contains unknown task ${taskState.task_id}`);
    }
  }
  for (const taskId of graphTasks.keys()) {
    if (!snapshotTaskIds.has(taskId)) {
      issues.push(`Execution snapshot is missing task state ${taskId}`);
    }
  }

  const artifactsById = new Map<string, RuntimeArtifact>();
  for (const artifact of artifacts) {
    artifactsById.set(artifact.artifact_id, artifact);
    issues.push(...validateRuntimeArtifactTaskBinding({ artifact, graph }));
  }
  issues.push(...validateRuntimeArtifactProvenance({ projectId: snapshot.project_id, artifacts }));

  for (const artifactId of snapshot.artifact_ids) {
    if (!artifactsById.has(artifactId)) {
      issues.push(`Execution snapshot references unknown artifact ${artifactId}`);
    }
  }
  for (const artifact of artifacts) {
    if (!snapshot.artifact_ids.includes(artifact.artifact_id)) {
      issues.push(`Execution snapshot omits supplied artifact ${artifact.artifact_id}`);
    }
  }

  const verificationIds = new Set<string>();
  const passedArtifactIds = new Set<string>();
  const failedArtifactIds = new Set<string>();
  for (const verification of snapshot.verifications) {
    if (verificationIds.has(verification.verification_id)) {
      issues.push(`Execution snapshot duplicates verification ${verification.verification_id}`);
    }
    verificationIds.add(verification.verification_id);
    const artifact = artifactsById.get(verification.artifact_id);
    if (verification.project_id !== snapshot.project_id) {
      issues.push(`Verification ${verification.verification_id} belongs to another project`);
    }
    if (artifact === undefined) {
      issues.push(`Verification ${verification.verification_id} references unknown artifact`);
    } else if (artifact.task_id !== verification.task_id) {
      issues.push(`Verification ${verification.verification_id} references the wrong task`);
    }
    if (verification.verifier === "critic" && verification.critic_verdict_id === null) {
      issues.push(`Critic verification ${verification.verification_id} requires a verdict`);
    }
    if (verification.verifier === "critic" && verification.critic_verdict_id !== null) {
      const verdictArtifact = artifactsById.get(verification.critic_verdict_id);
      if (
        verdictArtifact === undefined ||
        verdictArtifact.kind !== "critic_verdict" ||
        verdictArtifact.project_id !== snapshot.project_id
      ) {
        issues.push(`Critic verification ${verification.verification_id} has an invalid verdict`);
      }
    }
    if (verification.verifier === "contract_gate" && verification.critic_verdict_id !== null) {
      issues.push(`Contract verification ${verification.verification_id} cannot claim a verdict`);
    }
    if (verification.status === "PASS") passedArtifactIds.add(verification.artifact_id);
    if (verification.status === "FAIL") failedArtifactIds.add(verification.artifact_id);
  }

  const isTerminal = TERMINAL_PHASES.includes(snapshot.phase);
  if (isTerminal && snapshot.result === null) {
    issues.push("Terminal execution snapshot requires a result");
  }
  if (!isTerminal && snapshot.result !== null) {
    issues.push("Non-terminal execution snapshot cannot contain a final result");
  }

  if (snapshot.result !== null) {
    if (snapshot.result.status !== snapshot.phase) {
      issues.push("Execution result status must match the terminal phase");
    }
    for (const taskId of snapshot.result.unresolved_task_ids) {
      const state = snapshot.task_states.find((candidate) => candidate.task_id === taskId);
      if (state === undefined || state.status === "completed") {
        issues.push(`Execution result has invalid unresolved task ${taskId}`);
      }
    }

    if (snapshot.phase === "completed") {
      if (snapshot.task_states.some((task) => task.status !== "completed")) {
        issues.push("Completed execution requires every task to be completed");
      }
      if (snapshot.result.summary_artifact_id === null) {
        issues.push("Completed execution requires a summary artifact");
      }
      if (snapshot.result.deliverable_artifact_ids.length === 0) {
        issues.push("Completed execution requires at least one deliverable artifact");
      }
      if (snapshot.result.unresolved_task_ids.length > 0) {
        issues.push("Completed execution cannot contain unresolved tasks");
      }
      for (const task of graph.nodes) {
        for (const expectedKind of task.expected_output_kinds) {
          const hasExpectedArtifact = artifacts.some(
            (artifact) => artifact.task_id === task.task_id && artifact.kind === expectedKind
          );
          if (!hasExpectedArtifact) {
            issues.push(`Completed task ${task.task_id} is missing ${expectedKind} output`);
          }
        }
      }
      for (const artifactId of snapshot.result.deliverable_artifact_ids) {
        if (!artifactsById.has(artifactId)) {
          issues.push(`Completed execution references unknown deliverable ${artifactId}`);
        }
        if (!passedArtifactIds.has(artifactId)) {
          issues.push(`Completed execution contains unverified deliverable ${artifactId}`);
        }
        if (failedArtifactIds.has(artifactId)) {
          issues.push(`Completed execution contains failed deliverable ${artifactId}`);
        }
        if (!snapshot.result.verified_artifact_ids.includes(artifactId)) {
          issues.push(`Completed execution omits verified deliverable ${artifactId}`);
        }
      }
      for (const artifactId of snapshot.result.verified_artifact_ids) {
        if (!passedArtifactIds.has(artifactId)) {
          issues.push(`Execution result claims unverified artifact ${artifactId}`);
        }
        if (failedArtifactIds.has(artifactId)) {
          issues.push(`Execution result claims failed artifact ${artifactId} as verified`);
        }
      }
      if (
        snapshot.result.summary_artifact_id !== null &&
        !snapshot.result.deliverable_artifact_ids.includes(snapshot.result.summary_artifact_id)
      ) {
        issues.push("Completed execution summary must be one of the deliverables");
      }
    }
  }

  return [...new Set(issues)];
};
