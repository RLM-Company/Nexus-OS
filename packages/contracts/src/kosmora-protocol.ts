/**
 * @cosmora/contracts — Stage 1: Kosmora Autonomy Core & Protocol (F001–F032)
 * Compatible with Cosmora OS Manager Runtime Contract v1
 */

export const KOSMORA_PROTOCOL_VERSION = "1.0.0" as const;
export const MANAGER_RUNTIME_CONTRACT_VERSION = 1 as const;

export type ManagerRuntimeRole =
  | "manager"
  | "architect"
  | "researcher"
  | "analyst"
  | "coder"
  | "qa"
  | "copywriter"
  | "designer"
  | "devils_advocate"
  | "critic";

export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
export type KosmoraAutonomyTier = "L1" | "L2" | "L3" | "L4" | "L5";

export type RuntimeTaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "paused_hitl"
  | "completed"
  | "failed"
  | "cancelled"
  | "rolled_back";

export type RuntimeArtifactKind =
  | "plan"
  | "architecture"
  | "evidence"
  | "analysis"
  | "code"
  | "table"
  | "presentation"
  | "decision"
  | "critic_verdict"
  | "post_mortem"
  | "handoff"
  | "checkpoint";

export type RuntimeDataClass =
  | "D0_PUBLIC"
  | "D1_PROJECT"
  | "D2_CONFIDENTIAL"
  | "D3_RESTRICTED"
  | "D4_PRIVATE_CHAT";

// F001: Kosmora Protocol Envelope
export interface KosmoraProtocolMessage<TPayload = unknown> {
  protocol_version: typeof KOSMORA_PROTOCOL_VERSION;
  message_id: string;
  correlation_id: string;
  project_id: string;
  graph_id: string;
  task_id: string;
  sender_role: ManagerRuntimeRole;
  sender_instance_id: string;
  recipient_role: ManagerRuntimeRole | "broadcast";
  timestamp: string;
  autonomy_tier: KosmoraAutonomyTier;
  autonomy_level: AutonomyLevel;
  token_budget_remaining: number;
  confidence_score?: number;
  payload: TPayload;
}

// F002, F013, F014: DAG Task Graph Node & Engine Contracts
export interface RuntimeTaskNode {
  task_id: string;
  project_id: string;
  title: string;
  assigned_role: ManagerRuntimeRole;
  status: RuntimeTaskStatus;
  priority_weight: number; // F014: Dynamic queue priority
  depends_on: string[];
  parallel_group_id?: string; // F013: Fan-out / Fan-in group
  requires_human_approval?: boolean; // F019: HITL breakpoint
  critical_action_kind?: "delete" | "prod_push" | "external_send" | null;
  input_artifact_ids: string[];
  output_artifact_ids: string[]; // F003: Runtime Artifact-to-Task Binding
  expected_output_kinds: RuntimeArtifactKind[];
  iteration_count: number; // F010: Loop detection counter
  max_iterations: number;
  timeout_ms: number; // F017: Worker watchdog timeout
  token_budget_limit: number; // F023: Per-task token budget
  tokens_consumed: number;
  latency_ms?: number; // F032: Node Latency Profiler
  confidence_score?: number; // F018: Confidence scoring
  schema_contract_id?: string; // F015: Strict JSON Schema IO
}

export interface RuntimeTaskGraph {
  contract_version: typeof MANAGER_RUNTIME_CONTRACT_VERSION;
  graph_id: string;
  project_id: string;
  root_task_id: string;
  autonomy_tier: KosmoraAutonomyTier;
  autonomy_level: AutonomyLevel;
  total_token_budget: number;
  total_tokens_consumed: number;
  nodes: RuntimeTaskNode[];
  created_at: string;
  updated_at: string;
}

// F003, F004, F005, F007: Runtime Artifact, Provenance & Critic Verdict Binding
export interface CriticVerdictMetadata {
  verdict_id: string;
  critic_instance_id: string;
  status: "Approved" | "Needs Revision" | "Rejected";
  strictness_mode: "draft" | "standard" | "production_grade"; // F030
  score: number; // 0..100
  comments: Array<{
    line_or_section?: string;
    severity: "info" | "warning" | "blocker";
    message: string;
  }>;
  reviewed_at: string;
}

export interface ArtifactProvenanceRecord {
  artifact_id: string;
  task_id: string;
  graph_id: string;
  producer_role: ManagerRuntimeRole;
  producer_instance_id: string;
  prompt_hash: string;
  prompt_template_version: string;
  model_route_id: string;
  source_artifact_ids: string[];
  source_document_chunks: Array<{
    document_id: string;
    chunk_id: string;
    line_range?: [number, number];
    cell_ref?: string;
  }>;
  created_at: string;
}

export interface RuntimeArtifact {
  artifact_id: string;
  project_id: string;
  graph_id: string;
  task_id: string; // F003: Mandatory task binding
  producer_role: ManagerRuntimeRole;
  producer_instance_id: string;
  kind: RuntimeArtifactKind;
  data_class: RuntimeDataClass;
  title: string;
  content: string;
  version: number;
  provenance: ArtifactProvenanceRecord; // F004
  critic_verdict?: CriticVerdictMetadata; // F007: Critic Verdict Binding
  created_at: string;
}

// F011, F012: Checkpointing & State Rollback
export interface GraphExecutionCheckpoint {
  checkpoint_id: string;
  graph_id: string;
  project_id: string;
  step_index: number;
  trigger_task_id: string;
  snapshot_graph: RuntimeTaskGraph;
  artifacts_snapshot: RuntimeArtifact[];
  context_summary: string;
  created_at: string;
}

// F026: Squad Presets
export interface SquadPreset {
  preset_id: string;
  name: string;
  description: string;
  roles: ManagerRuntimeRole[];
  default_autonomy_tier: KosmoraAutonomyTier;
  critic_strictness: "draft" | "standard" | "production_grade";
}

// F027: Post-Mortem Report
export interface TaskGraphPostMortem {
  report_id: string;
  graph_id: string;
  failed_task_id: string;
  failure_category:
    | "loop_detected"
    | "watchdog_timeout"
    | "schema_validation_exhausted"
    | "token_budget_exceeded"
    | "provenance_violation"
    | "hitl_rejected";
  root_cause_summary: string;
  affected_downstream_tasks: string[];
  recommended_recovery_checkpoint_id?: string;
  mitigation_steps: string[];
  generated_at: string;
}

// F031: Active Worker Registry Entry
export interface ActiveAgentWorkerRecord {
  instance_id: string;
  role: ManagerRuntimeRole;
  status: "idle" | "busy" | "degraded" | "terminated";
  current_task_id: string | null;
  active_model_id: string;
  load_pct: number;
  last_heartbeat_at: string;
  completed_tasks_count: number;
}
