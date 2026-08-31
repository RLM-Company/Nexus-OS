import { Type, type Static } from "typebox";
import { AgentMemoryScopeSchema } from "./agent-studio.js";
import { AutonomyLevelSchema, PolicyVerdictKindSchema } from "./policy.js";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const MANAGER_RUNTIME_CONTRACT_VERSION = 1 as const;

export const ManagerRuntimeRoleSchema = Type.Union([
  Type.Literal("manager"),
  Type.Literal("architect"),
  Type.Literal("researcher"),
  Type.Literal("analyst"),
  Type.Literal("critic")
]);
export type ManagerRuntimeRole = Static<typeof ManagerRuntimeRoleSchema>;

export const MANAGER_RUNTIME_ROLES = [
  "manager",
  "architect",
  "researcher",
  "analyst",
  "critic"
] as const satisfies readonly ManagerRuntimeRole[];

export const RuntimeArtifactKindSchema = Type.Union([
  Type.Literal("plan"),
  Type.Literal("architecture"),
  Type.Literal("evidence"),
  Type.Literal("analysis"),
  Type.Literal("decision"),
  Type.Literal("critic_verdict"),
  Type.Literal("handoff"),
  Type.Literal("checkpoint")
]);
export type RuntimeArtifactKind = Static<typeof RuntimeArtifactKindSchema>;

export const RuntimeDataClassSchema = Type.Union([
  Type.Literal("D0_PUBLIC"),
  Type.Literal("D1_PROJECT"),
  Type.Literal("D2_CONFIDENTIAL"),
  Type.Literal("D3_RESTRICTED"),
  Type.Literal("D4_PRIVATE_CHAT")
]);
export type RuntimeDataClass = Static<typeof RuntimeDataClassSchema>;

export const RuntimeSourceTrustSchema = Type.Union([
  Type.Literal("system"),
  Type.Literal("owner"),
  Type.Literal("project"),
  Type.Literal("external_untrusted")
]);
export type RuntimeSourceTrust = Static<typeof RuntimeSourceTrustSchema>;

