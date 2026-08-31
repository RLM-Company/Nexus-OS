import { Type, type Static } from "typebox";
import { AgentMemoryScopeSchema } from "./agent-studio.js";
import {
  MANAGER_RUNTIME_CONTRACT_VERSION,
  MANAGER_RUNTIME_ROLE_CONTRACTS,
  ManagerRuntimeRoleSchema,
  RuntimeArtifactKindSchema,
  RuntimeDataClassSchema,
  RuntimeTaskStatusSchema,
  type ManagerRuntimeRole,
  type RuntimeArtifact,
  type RuntimeArtifactKind
} from "./manager-runtime.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const RuntimeContextEnvelopeSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    project_id: EntityIdSchema,
    task_id: EntityIdSchema,
    role: ManagerRuntimeRoleSchema,
    memory_scope: AgentMemoryScopeSchema,
    artifact_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    source_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    allowed_data_classes: Type.Array(RuntimeDataClassSchema, {
      minItems: 1,
      maxItems: 5,
      uniqueItems: true
    }),
    max_input_tokens: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
    max_artifacts: Type.Integer({ minimum: 0, maximum: 10_000 }),
    max_memory_segments: Type.Integer({ minimum: 0, maximum: 10_000 }),
    global_memory_scope_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    cross_project_scope_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    untrusted_instruction_treatment: Type.Literal("data_only"),
    private_chat_persistence: Type.Literal("forbidden")
  },
  { additionalProperties: false }
);
export type RuntimeContextEnvelope = Static<typeof RuntimeContextEnvelopeSchema>;

export const RuntimeCheckpointSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    checkpoint_id: EntityIdSchema,
    project_id: EntityIdSchema,
    graph_id: EntityIdSchema,
    task_states: Type.Array(
      Type.Object(
        {
          task_id: EntityIdSchema,
          status: RuntimeTaskStatusSchema
        },
        { additionalProperties: false }
      ),
      { maxItems: 10_000 }
    ),
    artifact_ids: Type.Array(EntityIdSchema, { maxItems: 100_000, uniqueItems: true }),
    open_conflict_ids: Type.Array(EntityIdSchema, { maxItems: 10_000, uniqueItems: true }),
    restores_permissions: Type.Literal(false),
    restores_sessions: Type.Literal(false),
    restores_autonomy_escalation: Type.Literal(false),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeCheckpoint = Static<typeof RuntimeCheckpointSchema>;

export const validateRuntimeContextEnvelope = (context: RuntimeContextEnvelope): string[] => {
  const issues: string[] = [];

  if (context.artifact_ids.length > context.max_artifacts) {
    issues.push("Context artifact count exceeds max_artifacts");
  }
  if (context.memory_scope.source_ids.length > context.max_memory_segments) {
    issues.push("Context memory segment count exceeds max_memory_segments");
  }
  if (
    context.allowed_data_classes.includes("D4_PRIVATE_CHAT") &&
    context.memory_scope.write_back !== "none"
  ) {
    issues.push("D4 private chat context cannot write back to persistent memory");
  }
  if (
    context.memory_scope.read_mode === "none" &&
    context.memory_scope.source_ids.length > 0
  ) {
    issues.push("Memory source IDs require a non-none memory read mode");
  }

  return issues;
};

export const validateRuntimeArtifactExchange = (input: {
  artifact: RuntimeArtifact;
  targetRole: ManagerRuntimeRole;
  targetProjectId: string;
}): string[] => {
  const issues: string[] = [];
  const roleContract = MANAGER_RUNTIME_ROLE_CONTRACTS[input.targetRole];

  if (input.artifact.project_id !== input.targetProjectId) {
    issues.push("Artifact exchange crosses the target project boundary");
  }
  if (!roleContract.accepts.includes(input.artifact.kind as RuntimeArtifactKind)) {
    issues.push(
      `Role ${input.targetRole} does not accept artifact kind ${input.artifact.kind}`
    );
  }
  if (input.artifact.instruction_treatment !== "data_only") {
    issues.push("Artifact exchange attempted to introduce a new instruction authority");
  }

  return issues;
};

export const RuntimeArtifactExchangeSchema = Type.Object(
  {
    project_id: EntityIdSchema,
    from_role: ManagerRuntimeRoleSchema,
    to_role: ManagerRuntimeRoleSchema,
    artifact_id: EntityIdSchema,
    artifact_kind: RuntimeArtifactKindSchema,
    delivered_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeArtifactExchange = Static<typeof RuntimeArtifactExchangeSchema>;
