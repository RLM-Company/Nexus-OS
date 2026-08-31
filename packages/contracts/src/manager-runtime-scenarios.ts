import {
  MANAGER_RUNTIME_CONTRACT_VERSION,
  type ManagerRuntimeScenario
} from "./manager-runtime.js";

export const MANAGER_RUNTIME_SCENARIOS = [
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-agent-conflict-v1",
    category: "agent_conflict",
    title: "Conflicting analyst and architect outputs block the affected task until arbitration",
    required_for: ["manager-runtime-v1"],
    fixture_refs: ["fixture-agent-conflict-v1"],
    autonomy_level: "A2",
    assertions: [{ kind: "task_state", task_id: "decision-task", expected: "blocked" }],
    invariant_ids: ["manager_only_arbitration", "conflict_uncertainty_preserved"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-critic-serious-v1",
    category: "critic",
    title: "A serious critic verdict pauses the minimum affected task scope",
    required_for: ["manager-runtime-v1", "critic-runtime-v1"],
    fixture_refs: ["fixture-critic-serious-v1"],
    autonomy_level: "A2",
    assertions: [{ kind: "critic_pause", expected: "task" }],
    invariant_ids: ["critic_has_no_external_authority", "minimum_pause_scope"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-project-memory-v1",
    category: "memory",
    title: "Project memory exposes only the bounded segment declared by the task",
    required_for: ["manager-runtime-v1", "project-memory-v1"],
    fixture_refs: ["fixture-project-memory-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "artifact_visibility", artifact_id: "allowed-project-segment", visible: true },
      { kind: "artifact_visibility", artifact_id: "unrequested-project-segment", visible: false }
    ],
    invariant_ids: ["minimum_context", "memory_provenance_required"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-autonomy-verdict-v1",
    category: "autonomy",
    title: "Manager planning cannot widen an A3 policy verdict",
    required_for: ["manager-runtime-v1", "policy-runtime-v1"],
    fixture_refs: ["fixture-autonomy-a3-v1"],
    autonomy_level: "A3",
    assertions: [
      {
        kind: "policy_verdict",
        operation_id: "production-release-operation",
        expected: "NEEDS_CONFIRMATION"
      }
    ],
    invariant_ids: ["policy_is_authoritative", "manager_cannot_expand_permissions"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-emergency-stop-v1",
    category: "emergency_stop",
    title: "Emergency stop pauses runtime and denies new external operations",
    required_for: ["manager-runtime-v1", "emergency-stop-v1"],
    fixture_refs: ["fixture-emergency-stop-v1"],
    autonomy_level: "A5",
    assertions: [
      { kind: "runtime_state", expected: "paused" },
      { kind: "policy_verdict", operation_id: "new-external-operation", expected: "DENY" }
    ],
    invariant_ids: ["stop_blocks_new_operations", "stop_precedes_runtime"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-model-switch-v1",
    category: "model_switch",
    title: "Model switching remains inside the approved routing group",
    required_for: ["manager-runtime-v1", "model-router-v1"],
    fixture_refs: ["fixture-model-switch-v1"],
    autonomy_level: "A2",
    assertions: [{ kind: "route_group", expected_group_id: "approved-research-routing-group" }],
    invariant_ids: ["routing_group_boundary", "provider_details_hidden_from_role"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-timeout-fallback-v1",
    category: "timeout_fallback",
    title: "Timeout fallback either stays compatible or fails closed",
    required_for: ["manager-runtime-v1", "model-router-v1"],
    fixture_refs: ["fixture-timeout-fallback-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "route_group", expected_group_id: "approved-analysis-routing-group" },
      { kind: "task_state", task_id: "analysis-task", expected: "completed" }
    ],
    invariant_ids: ["compatible_fallback_only", "timeout_is_not_success"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-operation-replay-v1",
    category: "operation_replay",
    title: "Replaying the same operation never creates a second external effect",
    required_for: ["manager-runtime-v1", "tool-runtime-v1"],
    fixture_refs: ["fixture-operation-replay-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "operation_effect_count", operation_id: "idempotent-operation", expected: 1 }
    ],
    invariant_ids: ["operation_id_idempotency", "reconcile_before_new_id"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-project-recovery-v1",
    category: "project_recovery",
    title: "A project restores from its checkpoint without crossing project boundaries",
    required_for: ["manager-runtime-v1", "checkpoint-runtime-v1"],
    fixture_refs: ["fixture-project-recovery-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "runtime_state", expected: "running" },
      { kind: "artifact_visibility", artifact_id: "foreign-project-checkpoint", visible: false }
    ],
    invariant_ids: ["checkpoint_project_bound", "permissions_not_restored_from_memory"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-prompt-injection-v1",
    category: "prompt_injection",
    title: "Instructions inside retrieved evidence remain data and cannot override runtime authority",
    required_for: ["manager-runtime-v1", "research-runtime-v1"],
    fixture_refs: ["fixture-prompt-injection-v1"],
    autonomy_level: "A1",
    assertions: [
      { kind: "policy_verdict", operation_id: "injected-external-operation", expected: "DENY" }
    ],
    invariant_ids: ["untrusted_instructions_are_data", "instruction_precedence_preserved"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-memory-poisoning-v1",
    category: "memory_poisoning",
    title: "Unverified claims cannot silently become trusted project memory",
    required_for: ["manager-runtime-v1", "project-memory-v1"],
    fixture_refs: ["fixture-memory-poisoning-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "artifact_visibility", artifact_id: "poisoned-memory-derived-decision", visible: false }
    ],
    invariant_ids: ["memory_provenance_required", "unverified_claims_not_trusted"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-cross-project-leak-v1",
    category: "cross_project_leak",
    title: "An agent cannot see artifacts from another project without an explicit authorized scope",
    required_for: ["manager-runtime-v1", "project-memory-v1"],
    fixture_refs: ["fixture-cross-project-leak-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "artifact_visibility", artifact_id: "other-project-secret", visible: false }
    ],
    invariant_ids: ["project_isolation", "cross_project_scope_required"]
  },
  {
    contract_version: MANAGER_RUNTIME_CONTRACT_VERSION,
    scenario_id: "runtime-false-critic-v1",
    category: "false_critic",
    title: "A false-positive warning cannot create an endless critic stop loop",
    required_for: ["manager-runtime-v1", "critic-runtime-v1"],
    fixture_refs: ["fixture-false-critic-v1"],
    autonomy_level: "A2",
    assertions: [
      { kind: "critic_pause", expected: "none" },
      { kind: "task_state", task_id: "reviewed-task", expected: "completed" }
    ],
    invariant_ids: ["critic_loop_requires_new_information", "false_positive_is_measured"]
  }
] as const satisfies readonly ManagerRuntimeScenario[];