export const RuntimeArtifactSchema = Type.Object(
  {
    artifact_id: EntityIdSchema,
    project_id: EntityIdSchema,
    task_id: EntityIdSchema,
    producer_role: ManagerRuntimeRoleSchema,
    producer_instance_id: EntityIdSchema,
    kind: RuntimeArtifactKindSchema,
    data_class: RuntimeDataClassSchema,
    source_trust: RuntimeSourceTrustSchema,
    instruction_treatment: Type.Literal("data_only"),
    payload_ref: EntityIdSchema,
    source_artifact_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    source_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeArtifact = Static<typeof RuntimeArtifactSchema>;

export const RuntimeTaskStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("ready"),
  Type.Literal("running"),
  Type.Literal("blocked"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type RuntimeTaskStatus = Static<typeof RuntimeTaskStatusSchema>;

export const RuntimeTaskNodeSchema = Type.Object(
  {
    task_id: EntityIdSchema,
    project_id: EntityIdSchema,
    assigned_role: ManagerRuntimeRoleSchema,
    status: RuntimeTaskStatusSchema,
    depends_on: Type.Array(EntityIdSchema, { maxItems: 100, uniqueItems: true }),
    input_artifact_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    expected_output_kinds: Type.Array(RuntimeArtifactKindSchema, {
      minItems: 1,
      maxItems: 20,
      uniqueItems: true
    }),
    memory_scope: AgentMemoryScopeSchema,
    max_iterations: Type.Integer({ minimum: 1, maximum: 100 }),
    timeout_ms: Type.Integer({ minimum: 1, maximum: 86_400_000 }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeTaskNode = Static<typeof RuntimeTaskNodeSchema>;

export const RuntimeTaskGraphSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    graph_id: EntityIdSchema,
    project_id: EntityIdSchema,
    root_task_id: EntityIdSchema,
    nodes: Type.Array(RuntimeTaskNodeSchema, { minItems: 1, maxItems: 10_000 }),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type RuntimeTaskGraph = Static<typeof RuntimeTaskGraphSchema>;

export const RuntimeRoleContractSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    role: ManagerRuntimeRoleSchema,
    accepts: Type.Array(RuntimeArtifactKindSchema, { maxItems: 20, uniqueItems: true }),
    emits: Type.Array(RuntimeArtifactKindSchema, { minItems: 1, maxItems: 20, uniqueItems: true }),
    can_delegate: Type.Boolean(),
    can_arbitrate_conflict: Type.Boolean(),
    can_review: Type.Boolean(),
    project_bound: Type.Literal(true),
    external_action_authority: Type.Literal(false),
    permission_authority: Type.Literal(false),
    policy_bypass: Type.Literal(false)
  },
  { additionalProperties: false }
);
export type RuntimeRoleContract = Static<typeof RuntimeRoleContractSchema>;

export const MANAGER_RUNTIME_ROLE_CONTRACTS: Readonly<
  Record<ManagerRuntimeRole, RuntimeRoleContract>
> = {
  manager: {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    role: "manager",
    accepts: ["architecture", "evidence", "analysis", "critic_verdict", "handoff", "checkpoint"],
    emits: ["plan", "decision", "handoff", "checkpoint"],
    can_delegate: true,
    can_arbitrate_conflict: true,
    can_review: false,
    project_bound: true,
    external_action_authority: false,
    permission_authority: false,
    policy_bypass: false
  },
  architect: {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    role: "architect",
    accepts: ["plan", "evidence", "analysis", "handoff"],
    emits: ["architecture", "handoff"],
    can_delegate: false,
    can_arbitrate_conflict: false,
    can_review: false,
    project_bound: true,
    external_action_authority: false,
    permission_authority: false,
    policy_bypass: false
  },
  researcher: {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    role: "researcher",
    accepts: ["plan", "handoff"],
    emits: ["evidence", "handoff"],
    can_delegate: false,
    can_arbitrate_conflict: false,
    can_review: false,
    project_bound: true,
    external_action_authority: false,
    permission_authority: false,
    policy_bypass: false
  },
  analyst: {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    role: "analyst",
    accepts: ["plan", "evidence", "architecture", "handoff"],
    emits: ["analysis", "handoff"],
    can_delegate: false,
    can_arbitrate_conflict: false,
    can_review: false,
    project_bound: true,
    external_action_authority: false,
    permission_authority: false,
    policy_bypass: false
  },
  critic: {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    role: "critic",
    accepts: ["architecture", "evidence", "analysis", "decision", "handoff"],
    emits: ["critic_verdict", "handoff"],
    can_delegate: false,
    can_arbitrate_conflict: false,
    can_review: true,
    project_bound: true,
    external_action_authority: false,
    permission_authority: false,
    policy_bypass: false
  }
};

export const CriticSeveritySchema = Type.Union([
  Type.Literal("INFO"),
  Type.Literal("WARNING"),
  Type.Literal("SERIOUS"),
  Type.Literal("CRITICAL")
]);
export type CriticSeverity = Static<typeof CriticSeveritySchema>;

export const CriticPauseScopeSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("task"),
  Type.Literal("subgraph"),
  Type.Literal("project")
]);
export type CriticPauseScope = Static<typeof CriticPauseScopeSchema>;

export const CriticVerdictSchema = Type.Object(
  {
    verdict_id: EntityIdSchema,
    project_id: EntityIdSchema,
    critic_instance_id: EntityIdSchema,
    reviewed_artifact_ids: Type.Array(EntityIdSchema, {
      minItems: 1,
      maxItems: 1_000,
      uniqueItems: true
    }),
    severity: CriticSeveritySchema,
    scope: Type.Array(EntityIdSchema, { minItems: 1, maxItems: 1_000, uniqueItems: true }),
    risk_statement: Type.String({ minLength: 1, maxLength: 10_000 }),
    evidence_ids: Type.Array(EntityIdSchema, { maxItems: 1_000, uniqueItems: true }),
    uncertainty: Type.String({ minLength: 1, maxLength: 10_000 }),
    recommended_check: Type.String({ minLength: 1, maxLength: 10_000 }),
    rollback: Type.Union([Type.String({ minLength: 1, maxLength: 10_000 }), Type.Null()]),
    pause_scope: CriticPauseScopeSchema,
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type CriticVerdict = Static<typeof CriticVerdictSchema>;

export const AgentConflictStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("resolved"),
  Type.Literal("escalated")
]);
export type AgentConflictStatus = Static<typeof AgentConflictStatusSchema>;

export const AgentConflictSchema = Type.Object(
  {
    conflict_id: EntityIdSchema,
    project_id: EntityIdSchema,
    task_id: EntityIdSchema,
    positions: Type.Array(
      Type.Object(
        {
          role: ManagerRuntimeRoleSchema,
          artifact_id: EntityIdSchema,
          claim: Type.String({ minLength: 1, maxLength: 20_000 })
        },
        { additionalProperties: false }
      ),
      { minItems: 2, maxItems: 20 }
    ),
    status: AgentConflictStatusSchema,
    resolution_artifact_id: Type.Union([EntityIdSchema, Type.Null()]),
    unresolved_uncertainty: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: 100
    }),
    created_at: IsoDateTimeSchema,
    resolved_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type AgentConflict = Static<typeof AgentConflictSchema>;

export const RuntimeRecoveryStateSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("paused"),
  Type.Literal("recovery_required"),
  Type.Literal("completed"),
  Type.Literal("failed")
]);
export type RuntimeRecoveryState = Static<typeof RuntimeRecoveryStateSchema>;

