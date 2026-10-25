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

export interface RuntimeTaskNode {
  task_id: string;
  project_id: string;
  title: string;
  assigned_role: ManagerRuntimeRole;
  status: RuntimeTaskStatus;
  priority_weight: number;
  depends_on: string[];
  parallel_group_id?: string;
  requires_human_approval?: boolean;
  critical_action_kind?: "delete" | "prod_push" | "external_send" | null;
  blocked_by_task_id?: string | null;
  cancellation_reason?: string | null;
  input_artifact_ids: string[];
  output_artifact_ids: string[];
  expected_output_kinds: RuntimeArtifactKind[];
  iteration_count: number;
  max_iterations: number;
  timeout_ms: number;
  token_budget_limit: number;
  tokens_consumed: number;
  latency_ms?: number;
  confidence_score?: number;
  schema_contract_id?: string;
}

export interface RuntimeTaskGraph {
  contract_version: typeof MANAGER_RUNTIME_CONTRACT_VERSION;
  graph_id: string;
  project_id: string;
  root_task_id: string;
  autonomy_tier: KosmoraAutonomyTier;
  autonomy_level: AutonomyLevel;
  max_parallelism?: number;
  topological_order?: string[];
  total_token_budget: number;
  total_tokens_consumed: number;
  nodes: RuntimeTaskNode[];
  created_at: string;
  updated_at: string;
}

export interface HitlApprovalRequest {
  approval_id: string;
  graph_id: string;
  project_id: string;
  task_id: string;
  action_kind: string;
  status: "pending" | "approved" | "rejected" | "consumed";
  requested_at: string;
  resolved_by_actor_id?: string;
  resolved_by_role?: string;
  resolved_at?: string;
  approval_token?: string;
  rejection_reason?: string;
}

export interface CriticVerdictMetadata {
  verdict_id: string;
  critic_instance_id: string;
  status: "Approved" | "Needs Revision" | "Rejected";
  strictness_mode: "draft" | "standard" | "production_grade";
  score: number;
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
  content_sha256?: string;
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
  task_id: string;
  producer_role: ManagerRuntimeRole;
  producer_instance_id: string;
  kind: RuntimeArtifactKind;
  data_class: RuntimeDataClass;
  title: string;
  content: string;
  version: number;
  provenance: ArtifactProvenanceRecord;
  critic_verdict?: CriticVerdictMetadata;
  created_at: string;
}

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

export interface SquadPreset {
  preset_id: string;
  name: string;
  description: string;
  roles: ManagerRuntimeRole[];
  default_autonomy_tier: KosmoraAutonomyTier;
  critic_strictness: "draft" | "standard" | "production_grade";
}

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

export type KosmoraRole =
  | "owner"
  | "admin"
  | "operator"
  | "analyst"
  | "auditor"
  | "viewer";

export interface KosmoraCitation {
  citation_id: string;
  source_type:
    | "web_url"
    | "pdf_page"
    | "knowledge_graph_node"
    | "artifact_revision"
    | "sql_query";
  uri: string;
  title: string;
  excerpt: string;
  page_or_line?: string;
  confidence: number;
  verified_at: string;
}

export interface KosmoraDagTaskNode {
  node_id: string;
  title: string;
  agent_role:
    | "planner"
    | "researcher"
    | "coder"
    | "analyst"
    | "critic"
    | "verifier"
    | "synthesizer";
  dependencies: string[];
  estimated_tokens: number;
  estimated_cost_usd: number;
  actual_tokens: number;
  actual_cost_usd: number;
  requires_hitl: boolean;
  hitl_action_scope?: string;
  human_approved: boolean;
  approved_by?: string;
  approved_at?: string;
  approval_token_used?: string;
  status:
    | "pending"
    | "ready"
    | "running"
    | "awaiting_hitl"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "blocked";
  output_summary?: string;
  error_message?: string;
  citations: KosmoraCitation[];
}

export interface KosmoraDagPlan {
  plan_id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  goal: string;
  max_parallelism: number;
  budget_limit_usd: number;
  consumed_tokens: number;
  consumed_cost_usd: number;
  acyclic_verified: boolean;
  topological_order: string[];
  nodes: KosmoraDagTaskNode[];
  completed_delivery_ids: string[];
  created_at: string;
  updated_at: string;
}