export const SystemScenarioCategorySchema = Type.Union([
  Type.Literal("agent_conflict"),
  Type.Literal("critic"),
  Type.Literal("memory"),
  Type.Literal("autonomy"),
  Type.Literal("emergency_stop"),
  Type.Literal("model_switch"),
  Type.Literal("timeout_fallback"),
  Type.Literal("operation_replay"),
  Type.Literal("project_recovery"),
  Type.Literal("prompt_injection"),
  Type.Literal("memory_poisoning"),
  Type.Literal("cross_project_leak"),
  Type.Literal("false_critic")
]);
export type SystemScenarioCategory = Static<typeof SystemScenarioCategorySchema>;

export const REQUIRED_MANAGER_RUNTIME_SCENARIOS = [
  "agent_conflict",
  "critic",
  "memory",
  "autonomy",
  "emergency_stop",
  "model_switch",
  "timeout_fallback",
  "operation_replay",
  "project_recovery",
  "prompt_injection",
  "memory_poisoning",
  "cross_project_leak",
  "false_critic"
] as const satisfies readonly SystemScenarioCategory[];

export const ScenarioAssertionSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("policy_verdict"),
      operation_id: EntityIdSchema,
      expected: PolicyVerdictKindSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("task_state"),
      task_id: EntityIdSchema,
      expected: RuntimeTaskStatusSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("runtime_state"),
      expected: RuntimeRecoveryStateSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("artifact_visibility"),
      artifact_id: EntityIdSchema,
      visible: Type.Boolean()
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("operation_effect_count"),
      operation_id: EntityIdSchema,
      expected: Type.Integer({ minimum: 0, maximum: 1 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("critic_pause"),
      expected: CriticPauseScopeSchema
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      kind: Type.Literal("route_group"),
      expected_group_id: EntityIdSchema
    },
    { additionalProperties: false }
  )
]);
export type ScenarioAssertion = Static<typeof ScenarioAssertionSchema>;

export const ManagerRuntimeScenarioSchema = Type.Object(
  {
    contract_version: Type.Literal(MANAGER_RUNTIME_CONTRACT_VERSION),
    scenario_id: EntityIdSchema,
    category: SystemScenarioCategorySchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    required_for: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      minItems: 1,
      maxItems: 50,
      uniqueItems: true
    }),
    fixture_refs: Type.Array(EntityIdSchema, { maxItems: 100, uniqueItems: true }),
    autonomy_level: AutonomyLevelSchema,
    assertions: Type.Array(ScenarioAssertionSchema, { minItems: 1, maxItems: 100 }),
    invariant_ids: Type.Array(EntityIdSchema, { minItems: 1, maxItems: 100, uniqueItems: true })
  },
  { additionalProperties: false }
);
export type ManagerRuntimeScenario = Static<typeof ManagerRuntimeScenarioSchema>;

export const criticPauseScopeFor = (severity: CriticSeverity): CriticPauseScope => {
  if (severity === "SERIOUS" || severity === "CRITICAL") return "task";
  return "none";
};

export const validateRuntimeTaskGraph = (graph: RuntimeTaskGraph): string[] => {
  const issues: string[] = [];
  const byId = new Map<string, RuntimeTaskNode>();

  for (const node of graph.nodes) {
    if (byId.has(node.task_id)) issues.push(`Duplicate task_id: ${node.task_id}`);
    byId.set(node.task_id, node);
    if (node.project_id !== graph.project_id) {
      issues.push(`Task ${node.task_id} belongs to another project`);
    }
  }

  if (!byId.has(graph.root_task_id)) issues.push("Root task does not exist");

  for (const node of graph.nodes) {
    for (const dependencyId of node.depends_on) {
      if (!byId.has(dependencyId)) {
        issues.push(`Task ${node.task_id} depends on missing task ${dependencyId}`);
      }
      if (dependencyId === node.task_id) issues.push(`Task ${node.task_id} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      issues.push(`Task graph contains a cycle at ${taskId}`);
      return;
    }
    const node = byId.get(taskId);
    if (!node) return;
    visiting.add(taskId);
    for (const dependencyId of node.depends_on) visit(dependencyId);
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const taskId of byId.keys()) visit(taskId);
  return [...new Set(issues)];
};

export const validateCriticVerdict = (verdict: CriticVerdict): string[] => {
  const issues: string[] = [];
  const shouldPause = verdict.severity === "SERIOUS" || verdict.severity === "CRITICAL";
  if (shouldPause && verdict.pause_scope === "none") {
    issues.push("SERIOUS and CRITICAL critic verdicts must pause the affected area");
  }
  if (!shouldPause && verdict.pause_scope !== "none") {
    issues.push("INFO and WARNING critic verdicts must not pause runtime by themselves");
  }
  return issues;
};

export const validateScenarioCoverage = (
  scenarios: readonly ManagerRuntimeScenario[]
): string[] => {
  const present = new Set(scenarios.map((scenario) => scenario.category));
  return REQUIRED_MANAGER_RUNTIME_SCENARIOS.filter((category) => !present.has(category)).map(
    (category) => `Missing required runtime scenario: ${category}`
  );
};
