/**
 * Kosmora Persistent Runtime Store (SQLite WAL + Project-Scoped Point-in-Time Recovery + Mission Control Persistence)
 * Uses built-in `node:sqlite` (Node 22.5+/24) with an automatic synchronous Python `sqlite3`
 * bridge fallback on Node 18 so every table, DDL migration, transaction, and project snapshot
 * executes against a real SQLite database engine and survives close/reopen cycles.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface StoredArtifactRevisionRecord {
  revision_id: string;
  artifact_id: string;
  project_id: string;
  tenant_id: string;
  version: number;
  title: string;
  kind: string;
  content_json: string;
  content_sha256: string;
  author_id: string;
  created_at: string;
}

export interface StoredDagPlanRecord {
  plan_id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  goal: string;
  state_json: string;
  status: "running" | "awaiting_hitl" | "completed" | "failed" | "cancelled";
  updated_at: string;
}

export interface StoredKnowledgeNodeRecord {
  node_id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  content: string;
  version: number;
  stale: number;
  node_json: string;
  updated_at: string;
}

export interface ProjectPointInTimeSnapshot {
  snapshot_id: string;
  project_id: string;
  tenant_id: string;
  created_at: string;
  artifact_revisions_count: number;
  dag_plans_count: number;
  knowledge_nodes_count: number;
  snapshot_sha256: string;
  payload_json: string;
}

export interface SchemaMigrationRecord {
  version: number;
  name: string;
  checksum_sha256: string;
  up_sql: string;
  down_sql: string;
  applied_at: string;
}

export interface StoredMissionRow {
  id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  goal: string;
  context: string;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  budget_limit: number;
  budget_spent: number;
  usage_status: string;
  final_summary: string | null;
  final_artifact_id: string | null;
  version: number;
}

export interface StoredMissionTaskRow {
  id: string;
  mission_id: string;
  project_id: string;
  tenant_id: string;
  title: string;
  instruction: string;
  assigned_agent_role: string;
  execution_mode: string;
  requested_tools_json: string;
  status: string;
  priority: number;
  dependencies_json: string;
  input_artifact_ids_json: string;
  output_artifact_ids_json: string;
  attempt_count: number;
  max_attempts: number;
  budget_limit: number;
  budget_spent: number;
  usage_status: string;
  started_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  clarification_question: string | null;
  clarification_answer: string | null;
  last_review_decision: string | null;
  last_review_comment: string | null;
  last_run_json: string | null;
  version: number;
}

export interface StoredMissionEventRow {
  id: string;
  sequence_num: number;
  mission_id: string;
  project_id: string;
  tenant_id: string;
  task_id: string | null;
  artifact_id: string | null;
  event_type: string;
  actor_id: string;
  payload_json: string;
  created_at: string;
}

export interface StoredMissionArtifactRow {
  id: string;
  mission_id: string;
  task_id: string | null;
  project_id: string;
  tenant_id: string;
  kind: string;
  title: string;
  content: string;
  preview: string;
  version: number;
  is_final: number;
  metadata_json: string;
  created_by_role: string;
  created_at: string;
}

export interface StoredMissionBudgetLedgerRow {
  id: string;
  mission_id: string;
  task_id: string | null;
  project_id: string;
  tenant_id: string;
  run_id: string;
  agent_role: string;
  amount_spent: number | null;
  usage_status: string;
  provider_id: string;
  description: string;
  created_at: string;
}

export const MISSION_CONTROL_DDL_UP_SQL = `
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    workspace_id TEXT NOT NULL DEFAULT 'ws_default',
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    budget_limit REAL NOT NULL DEFAULT 0,
    budget_spent REAL NOT NULL DEFAULT 0,
    usage_status TEXT NOT NULL DEFAULT 'usage_tracked',
    final_summary TEXT,
    final_artifact_id TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_missions_tenant_project_owner
    ON missions(tenant_id, project_id, owner_id, status, priority DESC, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_missions_active_status
    ON missions(status, priority DESC, updated_at DESC);

  CREATE TABLE IF NOT EXISTS mission_tasks (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    assigned_agent_role TEXT NOT NULL,
    execution_mode TEXT NOT NULL DEFAULT 'auto',
    requested_tools_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    output_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    budget_limit REAL NOT NULL DEFAULT 0,
    budget_spent REAL NOT NULL DEFAULT 0,
    usage_status TEXT NOT NULL DEFAULT 'usage_tracked',
    started_at TEXT,
    completed_at TEXT,
    failure_reason TEXT,
    clarification_question TEXT,
    clarification_answer TEXT,
    last_review_decision TEXT,
    last_review_comment TEXT,
    last_run_json TEXT,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_mission_tasks_mission_active
    ON mission_tasks(mission_id, status, priority DESC);

  CREATE INDEX IF NOT EXISTS idx_mission_tasks_tenant_project
    ON mission_tasks(tenant_id, project_id, mission_id);

  CREATE TABLE IF NOT EXISTS mission_events (
    id TEXT PRIMARY KEY,
    sequence_num INTEGER NOT NULL,
    mission_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    task_id TEXT,
    artifact_id TEXT,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mission_events_mission_seq
    ON mission_events(mission_id, sequence_num ASC, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_mission_events_tenant_project
    ON mission_events(tenant_id, project_id, mission_id, event_type);

  CREATE TABLE IF NOT EXISTS mission_artifacts (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    task_id TEXT,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    preview TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_final INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by_role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mission_artifacts_mission_task
    ON mission_artifacts(mission_id, task_id, is_final DESC, version DESC);

  CREATE TABLE IF NOT EXISTS mission_budget_ledger (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    task_id TEXT,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    run_id TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    amount_spent REAL,
    usage_status TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mission_budget_ledger_mission
    ON mission_budget_ledger(mission_id, created_at ASC);
`;

export const MISSION_CONTROL_DDL_DOWN_SQL = `
  DROP TABLE IF EXISTS mission_budget_ledger;
  DROP TABLE IF EXISTS mission_artifacts;
  DROP TABLE IF EXISTS mission_events;
  DROP TABLE IF EXISTS mission_tasks;
  DROP TABLE IF EXISTS missions;
`;

export interface StoredPlaybookRow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags_json: string;
  visibility: string;
  status: string;
  current_version: number;
  draft_definition_json: string;
  draft_version_lock: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StoredPlaybookVersionRow {
  id: string;
  playbook_id: string;
  version_number: number;
  changelog: string;
  definition_json: string;
  created_by: string;
  created_at: string;
  checksum_sha256: string;
  is_published: number;
}

export interface StoredPlaybookInstantiationRow {
  id: string;
  playbook_id: string;
  playbook_version_id: string;
  resulting_mission_id: string;
  owner_id: string;
  tenant_id: string;
  project_id: string;
  resolved_variables_json: string;
  initiated_at: string;
  created_at: string;
}

export interface StoredPlaybookAuditEventRow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  playbook_id: string;
  playbook_version_id: string | null;
  resulting_mission_id: string | null;
  actor_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export const PLAYBOOKS_DDL_UP_SQL = `
  CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Общие',
    tags_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'private',
    status TEXT NOT NULL DEFAULT 'draft',
    current_version INTEGER NOT NULL DEFAULT 0,
    draft_definition_json TEXT NOT NULL,
    draft_version_lock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_playbooks_tenant_project_owner_status
    ON playbooks(tenant_id, project_id, owner_id, status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_playbooks_category_visibility
    ON playbooks(category, visibility, status, updated_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbooks_slug_scope
    ON playbooks(tenant_id, COALESCE(project_id, '__global__'), slug);

  CREATE TABLE IF NOT EXISTS playbook_versions (
    id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    changelog TEXT NOT NULL DEFAULT '',
    definition_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    is_published INTEGER NOT NULL DEFAULT 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_versions_playbook_version
    ON playbook_versions(playbook_id, version_number);

  CREATE INDEX IF NOT EXISTS idx_playbook_versions_lookup
    ON playbook_versions(playbook_id, is_published, version_number DESC);

  CREATE TABLE IF NOT EXISTS playbook_instantiations (
    id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL,
    playbook_version_id TEXT NOT NULL,
    resulting_mission_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    resolved_variables_json TEXT NOT NULL DEFAULT '{}',
    initiated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_instantiations_mission
    ON playbook_instantiations(resulting_mission_id);

  CREATE INDEX IF NOT EXISTS idx_playbook_instantiations_playbook_version
    ON playbook_instantiations(playbook_id, playbook_version_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_playbook_instantiations_tenant_project
    ON playbook_instantiations(tenant_id, project_id, owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS playbook_audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    playbook_id TEXT NOT NULL,
    playbook_version_id TEXT,
    resulting_mission_id TEXT,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_playbook_audit_events_playbook
    ON playbook_audit_events(playbook_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_playbook_audit_events_tenant_project
    ON playbook_audit_events(tenant_id, project_id, event_type, created_at DESC);
`;

export const PLAYBOOKS_DDL_DOWN_SQL = `
  DROP TABLE IF EXISTS playbook_audit_events;
  DROP TABLE IF EXISTS playbook_instantiations;
  DROP TABLE IF EXISTS playbook_versions;
  DROP TABLE IF EXISTS playbooks;
`;

export interface StoredPlaybookScheduleRow {
  id: string;
  tenant_id: string;
  project_id: string;
  owner_id: string;
  playbook_id: string;
  playbook_version_number: number | null;
  title: string;
  description: string;
  trigger_type: string;
  cron_expression: string | null;
  interval_minutes: number | null;
  one_time_run_at: string | null;
  timezone: string;
  event_topic: string | null;
  event_filter_json: string;
  webhook_secret_sha256: string | null;
  webhook_signing_secret_preview: string | null;
  default_variables_json: string;
  variable_mappings_json: string;
  auto_start_mission: number;
  mission_priority: string;
  mission_title_override: string | null;
  max_runs_per_day: number;
  runs_today_count: number;
  max_concurrent_missions: number;
  daily_budget_limit: number;
  daily_budget_spent: number;
  consecutive_failures_limit: number;
  consecutive_failures_count: number;
  deduplication_window_seconds: number;
  status: string;
  disabled_reason: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StoredScheduleRunRow {
  id: string;
  schedule_id: string;
  tenant_id: string;
  project_id: string;
  playbook_id: string;
  playbook_version_id: string | null;
  playbook_instantiation_id: string | null;
  resulting_mission_id: string | null;
  trigger_source: string;
  idempotency_key: string;
  status: string;
  resolved_variables_json: string;
  failure_reason: string | null;
  estimated_budget: number;
  initiated_by: string;
  initiated_at: string;
  completed_at: string;
}

export interface StoredScheduleAuditEventRow {
  id: string;
  schedule_id: string;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: string;
  details_json: string;
  created_at: string;
}

export const SCHEDULES_DDL_UP_SQL = `
  CREATE TABLE IF NOT EXISTS playbook_schedules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    playbook_version_number INTEGER,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger_type TEXT NOT NULL,
    cron_expression TEXT,
    interval_minutes INTEGER,
    one_time_run_at TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    event_topic TEXT,
    event_filter_json TEXT NOT NULL DEFAULT '{}',
    webhook_secret_sha256 TEXT,
    webhook_signing_secret_preview TEXT,
    default_variables_json TEXT NOT NULL DEFAULT '{}',
    variable_mappings_json TEXT NOT NULL DEFAULT '[]',
    auto_start_mission INTEGER NOT NULL DEFAULT 1,
    mission_priority TEXT NOT NULL DEFAULT 'medium',
    mission_title_override TEXT,
    max_runs_per_day INTEGER NOT NULL DEFAULT 24,
    runs_today_count INTEGER NOT NULL DEFAULT 0,
    max_concurrent_missions INTEGER NOT NULL DEFAULT 3,
    daily_budget_limit REAL NOT NULL DEFAULT 100,
    daily_budget_spent REAL NOT NULL DEFAULT 0,
    consecutive_failures_limit INTEGER NOT NULL DEFAULT 3,
    consecutive_failures_count INTEGER NOT NULL DEFAULT 0,
    deduplication_window_seconds INTEGER NOT NULL DEFAULT 300,
    status TEXT NOT NULL DEFAULT 'active',
    disabled_reason TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_playbook_schedules_tenant_project_status
    ON playbook_schedules(tenant_id, project_id, status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_playbook_schedules_due_tick
    ON playbook_schedules(status, trigger_type, next_run_at ASC);

  CREATE INDEX IF NOT EXISTS idx_playbook_schedules_event_topic
    ON playbook_schedules(tenant_id, project_id, status, trigger_type, event_topic);

  CREATE INDEX IF NOT EXISTS idx_playbook_schedules_playbook
    ON playbook_schedules(playbook_id, status);

  CREATE TABLE IF NOT EXISTS schedule_runs (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    playbook_version_id TEXT,
    playbook_instantiation_id TEXT,
    resulting_mission_id TEXT,
    trigger_source TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL,
    resolved_variables_json TEXT NOT NULL DEFAULT '{}',
    failure_reason TEXT,
    estimated_budget REAL NOT NULL DEFAULT 0,
    initiated_by TEXT NOT NULL,
    initiated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_time
    ON schedule_runs(schedule_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_schedule_runs_dedup
    ON schedule_runs(schedule_id, idempotency_key, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_schedule_runs_mission
    ON schedule_runs(resulting_mission_id);

  CREATE TABLE IF NOT EXISTS schedule_audit_events (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_schedule_audit_events_schedule
    ON schedule_audit_events(schedule_id, created_at ASC);
`;

export const SCHEDULES_DDL_DOWN_SQL = `
  DROP TABLE IF EXISTS schedule_audit_events;
  DROP TABLE IF EXISTS schedule_runs;
  DROP TABLE IF EXISTS playbook_schedules;
`;

export interface StoredEvaluationSuiteRow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  target_kind: string;
  visibility: string;
  status: string;
  passing_score_threshold: number;
  block_on_critical_criteria: number;
  criteria_json: string;
  golden_test_cases_json: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StoredEvaluationRunRow {
  id: string;
  suite_id: string;
  suite_version: number;
  tenant_id: string;
  project_id: string;
  target_kind: string;
  mission_id: string | null;
  playbook_id: string | null;
  playbook_version_id: string | null;
  playbook_version_number: number | null;
  baseline_run_id: string | null;
  overall_score: number;
  passing_score_threshold: number;
  verdict: string;
  critical_failures_count: number;
  criteria_results_json: string;
  test_case_results_json: string;
  score_delta: number | null;
  regression_detected: number;
  regression_summary: string | null;
  total_budget_spent: number;
  initiated_by: string;
  initiated_at: string;
  completed_at: string;
}

export interface StoredQualityGatePolicyRow {
  id: string;
  tenant_id: string;
  project_id: string;
  playbook_id: string;
  required_suite_ids_json: string;
  min_overall_score: number;
  allow_critical_failures: number;
  max_regression_drop: number;
  enforce_on_publish: number;
  enforce_on_schedule_activation: number;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StoredEvaluationAuditEventRow {
  id: string;
  suite_id: string;
  run_id: string | null;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: string;
  details_json: string;
  created_at: string;
}

export const EVALUATIONS_DDL_UP_SQL = `
  CREATE TABLE IF NOT EXISTS evaluation_suites (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_kind TEXT NOT NULL DEFAULT 'both',
    visibility TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'active',
    passing_score_threshold REAL NOT NULL DEFAULT 80,
    block_on_critical_criteria INTEGER NOT NULL DEFAULT 1,
    criteria_json TEXT NOT NULL DEFAULT '[]',
    golden_test_cases_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluation_suites_tenant_proj_slug
    ON evaluation_suites(tenant_id, COALESCE(project_id, '__global__'), slug);

  CREATE INDEX IF NOT EXISTS idx_evaluation_suites_lookup
    ON evaluation_suites(tenant_id, project_id, status, visibility, updated_at DESC);

  CREATE TABLE IF NOT EXISTS evaluation_runs (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    suite_version INTEGER NOT NULL DEFAULT 1,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    mission_id TEXT,
    playbook_id TEXT,
    playbook_version_id TEXT,
    playbook_version_number INTEGER,
    baseline_run_id TEXT,
    overall_score REAL NOT NULL DEFAULT 0,
    passing_score_threshold REAL NOT NULL DEFAULT 80,
    verdict TEXT NOT NULL,
    critical_failures_count INTEGER NOT NULL DEFAULT 0,
    criteria_results_json TEXT NOT NULL DEFAULT '[]',
    test_case_results_json TEXT NOT NULL DEFAULT '[]',
    score_delta REAL,
    regression_detected INTEGER NOT NULL DEFAULT 0,
    regression_summary TEXT,
    total_budget_spent REAL NOT NULL DEFAULT 0,
    initiated_by TEXT NOT NULL,
    initiated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_suite
    ON evaluation_runs(suite_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_mission
    ON evaluation_runs(mission_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_playbook_version
    ON evaluation_runs(playbook_id, playbook_version_number, verdict, initiated_at DESC);

  CREATE TABLE IF NOT EXISTS quality_gate_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    playbook_id TEXT NOT NULL,
    required_suite_ids_json TEXT NOT NULL DEFAULT '[]',
    min_overall_score REAL NOT NULL DEFAULT 80,
    allow_critical_failures INTEGER NOT NULL DEFAULT 0,
    max_regression_drop REAL NOT NULL DEFAULT 5,
    enforce_on_publish INTEGER NOT NULL DEFAULT 1,
    enforce_on_schedule_activation INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_gate_policies_playbook
    ON quality_gate_policies(tenant_id, project_id, playbook_id);

  CREATE TABLE IF NOT EXISTS evaluation_audit_events (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    run_id TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_evaluation_audit_events_suite
    ON evaluation_audit_events(suite_id, created_at ASC);
`;

export const EVALUATIONS_DDL_DOWN_SQL = `
  DROP TABLE IF EXISTS evaluation_audit_events;
  DROP TABLE IF EXISTS quality_gate_policies;
  DROP TABLE IF EXISTS evaluation_runs;
  DROP TABLE IF EXISTS evaluation_suites;
`;

export interface StoredKnowledgeCollectionRow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  visibility: string;
  status: string;
  chunking_strategy: string;
  chunk_size_chars: number;
  chunk_overlap_chars: number;
  redact_secrets_on_ingest: number;
  document_count: number;
  chunk_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StoredKnowledgeDocumentRow {
  id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  source_type: string;
  source_uri: string;
  raw_content_preview: string;
  sanitized_content: string;
  content_sha256: string;
  byte_size: number;
  tags_json: string;
  redacted_secrets_count: number;
  quarantine_reason: string | null;
  chunk_count: number;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface StoredKnowledgeChunkRow {
  id: string;
  document_id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  chunk_index: number;
  section_heading: string;
  content: string;
  token_estimate: number;
  keywords_json: string;
  chunk_sha256: string;
  created_at: string;
}

export interface StoredMissionKnowledgeBindingRow {
  id: string;
  mission_id: string;
  collection_id: string;
  tenant_id: string;
  project_id: string;
  top_k: number;
  min_relevance_score: number;
  mandatory_citation: number;
  created_by: string;
  created_at: string;
}

export interface StoredKnowledgeCitationRow {
  id: string;
  mission_id: string;
  task_id: string | null;
  artifact_id: string;
  collection_id: string;
  document_id: string;
  chunk_id: string;
  citation_anchor: string;
  quote_snippet: string;
  relevance_score: number;
  verified: number;
  created_at: string;
}

export interface StoredKnowledgeVaultAuditEventRow {
  id: string;
  collection_id: string;
  document_id: string | null;
  mission_id: string | null;
  tenant_id: string;
  project_id: string;
  actor_id: string;
  event_type: string;
  details_json: string;
  created_at: string;
}

export const KNOWLEDGE_VAULT_DDL_UP_SQL = `
  CREATE TABLE IF NOT EXISTS knowledge_collections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    visibility TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'active',
    chunking_strategy TEXT NOT NULL DEFAULT 'markdown_sections',
    chunk_size_chars INTEGER NOT NULL DEFAULT 600,
    chunk_overlap_chars INTEGER NOT NULL DEFAULT 80,
    redact_secrets_on_ingest INTEGER NOT NULL DEFAULT 1,
    document_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_collections_tenant_proj_slug
    ON knowledge_collections(tenant_id, COALESCE(project_id, '__global__'), slug);

  CREATE INDEX IF NOT EXISTS idx_knowledge_collections_lookup
    ON knowledge_collections(tenant_id, project_id, status, visibility, updated_at DESC);

  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'markdown',
    source_uri TEXT NOT NULL DEFAULT '',
    raw_content_preview TEXT NOT NULL DEFAULT '',
    sanitized_content TEXT NOT NULL DEFAULT '',
    content_sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    redacted_secrets_count INTEGER NOT NULL DEFAULT 0,
    quarantine_reason TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'indexed',
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_collection
    ON knowledge_documents(collection_id, status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_project
    ON knowledge_documents(tenant_id, project_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    section_heading TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    chunk_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_collection
    ON knowledge_chunks(collection_id, document_id, chunk_index ASC);

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project
    ON knowledge_chunks(tenant_id, project_id, collection_id);

  CREATE TABLE IF NOT EXISTS mission_knowledge_bindings (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    top_k INTEGER NOT NULL DEFAULT 5,
    min_relevance_score REAL NOT NULL DEFAULT 0.1,
    mandatory_citation INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_knowledge_bindings_unique
    ON mission_knowledge_bindings(mission_id, collection_id);

  CREATE INDEX IF NOT EXISTS idx_mission_knowledge_bindings_mission
    ON mission_knowledge_bindings(mission_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS knowledge_citations (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    task_id TEXT,
    artifact_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    citation_anchor TEXT NOT NULL,
    quote_snippet TEXT NOT NULL DEFAULT '',
    relevance_score REAL NOT NULL DEFAULT 1,
    verified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_citations_mission_artifact
    ON knowledge_citations(mission_id, artifact_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS knowledge_vault_audit_events (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL,
    document_id TEXT,
    mission_id TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_vault_audit_events_collection
    ON knowledge_vault_audit_events(collection_id, created_at ASC);
`;

export const KNOWLEDGE_VAULT_DDL_DOWN_SQL = `
  DROP TABLE IF EXISTS knowledge_vault_audit_events;
  DROP TABLE IF EXISTS knowledge_citations;
  DROP TABLE IF EXISTS mission_knowledge_bindings;
  DROP TABLE IF EXISTS knowledge_chunks;
  DROP TABLE IF EXISTS knowledge_documents;
  DROP TABLE IF EXISTS knowledge_collections;
`;




interface SqliteStatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

const PYTHON_SQLITE_DRIVER = `
import json, sqlite3, sys

req = json.loads(sys.stdin.read())
db_path = req["dbPath"]
mode = req["mode"]
sql = req["sql"]
params = req.get("params", [])

conn = sqlite3.connect(db_path, timeout=30.0)
conn.row_factory = sqlite3.Row
try:
    if mode == "exec":
        conn.executescript(sql)
        conn.commit()
        print(json.dumps({"ok": True}))
    elif mode == "run":
        cur = conn.execute(sql, params)
        conn.commit()
        print(json.dumps({"ok": True, "changes": cur.rowcount, "lastInsertRowid": cur.lastrowid}))
    elif mode == "get":
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        conn.commit()
        print(json.dumps({"ok": True, "row": dict(row) if row is not None else None}))
    elif mode == "all":
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
        print(json.dumps({"ok": True, "rows": rows}))
    else:
        raise ValueError("Unsupported mode: " + str(mode))
except Exception as exc:
    conn.rollback()
    print(json.dumps({"ok": False, "error": str(exc)}))
    sys.exit(1)
finally:
    conn.close()
`;

class PythonSqliteFallbackDatabase implements SqliteDatabaseLike {
  private closed = false;

  constructor(private readonly filePath: string) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("SQLite database connection is closed");
    }
  }

  private invoke(
    mode: "exec" | "run" | "get" | "all",
    sql: string,
    params: unknown[] = []
  ): Record<string, unknown> {
    this.ensureOpen();
    const normalizedParams = params.map((p) => (p === undefined ? null : p));
    const proc = spawnSync("python3", ["-c", PYTHON_SQLITE_DRIVER], {
      input: JSON.stringify({
        dbPath: this.filePath,
        mode,
        sql,
        params: normalizedParams
      }),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });

    if (proc.status !== 0) {
      let errMessage = proc.stderr || proc.stdout || "SQLite execution failed";
      try {
        const parsed = JSON.parse(proc.stdout) as { error?: string };
        if (parsed.error) errMessage = parsed.error;
      } catch {
        // use raw stderr/stdout
      }
      throw new Error(`SQLite error: ${errMessage.trim()}`);
    }

    return JSON.parse(proc.stdout) as Record<string, unknown>;
  }

  public exec(sql: string): void {
    this.invoke("exec", sql);
  }

  public prepare(sql: string): SqliteStatementLike {
    return {
      run: (...params: unknown[]) => this.invoke("run", sql, params),
      get: (...params: unknown[]) => this.invoke("get", sql, params).row ?? undefined,
      all: (...params: unknown[]) => (this.invoke("all", sql, params).rows as unknown[]) ?? []
    };
  }

  public close(): void {
    this.closed = true;
  }
}

function openSqliteDatabase(resolvedPath: string): SqliteDatabaseLike {
  try {
    const req = createRequire(import.meta.url);
    const sqliteMod = req("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabaseLike;
    };
    if (sqliteMod && typeof sqliteMod.DatabaseSync === "function") {
      return new sqliteMod.DatabaseSync(resolvedPath);
    }
  } catch {
    // Fallback to Python sqlite3 bridge on Node < 22.5
  }
  return new PythonSqliteFallbackDatabase(resolvedPath);
}

const BASE_MIGRATIONS: Array<{
  version: number;
  name: string;
  upSql: string;
  downSql: string;
}> = [
  {
    version: 1,
    name: "001_initial_kosmora_runtime_tables",
    upSql: `
      CREATE TABLE IF NOT EXISTS kosmora_artifact_revisions (
        revision_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'proj_default',
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_artifact_proj_ver
        ON kosmora_artifact_revisions(project_id, artifact_id, version DESC);

      CREATE TABLE IF NOT EXISTS kosmora_dag_plans (
        plan_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'ws_default',
        goal TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_dag_project
        ON kosmora_dag_plans(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS kosmora_project_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        created_at TEXT NOT NULL,
        artifact_revisions_count INTEGER NOT NULL,
        dag_plans_count INTEGER NOT NULL,
        knowledge_nodes_count INTEGER NOT NULL DEFAULT 0,
        snapshot_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `,
    downSql: `
      DROP TABLE IF EXISTS kosmora_project_snapshots;
      DROP TABLE IF EXISTS kosmora_dag_plans;
      DROP TABLE IF EXISTS kosmora_artifact_revisions;
    `
  },
  {
    version: 2,
    name: "002_knowledge_nodes_and_audit_persistence",
    upSql: `
      CREATE TABLE IF NOT EXISTS kosmora_knowledge_nodes (
        node_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        workspace_id TEXT NOT NULL DEFAULT 'ws_default',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        stale INTEGER NOT NULL DEFAULT 0,
        node_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_nodes_project
        ON kosmora_knowledge_nodes(project_id, stale);
    `,
    downSql: `
      DROP TABLE IF EXISTS kosmora_knowledge_nodes;
    `
  }
];

export class KosmoraRuntimeStore {
  private db: SqliteDatabaseLike;
  private readonly physicalPath: string;
  private readonly isEphemeralMemoryFile: boolean;
  private isClosed = false;
  private missionControlSchemaApplied = false;
  private playbooksSchemaApplied = false;
  private schedulesSchemaApplied = false;
  private evaluationsSchemaApplied = false;
  private knowledgeVaultSchemaApplied = false;

  constructor(dbPath = ":memory:") {
    if (dbPath === ":memory:") {
      const tempDir = resolve(tmpdir(), "kosmora-sqlite-mem");
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      this.physicalPath = resolve(tempDir, `kosmora_${randomUUID()}.db`);
      this.isEphemeralMemoryFile = true;
    } else {
      this.physicalPath = resolve(dbPath);
      const parentDir = dirname(this.physicalPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      this.isEphemeralMemoryFile = false;
    }

    this.db = openSqliteDatabase(this.physicalPath);
    this.initializeSchema();
  }

  public getDatabasePath(): string {
    return this.physicalPath;
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS kosmora_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        up_sql TEXT NOT NULL,
        down_sql TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const mig of BASE_MIGRATIONS) {
      this.applyMigration(mig.version, mig.name, mig.upSql, mig.downSql);
    }
  }

  /**
   * Applies Migration 004 for Kosmora Mission Control tables (`missions`, `mission_tasks`,
   * `mission_events`, `mission_artifacts`, `mission_budget_ledger`) and their indexes.
   */
  public ensureMissionControlSchema(): SchemaMigrationRecord {
    const record = this.applyMigration(
      4,
      "004_kosmora_mission_control_tables",
      MISSION_CONTROL_DDL_UP_SQL,
      MISSION_CONTROL_DDL_DOWN_SQL
    );
    this.missionControlSchemaApplied = true;
    return record;
  }

  private ensureMissionTablesReady(): void {
    if (!this.missionControlSchemaApplied) {
      this.ensureMissionControlSchema();
    }
  }

  /**
   * Applies Migration 005 for Kosmora Playbooks tables (`playbooks`, `playbook_versions`,
   * `playbook_instantiations`, `playbook_audit_events`) and their indexes.
   */
  public ensurePlaybooksSchema(): SchemaMigrationRecord {
    this.ensureMissionTablesReady();
    const record = this.applyMigration(
      5,
      "005_kosmora_playbooks_tables",
      PLAYBOOKS_DDL_UP_SQL,
      PLAYBOOKS_DDL_DOWN_SQL
    );
    this.playbooksSchemaApplied = true;
    return record;
  }

  private ensurePlaybooksTablesReady(): void {
    if (!this.playbooksSchemaApplied) {
      this.ensurePlaybooksSchema();
    }
  }

  /**
   * Applies Migration 006 for Kosmora Schedules & Triggers tables
   * (`playbook_schedules`, `schedule_runs`, `schedule_audit_events`).
   */
  public ensureSchedulesSchema(): SchemaMigrationRecord {
    this.ensurePlaybooksTablesReady();
    const record = this.applyMigration(
      6,
      "006_kosmora_schedules_tables",
      SCHEDULES_DDL_UP_SQL,
      SCHEDULES_DDL_DOWN_SQL
    );
    this.schedulesSchemaApplied = true;
    return record;
  }


  private ensureSchedulesTablesReady(): void {
    if (!this.schedulesSchemaApplied) {
      this.ensureSchedulesSchema();
    }
  }

  /**
   * Applies Migration 007 for Kosmora Evaluations & Quality Gates tables
   * (`evaluation_suites`, `evaluation_runs`, `quality_gate_policies`, `evaluation_audit_events`).
   */
  public ensureEvaluationsSchema(): SchemaMigrationRecord {
    this.ensureSchedulesTablesReady();
    const record = this.applyMigration(
      7,
      "007_kosmora_evaluations_tables",
      EVALUATIONS_DDL_UP_SQL,
      EVALUATIONS_DDL_DOWN_SQL
    );
    this.evaluationsSchemaApplied = true;
    return record;
  }

  private ensureEvaluationsTablesReady(): void {
    if (!this.evaluationsSchemaApplied) {
      this.ensureEvaluationsSchema();
    }
  }

  /**
   * Applies Migration 008 for Kosmora Knowledge Vault & Context Connectors tables
   * (`knowledge_collections`, `knowledge_documents`, `knowledge_chunks`,
   * `mission_knowledge_bindings`, `knowledge_citations`, `knowledge_vault_audit_events`).
   */
  public ensureKnowledgeVaultSchema(): SchemaMigrationRecord {
    this.ensureEvaluationsTablesReady();
    const record = this.applyMigration(
      8,
      "008_kosmora_knowledge_vault_tables",
      KNOWLEDGE_VAULT_DDL_UP_SQL,
      KNOWLEDGE_VAULT_DDL_DOWN_SQL
    );
    this.knowledgeVaultSchemaApplied = true;
    return record;
  }

  private ensureKnowledgeVaultTablesReady(): void {
    if (!this.knowledgeVaultSchemaApplied) {
      this.ensureKnowledgeVaultSchema();
    }
  }

  /**
   * F139: Real DDL schema migration execution with checksum verification & rollback support.
   */
  public applyMigration(
    version: number,
    name: string,
    upSql: string,
    downSql = ""
  ): SchemaMigrationRecord {
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error("Migration version must be a positive integer");
    }
    const checksum = createHash("sha256").update(upSql.trim()).digest("hex");
    const existing = this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations WHERE version = ?`
      )
      .get(version) as SchemaMigrationRecord | undefined;

    if (existing) {
      if (existing.checksum_sha256 !== checksum) {
        throw new Error(
          `Migration v${version} ('${name}') checksum mismatch: expected ${existing.checksum_sha256}, got ${checksum}`
        );
      }
      return existing;
    }

    this.db.exec(upSql);
    const appliedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO kosmora_schema_migrations (version, name, checksum_sha256, up_sql, down_sql, applied_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(version, name, checksum, upSql, downSql, appliedAt);

    return {
      version,
      name,
      checksum_sha256: checksum,
      up_sql: upSql,
      down_sql: downSql,
      applied_at: appliedAt
    };
  }

  public rollbackMigration(version: number): boolean {
    const existing = this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations WHERE version = ?`
      )
      .get(version) as SchemaMigrationRecord | undefined;

    if (!existing) {
      return false;
    }
    if (!existing.down_sql || existing.down_sql.trim().length === 0) {
      throw new Error(`Migration v${version} ('${existing.name}') has no down_sql for rollback`);
    }

    this.db.exec(existing.down_sql);
    this.db
      .prepare(`DELETE FROM kosmora_schema_migrations WHERE version = ?`)
      .run(version);
    if (version === 4) {
      this.missionControlSchemaApplied = false;
    }
    if (version === 5) {
      this.playbooksSchemaApplied = false;
    }
    if (version === 6) {
      this.schedulesSchemaApplied = false;
    }
    if (version === 7) {
      this.evaluationsSchemaApplied = false;
    }
    if (version === 8) {
      this.knowledgeVaultSchemaApplied = false;
    }
    return true;
  }

  public listAppliedMigrations(): SchemaMigrationRecord[] {
    return this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations ORDER BY version ASC`
      )
      .all() as SchemaMigrationRecord[];
  }

  public inspectTableColumns(tableName: string): Array<{ name: string; type: string; notnull: number }> {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid SQLite table identifier: ${tableName}`);
    }
    return this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
  }

  public inspectTableIndexes(tableName: string): Array<{ name: string; unique: number }> {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid SQLite table identifier: ${tableName}`);
    }
    return this.db
      .prepare(`PRAGMA index_list(${tableName})`)
      .all() as Array<{ name: string; unique: number }>;
  }

  // ============================================================================
  // MISSION CONTROL SQLITE PERSISTENCE METHODS
  // ============================================================================

  public insertMissionRow(row: StoredMissionRow): void {
    this.ensureMissionTablesReady();
    this.db
      .prepare(
        `INSERT INTO missions (
          id, project_id, tenant_id, workspace_id, owner_id, title, goal, context,
          status, priority, created_at, updated_at, started_at, completed_at,
          budget_limit, budget_spent, usage_status, final_summary, final_artifact_id, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.project_id,
        row.tenant_id,
        row.workspace_id,
        row.owner_id,
        row.title,
        row.goal,
        row.context,
        row.status,
        row.priority,
        row.created_at,
        row.updated_at,
        row.started_at,
        row.completed_at,
        row.budget_limit,
        row.budget_spent,
        row.usage_status,
        row.final_summary,
        row.final_artifact_id,
        row.version
      );
  }

  public updateMissionRowOptimistic(
    row: StoredMissionRow,
    expectedVersion: number
  ): boolean {
    this.ensureMissionTablesReady();
    const current = this.getMissionRowById(row.id);
    if (!current || Number(current.version) !== Number(expectedVersion)) {
      return false;
    }
    this.db
      .prepare(
        `UPDATE missions SET
          title = ?,
          goal = ?,
          context = ?,
          status = ?,
          priority = ?,
          updated_at = ?,
          started_at = ?,
          completed_at = ?,
          budget_limit = ?,
          budget_spent = ?,
          usage_status = ?,
          final_summary = ?,
          final_artifact_id = ?,
          version = ?
        WHERE id = ? AND version = ?`
      )
      .run(
        row.title,
        row.goal,
        row.context,
        row.status,
        row.priority,
        row.updated_at,
        row.started_at,
        row.completed_at,
        row.budget_limit,
        row.budget_spent,
        row.usage_status,
        row.final_summary,
        row.final_artifact_id,
        row.version,
        row.id,
        expectedVersion
      );
    return true;
  }

  public getMissionRowById(missionId: string): StoredMissionRow | undefined {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, project_id, tenant_id, workspace_id, owner_id, title, goal, context,
                status, priority, created_at, updated_at, started_at, completed_at,
                budget_limit, budget_spent, usage_status, final_summary, final_artifact_id, version
         FROM missions WHERE id = ?`
      )
      .get(missionId) as StoredMissionRow | undefined;
  }

  public listMissionRows(filters: {
    tenant_id: string;
    project_id?: string;
    owner_id?: string;
    status?: string;
  }): StoredMissionRow[] {
    this.ensureMissionTablesReady();
    const clauses: string[] = ["tenant_id = ?"];
    const params: unknown[] = [filters.tenant_id];

    if (filters.project_id) {
      clauses.push("project_id = ?");
      params.push(filters.project_id);
    }
    if (filters.owner_id) {
      clauses.push("owner_id = ?");
      params.push(filters.owner_id);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    const sql = `
      SELECT id, project_id, tenant_id, workspace_id, owner_id, title, goal, context,
             status, priority, created_at, updated_at, started_at, completed_at,
             budget_limit, budget_spent, usage_status, final_summary, final_artifact_id, version
      FROM missions
      WHERE ${clauses.join(" AND ")}
      ORDER BY priority DESC, updated_at DESC, created_at DESC
    `;
    return this.db.prepare(sql).all(...params) as unknown as StoredMissionRow[];
  }

  public listAllUnfinishedMissionRows(): StoredMissionRow[] {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, project_id, tenant_id, workspace_id, owner_id, title, goal, context,
                status, priority, created_at, updated_at, started_at, completed_at,
                budget_limit, budget_spent, usage_status, final_summary, final_artifact_id, version
         FROM missions
         WHERE status IN ('running', 'waiting_for_review', 'ready')
         ORDER BY priority DESC, updated_at ASC`
      )
      .all() as unknown as StoredMissionRow[];
  }

  public insertMissionTaskRow(row: StoredMissionTaskRow): void {
    this.ensureMissionTablesReady();
    this.db
      .prepare(
        `INSERT INTO mission_tasks (
          id, mission_id, project_id, tenant_id, title, instruction, assigned_agent_role,
          execution_mode, requested_tools_json, status, priority, dependencies_json,
          input_artifact_ids_json, output_artifact_ids_json, attempt_count, max_attempts,
          budget_limit, budget_spent, usage_status, started_at, completed_at, failure_reason,
          clarification_question, clarification_answer, last_review_decision, last_review_comment,
          last_run_json, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.mission_id,
        row.project_id,
        row.tenant_id,
        row.title,
        row.instruction,
        row.assigned_agent_role,
        row.execution_mode,
        row.requested_tools_json,
        row.status,
        row.priority,
        row.dependencies_json,
        row.input_artifact_ids_json,
        row.output_artifact_ids_json,
        row.attempt_count,
        row.max_attempts,
        row.budget_limit,
        row.budget_spent,
        row.usage_status,
        row.started_at,
        row.completed_at,
        row.failure_reason,
        row.clarification_question,
        row.clarification_answer,
        row.last_review_decision,
        row.last_review_comment,
        row.last_run_json,
        row.version
      );
  }

  public updateMissionTaskRowOptimistic(
    row: StoredMissionTaskRow,
    expectedVersion: number
  ): boolean {
    this.ensureMissionTablesReady();
    const current = this.getMissionTaskRowById(row.id);
    if (!current || Number(current.version) !== Number(expectedVersion)) {
      return false;
    }
    this.db
      .prepare(
        `UPDATE mission_tasks SET
          title = ?,
          instruction = ?,
          assigned_agent_role = ?,
          execution_mode = ?,
          requested_tools_json = ?,
          status = ?,
          priority = ?,
          dependencies_json = ?,
          input_artifact_ids_json = ?,
          output_artifact_ids_json = ?,
          attempt_count = ?,
          max_attempts = ?,
          budget_limit = ?,
          budget_spent = ?,
          usage_status = ?,
          started_at = ?,
          completed_at = ?,
          failure_reason = ?,
          clarification_question = ?,
          clarification_answer = ?,
          last_review_decision = ?,
          last_review_comment = ?,
          last_run_json = ?,
          version = ?
        WHERE id = ? AND mission_id = ? AND version = ?`
      )
      .run(
        row.title,
        row.instruction,
        row.assigned_agent_role,
        row.execution_mode,
        row.requested_tools_json,
        row.status,
        row.priority,
        row.dependencies_json,
        row.input_artifact_ids_json,
        row.output_artifact_ids_json,
        row.attempt_count,
        row.max_attempts,
        row.budget_limit,
        row.budget_spent,
        row.usage_status,
        row.started_at,
        row.completed_at,
        row.failure_reason,
        row.clarification_question,
        row.clarification_answer,
        row.last_review_decision,
        row.last_review_comment,
        row.last_run_json,
        row.version,
        row.id,
        row.mission_id,
        expectedVersion
      );
    return true;
  }

  public deleteMissionTaskRow(missionId: string, taskId: string): boolean {
    this.ensureMissionTablesReady();
    const current = this.getMissionTaskRowById(taskId);
    if (!current || current.mission_id !== missionId) {
      return false;
    }
    this.db
      .prepare(`DELETE FROM mission_tasks WHERE id = ? AND mission_id = ?`)
      .run(taskId, missionId);
    return true;
  }

  public getMissionTaskRowById(taskId: string): StoredMissionTaskRow | undefined {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, mission_id, project_id, tenant_id, title, instruction, assigned_agent_role,
                execution_mode, requested_tools_json, status, priority, dependencies_json,
                input_artifact_ids_json, output_artifact_ids_json, attempt_count, max_attempts,
                budget_limit, budget_spent, usage_status, started_at, completed_at, failure_reason,
                clarification_question, clarification_answer, last_review_decision, last_review_comment,
                last_run_json, version
         FROM mission_tasks WHERE id = ?`
      )
      .get(taskId) as StoredMissionTaskRow | undefined;
  }

  public listMissionTaskRows(missionId: string): StoredMissionTaskRow[] {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, mission_id, project_id, tenant_id, title, instruction, assigned_agent_role,
                execution_mode, requested_tools_json, status, priority, dependencies_json,
                input_artifact_ids_json, output_artifact_ids_json, attempt_count, max_attempts,
                budget_limit, budget_spent, usage_status, started_at, completed_at, failure_reason,
                clarification_question, clarification_answer, last_review_decision, last_review_comment,
                last_run_json, version
         FROM mission_tasks
         WHERE mission_id = ?
         ORDER BY priority DESC, id ASC`
      )
      .all(missionId) as unknown as StoredMissionTaskRow[];
  }

  public insertMissionEventRow(row: StoredMissionEventRow): void {
    this.ensureMissionTablesReady();
    this.db
      .prepare(
        `INSERT INTO mission_events (
          id, sequence_num, mission_id, project_id, tenant_id, task_id, artifact_id,
          event_type, actor_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.sequence_num,
        row.mission_id,
        row.project_id,
        row.tenant_id,
        row.task_id,
        row.artifact_id,
        row.event_type,
        row.actor_id,
        row.payload_json,
        row.created_at
      );
  }

  public listMissionEventRows(missionId: string): StoredMissionEventRow[] {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, sequence_num, mission_id, project_id, tenant_id, task_id, artifact_id,
                event_type, actor_id, payload_json, created_at
         FROM mission_events
         WHERE mission_id = ?
         ORDER BY sequence_num ASC, created_at ASC`
      )
      .all(missionId) as unknown as StoredMissionEventRow[];
  }

  public insertMissionArtifactRow(row: StoredMissionArtifactRow): void {
    this.ensureMissionTablesReady();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO mission_artifacts (
          id, mission_id, task_id, project_id, tenant_id, kind, title, content,
          preview, version, is_final, metadata_json, created_by_role, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.mission_id,
        row.task_id,
        row.project_id,
        row.tenant_id,
        row.kind,
        row.title,
        row.content,
        row.preview,
        row.version,
        row.is_final,
        row.metadata_json,
        row.created_by_role,
        row.created_at
      );
  }

  public listMissionArtifactRows(missionId: string): StoredMissionArtifactRow[] {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, mission_id, task_id, project_id, tenant_id, kind, title, content,
                preview, version, is_final, metadata_json, created_by_role, created_at
         FROM mission_artifacts
         WHERE mission_id = ?
         ORDER BY version ASC, created_at ASC`
      )
      .all(missionId) as unknown as StoredMissionArtifactRow[];
  }

  public insertMissionBudgetLedgerRow(row: StoredMissionBudgetLedgerRow): void {
    this.ensureMissionTablesReady();
    this.db
      .prepare(
        `INSERT INTO mission_budget_ledger (
          id, mission_id, task_id, project_id, tenant_id, run_id, agent_role,
          amount_spent, usage_status, provider_id, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.mission_id,
        row.task_id,
        row.project_id,
        row.tenant_id,
        row.run_id,
        row.agent_role,
        row.amount_spent,
        row.usage_status,
        row.provider_id,
        row.description,
        row.created_at
      );
  }

  public listMissionBudgetLedgerRows(
    missionId: string
  ): StoredMissionBudgetLedgerRow[] {
    this.ensureMissionTablesReady();
    return this.db
      .prepare(
        `SELECT id, mission_id, task_id, project_id, tenant_id, run_id, agent_role,
                amount_spent, usage_status, provider_id, description, created_at
         FROM mission_budget_ledger
         WHERE mission_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(missionId) as unknown as StoredMissionBudgetLedgerRow[];
  }


  // ============================================================================
  // PLAYBOOKS SQLITE PERSISTENCE & ATOMIC TRANSACTION METHODS
  // ============================================================================

  public insertPlaybookRow(row: StoredPlaybookRow): void {
    this.ensurePlaybooksTablesReady();
    this.db
      .prepare(
        `INSERT INTO playbooks (
          id, tenant_id, project_id, owner_id, slug, title, description, category,
          tags_json, visibility, status, current_version, draft_definition_json,
          draft_version_lock, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.owner_id,
        row.slug,
        row.title,
        row.description,
        row.category,
        row.tags_json,
        row.visibility,
        row.status,
        row.current_version,
        row.draft_definition_json,
        row.draft_version_lock,
        row.created_at,
        row.updated_at,
        row.archived_at
      );
  }

  public updatePlaybookRowOptimistic(
    row: StoredPlaybookRow,
    expectedDraftVersionLock: number
  ): boolean {
    this.ensurePlaybooksTablesReady();
    const current = this.getPlaybookRowById(row.id);
    if (
      !current ||
      Number(current.draft_version_lock) !== Number(expectedDraftVersionLock)
    ) {
      return false;
    }
    this.db
      .prepare(
        `UPDATE playbooks SET
          slug = ?,
          title = ?,
          description = ?,
          category = ?,
          tags_json = ?,
          visibility = ?,
          status = ?,
          current_version = ?,
          draft_definition_json = ?,
          draft_version_lock = ?,
          updated_at = ?,
          archived_at = ?
        WHERE id = ? AND draft_version_lock = ?`
      )
      .run(
        row.slug,
        row.title,
        row.description,
        row.category,
        row.tags_json,
        row.visibility,
        row.status,
        row.current_version,
        row.draft_definition_json,
        row.draft_version_lock,
        row.updated_at,
        row.archived_at,
        row.id,
        expectedDraftVersionLock
      );
    return true;
  }

  public getPlaybookRowById(playbookId: string): StoredPlaybookRow | undefined {
    this.ensurePlaybooksTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description, category,
                tags_json, visibility, status, current_version, draft_definition_json,
                draft_version_lock, created_at, updated_at, archived_at
         FROM playbooks WHERE id = ?`
      )
      .get(playbookId) as StoredPlaybookRow | undefined;
  }

  public getPlaybookRowBySlug(
    tenantId: string,
    projectId: string | null,
    slug: string
  ): StoredPlaybookRow | undefined {
    this.ensurePlaybooksTablesReady();
    if (projectId === null) {
      return this.db
        .prepare(
          `SELECT id, tenant_id, project_id, owner_id, slug, title, description, category,
                  tags_json, visibility, status, current_version, draft_definition_json,
                  draft_version_lock, created_at, updated_at, archived_at
           FROM playbooks
           WHERE tenant_id = ? AND project_id IS NULL AND slug = ?`
        )
        .get(tenantId, slug) as StoredPlaybookRow | undefined;
    }
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description, category,
                tags_json, visibility, status, current_version, draft_definition_json,
                draft_version_lock, created_at, updated_at, archived_at
         FROM playbooks
         WHERE tenant_id = ? AND project_id = ? AND slug = ?`
      )
      .get(tenantId, projectId, slug) as StoredPlaybookRow | undefined;
  }

  public listPlaybookRows(filters?: {
    tenant_id?: string;
    project_id?: string | null;
    owner_id?: string;
    category?: string;
    visibility?: string;
    status?: string;
  }): StoredPlaybookRow[] {
    this.ensurePlaybooksTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.category) {
      clauses.push("category = ?");
      params.push(filters.category);
    }
    if (filters?.visibility) {
      clauses.push("visibility = ?");
      params.push(filters.visibility);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `
      SELECT id, tenant_id, project_id, owner_id, slug, title, description, category,
             tags_json, visibility, status, current_version, draft_definition_json,
             draft_version_lock, created_at, updated_at, archived_at
      FROM playbooks
      ${whereSql}
      ORDER BY CASE WHEN visibility = 'built_in' THEN 0 ELSE 1 END ASC, updated_at DESC, id ASC
    `;
    return this.db.prepare(sql).all(...params) as unknown as StoredPlaybookRow[];
  }

  public insertPlaybookVersionRow(row: StoredPlaybookVersionRow): void {
    this.ensurePlaybooksTablesReady();
    this.db
      .prepare(
        `INSERT INTO playbook_versions (
          id, playbook_id, version_number, changelog, definition_json,
          created_by, created_at, checksum_sha256, is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.playbook_id,
        row.version_number,
        row.changelog,
        row.definition_json,
        row.created_by,
        row.created_at,
        row.checksum_sha256,
        row.is_published
      );
  }

  public getPlaybookVersionRow(
    playbookId: string,
    versionIdOrNumber: string | number
  ): StoredPlaybookVersionRow | undefined {
    this.ensurePlaybooksTablesReady();
    if (
      typeof versionIdOrNumber === "number" ||
      /^[0-9]+$/.test(String(versionIdOrNumber))
    ) {
      const verNum = Number(versionIdOrNumber);
      const byNum = this.db
        .prepare(
          `SELECT id, playbook_id, version_number, changelog, definition_json,
                  created_by, created_at, checksum_sha256, is_published
           FROM playbook_versions
           WHERE playbook_id = ? AND version_number = ?`
        )
        .get(playbookId, verNum) as StoredPlaybookVersionRow | undefined;
      if (byNum) {
        return byNum;
      }
    }
    return this.db
      .prepare(
        `SELECT id, playbook_id, version_number, changelog, definition_json,
                created_by, created_at, checksum_sha256, is_published
         FROM playbook_versions
         WHERE playbook_id = ? AND id = ?`
      )
      .get(playbookId, String(versionIdOrNumber)) as
      | StoredPlaybookVersionRow
      | undefined;
  }

  public listPlaybookVersionRows(playbookId: string): StoredPlaybookVersionRow[] {
    this.ensurePlaybooksTablesReady();
    return this.db
      .prepare(
        `SELECT id, playbook_id, version_number, changelog, definition_json,
                created_by, created_at, checksum_sha256, is_published
         FROM playbook_versions
         WHERE playbook_id = ?
         ORDER BY version_number DESC`
      )
      .all(playbookId) as unknown as StoredPlaybookVersionRow[];
  }

  public insertPlaybookInstantiationRow(row: StoredPlaybookInstantiationRow): void {
    this.ensurePlaybooksTablesReady();
    this.db
      .prepare(
        `INSERT INTO playbook_instantiations (
          id, playbook_id, playbook_version_id, resulting_mission_id,
          owner_id, tenant_id, project_id, resolved_variables_json,
          initiated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.playbook_id,
        row.playbook_version_id,
        row.resulting_mission_id,
        row.owner_id,
        row.tenant_id,
        row.project_id,
        row.resolved_variables_json,
        row.initiated_at,
        row.created_at
      );
  }

  public getPlaybookInstantiationByMissionId(
    missionId: string
  ): StoredPlaybookInstantiationRow | undefined {
    this.ensurePlaybooksTablesReady();
    return this.db
      .prepare(
        `SELECT id, playbook_id, playbook_version_id, resulting_mission_id,
                owner_id, tenant_id, project_id, resolved_variables_json,
                initiated_at, created_at
         FROM playbook_instantiations
         WHERE resulting_mission_id = ?`
      )
      .get(missionId) as StoredPlaybookInstantiationRow | undefined;
  }

  public listPlaybookInstantiationRows(
    playbookId: string
  ): StoredPlaybookInstantiationRow[] {
    this.ensurePlaybooksTablesReady();
    return this.db
      .prepare(
        `SELECT id, playbook_id, playbook_version_id, resulting_mission_id,
                owner_id, tenant_id, project_id, resolved_variables_json,
                initiated_at, created_at
         FROM playbook_instantiations
         WHERE playbook_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(playbookId) as unknown as StoredPlaybookInstantiationRow[];
  }

  public insertPlaybookAuditEventRow(row: StoredPlaybookAuditEventRow): void {
    this.ensurePlaybooksTablesReady();
    this.db
      .prepare(
        `INSERT INTO playbook_audit_events (
          id, tenant_id, project_id, playbook_id, playbook_version_id,
          resulting_mission_id, actor_id, event_type, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.playbook_id,
        row.playbook_version_id,
        row.resulting_mission_id,
        row.actor_id,
        row.event_type,
        row.payload_json,
        row.created_at
      );
  }

  public listPlaybookAuditEventRows(
    playbookId: string
  ): StoredPlaybookAuditEventRow[] {
    this.ensurePlaybooksTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, playbook_id, playbook_version_id,
                resulting_mission_id, actor_id, event_type, payload_json, created_at
         FROM playbook_audit_events
         WHERE playbook_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(playbookId) as unknown as StoredPlaybookAuditEventRow[];
  }

  // ============================================================================
  // KOSMORA SCHEDULES & TRIGGERS PERSISTENCE METHODS
  // ============================================================================

  public upsertPlaybookScheduleRow(row: StoredPlaybookScheduleRow): void {
    this.ensureSchedulesTablesReady();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO playbook_schedules (
          id, tenant_id, project_id, owner_id, playbook_id, playbook_version_number,
          title, description, trigger_type, cron_expression, interval_minutes,
          one_time_run_at, timezone, event_topic, event_filter_json,
          webhook_secret_sha256, webhook_signing_secret_preview,
          default_variables_json, variable_mappings_json, auto_start_mission,
          mission_priority, mission_title_override, max_runs_per_day, runs_today_count,
          max_concurrent_missions, daily_budget_limit, daily_budget_spent,
          consecutive_failures_limit, consecutive_failures_count,
          deduplication_window_seconds, status, disabled_reason,
          last_run_at, next_run_at, version, created_at, updated_at, archived_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.owner_id,
        row.playbook_id,
        row.playbook_version_number,
        row.title,
        row.description,
        row.trigger_type,
        row.cron_expression,
        row.interval_minutes,
        row.one_time_run_at,
        row.timezone,
        row.event_topic,
        row.event_filter_json,
        row.webhook_secret_sha256,
        row.webhook_signing_secret_preview,
        row.default_variables_json,
        row.variable_mappings_json,
        row.auto_start_mission,
        row.mission_priority,
        row.mission_title_override,
        row.max_runs_per_day,
        row.runs_today_count,
        row.max_concurrent_missions,
        row.daily_budget_limit,
        row.daily_budget_spent,
        row.consecutive_failures_limit,
        row.consecutive_failures_count,
        row.deduplication_window_seconds,
        row.status,
        row.disabled_reason,
        row.last_run_at,
        row.next_run_at,
        row.version,
        row.created_at,
        row.updated_at,
        row.archived_at
      );
  }

  public getPlaybookScheduleRow(
    scheduleId: string
  ): StoredPlaybookScheduleRow | undefined {
    this.ensureSchedulesTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, playbook_id, playbook_version_number,
                title, description, trigger_type, cron_expression, interval_minutes,
                one_time_run_at, timezone, event_topic, event_filter_json,
                webhook_secret_sha256, webhook_signing_secret_preview,
                default_variables_json, variable_mappings_json, auto_start_mission,
                mission_priority, mission_title_override, max_runs_per_day, runs_today_count,
                max_concurrent_missions, daily_budget_limit, daily_budget_spent,
                consecutive_failures_limit, consecutive_failures_count,
                deduplication_window_seconds, status, disabled_reason,
                last_run_at, next_run_at, version, created_at, updated_at, archived_at
         FROM playbook_schedules
         WHERE id = ?`
      )
      .get(scheduleId) as StoredPlaybookScheduleRow | undefined;
  }

  public listPlaybookScheduleRows(filters?: {
    tenant_id?: string;
    project_id?: string;
    playbook_id?: string;
    trigger_type?: string;
    status?: string;
    event_topic?: string;
  }): StoredPlaybookScheduleRow[] {
    this.ensureSchedulesTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.tenant_id) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("project_id = ?");
      params.push(filters.project_id);
    }
    if (filters?.playbook_id) {
      clauses.push("playbook_id = ?");
      params.push(filters.playbook_id);
    }
    if (filters?.trigger_type) {
      clauses.push("trigger_type = ?");
      params.push(filters.trigger_type);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.event_topic) {
      clauses.push("event_topic = ?");
      params.push(filters.event_topic);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, playbook_id, playbook_version_number,
                title, description, trigger_type, cron_expression, interval_minutes,
                one_time_run_at, timezone, event_topic, event_filter_json,
                webhook_secret_sha256, webhook_signing_secret_preview,
                default_variables_json, variable_mappings_json, auto_start_mission,
                mission_priority, mission_title_override, max_runs_per_day, runs_today_count,
                max_concurrent_missions, daily_budget_limit, daily_budget_spent,
                consecutive_failures_limit, consecutive_failures_count,
                deduplication_window_seconds, status, disabled_reason,
                last_run_at, next_run_at, version, created_at, updated_at, archived_at
         FROM playbook_schedules
         ${whereSql}
         ORDER BY updated_at DESC, id ASC`
      )
      .all(...params) as unknown as StoredPlaybookScheduleRow[];
  }

  public insertScheduleRunRow(row: StoredScheduleRunRow): void {
    this.ensureSchedulesTablesReady();
    this.db
      .prepare(
        `INSERT INTO schedule_runs (
          id, schedule_id, tenant_id, project_id, playbook_id, playbook_version_id,
          playbook_instantiation_id, resulting_mission_id, trigger_source,
          idempotency_key, status, resolved_variables_json, failure_reason,
          estimated_budget, initiated_by, initiated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.schedule_id,
        row.tenant_id,
        row.project_id,
        row.playbook_id,
        row.playbook_version_id,
        row.playbook_instantiation_id,
        row.resulting_mission_id,
        row.trigger_source,
        row.idempotency_key,
        row.status,
        row.resolved_variables_json,
        row.failure_reason,
        row.estimated_budget,
        row.initiated_by,
        row.initiated_at,
        row.completed_at
      );
  }

  public listScheduleRunRows(scheduleId: string): StoredScheduleRunRow[] {
    this.ensureSchedulesTablesReady();
    return this.db
      .prepare(
        `SELECT id, schedule_id, tenant_id, project_id, playbook_id, playbook_version_id,
                playbook_instantiation_id, resulting_mission_id, trigger_source,
                idempotency_key, status, resolved_variables_json, failure_reason,
                estimated_budget, initiated_by, initiated_at, completed_at
         FROM schedule_runs
         WHERE schedule_id = ?
         ORDER BY initiated_at DESC, id DESC`
      )
      .all(scheduleId) as unknown as StoredScheduleRunRow[];
  }


  public insertScheduleAuditEventRow(row: StoredScheduleAuditEventRow): void {
    this.ensureSchedulesTablesReady();
    this.db
      .prepare(
        `INSERT INTO schedule_audit_events (
          id, schedule_id, tenant_id, project_id, actor_id, event_type, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.schedule_id,
        row.tenant_id,
        row.project_id,
        row.actor_id,
        row.event_type,
        row.details_json,
        row.created_at
      );
  }

  public listScheduleAuditEventRows(
    scheduleId: string
  ): StoredScheduleAuditEventRow[] {
    this.ensureSchedulesTablesReady();
    return this.db
      .prepare(
        `SELECT id, schedule_id, tenant_id, project_id, actor_id, event_type, details_json, created_at
         FROM schedule_audit_events
         WHERE schedule_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(scheduleId) as unknown as StoredScheduleAuditEventRow[];
  }

  // ============================================================================
  // EVALUATIONS & QUALITY GATES SQLITE PERSISTENCE METHODS
  // ============================================================================

  public upsertEvaluationSuiteRow(row: StoredEvaluationSuiteRow): void {
    this.ensureEvaluationsTablesReady();
    this.db
      .prepare(
        `INSERT INTO evaluation_suites (
          id, tenant_id, project_id, owner_id, slug, title, description,
          target_kind, visibility, status, passing_score_threshold,
          block_on_critical_criteria, criteria_json, golden_test_cases_json,
          version, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          slug = excluded.slug,
          title = excluded.title,
          description = excluded.description,
          target_kind = excluded.target_kind,
          visibility = excluded.visibility,
          status = excluded.status,
          passing_score_threshold = excluded.passing_score_threshold,
          block_on_critical_criteria = excluded.block_on_critical_criteria,
          criteria_json = excluded.criteria_json,
          golden_test_cases_json = excluded.golden_test_cases_json,
          version = excluded.version,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.owner_id,
        row.slug,
        row.title,
        row.description,
        row.target_kind,
        row.visibility,
        row.status,
        row.passing_score_threshold,
        row.block_on_critical_criteria,
        row.criteria_json,
        row.golden_test_cases_json,
        row.version,
        row.created_at,
        row.updated_at,
        row.archived_at
      );
  }

  public getEvaluationSuiteRowById(
    suiteId: string
  ): StoredEvaluationSuiteRow | undefined {
    this.ensureEvaluationsTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                target_kind, visibility, status, passing_score_threshold,
                block_on_critical_criteria, criteria_json, golden_test_cases_json,
                version, created_at, updated_at, archived_at
         FROM evaluation_suites
         WHERE id = ?`
      )
      .get(suiteId) as StoredEvaluationSuiteRow | undefined;
  }

  public getEvaluationSuiteRowBySlug(
    tenantId: string,
    projectId: string | null,
    slug: string
  ): StoredEvaluationSuiteRow | undefined {
    this.ensureEvaluationsTablesReady();
    if (projectId === null) {
      return this.db
        .prepare(
          `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                  target_kind, visibility, status, passing_score_threshold,
                  block_on_critical_criteria, criteria_json, golden_test_cases_json,
                  version, created_at, updated_at, archived_at
           FROM evaluation_suites
           WHERE tenant_id = ? AND project_id IS NULL AND slug = ?`
        )
        .get(tenantId, slug) as StoredEvaluationSuiteRow | undefined;
    }
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                target_kind, visibility, status, passing_score_threshold,
                block_on_critical_criteria, criteria_json, golden_test_cases_json,
                version, created_at, updated_at, archived_at
         FROM evaluation_suites
         WHERE tenant_id = ? AND project_id = ? AND slug = ?`
      )
      .get(tenantId, projectId, slug) as StoredEvaluationSuiteRow | undefined;
  }

  public listEvaluationSuiteRows(filters?: {
    tenant_id?: string;
    project_id?: string;
    target_kind?: string;
    status?: string;
    visibility?: string;
  }): StoredEvaluationSuiteRow[] {
    this.ensureEvaluationsTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.tenant_id) {
      clauses.push("(tenant_id = ? OR visibility = 'built_in')");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("(project_id = ? OR project_id IS NULL OR visibility IN ('built_in', 'organization'))");
      params.push(filters.project_id);
    }
    if (filters?.target_kind) {
      clauses.push("(target_kind = ? OR target_kind = 'both')");
      params.push(filters.target_kind);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.visibility) {
      clauses.push("visibility = ?");
      params.push(filters.visibility);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                target_kind, visibility, status, passing_score_threshold,
                block_on_critical_criteria, criteria_json, golden_test_cases_json,
                version, created_at, updated_at, archived_at
         FROM evaluation_suites
         ${whereSql}
         ORDER BY CASE WHEN visibility = 'built_in' THEN 0 ELSE 1 END ASC, updated_at DESC, id ASC`
      )
      .all(...params) as unknown as StoredEvaluationSuiteRow[];
  }

  public insertEvaluationRunRow(row: StoredEvaluationRunRow): void {
    this.ensureEvaluationsTablesReady();
    this.db
      .prepare(
        `INSERT INTO evaluation_runs (
          id, suite_id, suite_version, tenant_id, project_id, target_kind,
          mission_id, playbook_id, playbook_version_id, playbook_version_number,
          baseline_run_id, overall_score, passing_score_threshold, verdict,
          critical_failures_count, criteria_results_json, test_case_results_json,
          score_delta, regression_detected, regression_summary, total_budget_spent,
          initiated_by, initiated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.suite_id,
        row.suite_version,
        row.tenant_id,
        row.project_id,
        row.target_kind,
        row.mission_id,
        row.playbook_id,
        row.playbook_version_id,
        row.playbook_version_number,
        row.baseline_run_id,
        row.overall_score,
        row.passing_score_threshold,
        row.verdict,
        row.critical_failures_count,
        row.criteria_results_json,
        row.test_case_results_json,
        row.score_delta,
        row.regression_detected,
        row.regression_summary,
        row.total_budget_spent,
        row.initiated_by,
        row.initiated_at,
        row.completed_at
      );
  }

  public getEvaluationRunRow(runId: string): StoredEvaluationRunRow | undefined {
    this.ensureEvaluationsTablesReady();
    return this.db
      .prepare(
        `SELECT id, suite_id, suite_version, tenant_id, project_id, target_kind,
                mission_id, playbook_id, playbook_version_id, playbook_version_number,
                baseline_run_id, overall_score, passing_score_threshold, verdict,
                critical_failures_count, criteria_results_json, test_case_results_json,
                score_delta, regression_detected, regression_summary, total_budget_spent,
                initiated_by, initiated_at, completed_at
         FROM evaluation_runs
         WHERE id = ?`
      )
      .get(runId) as StoredEvaluationRunRow | undefined;
  }

  public listEvaluationRunRows(filters?: {
    tenant_id?: string;
    project_id?: string;
    suite_id?: string;
    mission_id?: string;
    playbook_id?: string;
    playbook_version_number?: number;
    verdict?: string;
  }): StoredEvaluationRunRow[] {
    this.ensureEvaluationsTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.tenant_id) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("project_id = ?");
      params.push(filters.project_id);
    }
    if (filters?.suite_id) {
      clauses.push("suite_id = ?");
      params.push(filters.suite_id);
    }
    if (filters?.mission_id) {
      clauses.push("mission_id = ?");
      params.push(filters.mission_id);
    }
    if (filters?.playbook_id) {
      clauses.push("playbook_id = ?");
      params.push(filters.playbook_id);
    }
    if (filters?.playbook_version_number !== undefined) {
      clauses.push("playbook_version_number = ?");
      params.push(filters.playbook_version_number);
    }
    if (filters?.verdict) {
      clauses.push("verdict = ?");
      params.push(filters.verdict);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, suite_id, suite_version, tenant_id, project_id, target_kind,
                mission_id, playbook_id, playbook_version_id, playbook_version_number,
                baseline_run_id, overall_score, passing_score_threshold, verdict,
                critical_failures_count, criteria_results_json, test_case_results_json,
                score_delta, regression_detected, regression_summary, total_budget_spent,
                initiated_by, initiated_at, completed_at
         FROM evaluation_runs
         ${whereSql}
         ORDER BY initiated_at DESC, id DESC`
      )
      .all(...params) as unknown as StoredEvaluationRunRow[];
  }

  public upsertQualityGatePolicyRow(row: StoredQualityGatePolicyRow): void {
    this.ensureEvaluationsTablesReady();
    this.db
      .prepare(
        `INSERT INTO quality_gate_policies (
          id, tenant_id, project_id, playbook_id, required_suite_ids_json,
          min_overall_score, allow_critical_failures, max_regression_drop,
          enforce_on_publish, enforce_on_schedule_activation, status,
          version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          required_suite_ids_json = excluded.required_suite_ids_json,
          min_overall_score = excluded.min_overall_score,
          allow_critical_failures = excluded.allow_critical_failures,
          max_regression_drop = excluded.max_regression_drop,
          enforce_on_publish = excluded.enforce_on_publish,
          enforce_on_schedule_activation = excluded.enforce_on_schedule_activation,
          status = excluded.status,
          version = excluded.version,
          updated_at = excluded.updated_at`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.playbook_id,
        row.required_suite_ids_json,
        row.min_overall_score,
        row.allow_critical_failures,
        row.max_regression_drop,
        row.enforce_on_publish,
        row.enforce_on_schedule_activation,
        row.status,
        row.version,
        row.created_by,
        row.created_at,
        row.updated_at
      );
  }

  public getQualityGatePolicyRowByPlaybook(
    tenantId: string,
    projectId: string,
    playbookId: string
  ): StoredQualityGatePolicyRow | undefined {
    this.ensureEvaluationsTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, playbook_id, required_suite_ids_json,
                min_overall_score, allow_critical_failures, max_regression_drop,
                enforce_on_publish, enforce_on_schedule_activation, status,
                version, created_by, created_at, updated_at
         FROM quality_gate_policies
         WHERE tenant_id = ? AND project_id = ? AND playbook_id = ?`
      )
      .get(tenantId, projectId, playbookId) as StoredQualityGatePolicyRow | undefined;
  }

  public listQualityGatePolicyRows(filters?: {
    tenant_id?: string;
    project_id?: string;
    playbook_id?: string;
    status?: string;
  }): StoredQualityGatePolicyRow[] {
    this.ensureEvaluationsTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.tenant_id) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("project_id = ?");
      params.push(filters.project_id);
    }
    if (filters?.playbook_id) {
      clauses.push("playbook_id = ?");
      params.push(filters.playbook_id);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, playbook_id, required_suite_ids_json,
                min_overall_score, allow_critical_failures, max_regression_drop,
                enforce_on_publish, enforce_on_schedule_activation, status,
                version, created_by, created_at, updated_at
         FROM quality_gate_policies
         ${whereSql}
         ORDER BY updated_at DESC, id ASC`
      )
      .all(...params) as unknown as StoredQualityGatePolicyRow[];
  }

  public insertEvaluationAuditEventRow(row: StoredEvaluationAuditEventRow): void {
    this.ensureEvaluationsTablesReady();
    this.db
      .prepare(
        `INSERT INTO evaluation_audit_events (
          id, suite_id, run_id, tenant_id, project_id, actor_id, event_type, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.suite_id,
        row.run_id,
        row.tenant_id,
        row.project_id,
        row.actor_id,
        row.event_type,
        row.details_json,
        row.created_at
      );
  }

  public listEvaluationAuditEventRows(
    suiteId: string
  ): StoredEvaluationAuditEventRow[] {
    this.ensureEvaluationsTablesReady();
    return this.db
      .prepare(
        `SELECT id, suite_id, run_id, tenant_id, project_id, actor_id, event_type, details_json, created_at
         FROM evaluation_audit_events
         WHERE suite_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(suiteId) as unknown as StoredEvaluationAuditEventRow[];
  }


  // ============================================================================
  // KOSMORA KNOWLEDGE VAULT & CONTEXT CONNECTORS PERSISTENCE METHODS
  // ============================================================================

  public upsertKnowledgeCollectionRow(row: StoredKnowledgeCollectionRow): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(
        `INSERT INTO knowledge_collections (
          id, tenant_id, project_id, owner_id, slug, title, description,
          category, visibility, status, chunking_strategy, chunk_size_chars,
          chunk_overlap_chars, redact_secrets_on_ingest, document_count,
          chunk_count, version, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          category = excluded.category,
          visibility = excluded.visibility,
          status = excluded.status,
          chunking_strategy = excluded.chunking_strategy,
          chunk_size_chars = excluded.chunk_size_chars,
          chunk_overlap_chars = excluded.chunk_overlap_chars,
          redact_secrets_on_ingest = excluded.redact_secrets_on_ingest,
          document_count = excluded.document_count,
          chunk_count = excluded.chunk_count,
          version = excluded.version,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at`
      )
      .run(
        row.id,
        row.tenant_id,
        row.project_id,
        row.owner_id,
        row.slug,
        row.title,
        row.description,
        row.category,
        row.visibility,
        row.status,
        row.chunking_strategy,
        row.chunk_size_chars,
        row.chunk_overlap_chars,
        row.redact_secrets_on_ingest,
        row.document_count,
        row.chunk_count,
        row.version,
        row.created_at,
        row.updated_at,
        row.archived_at
      );
  }

  public getKnowledgeCollectionRowById(
    collectionId: string
  ): StoredKnowledgeCollectionRow | undefined {
    this.ensureKnowledgeVaultTablesReady();
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                category, visibility, status, chunking_strategy, chunk_size_chars,
                chunk_overlap_chars, redact_secrets_on_ingest, document_count,
                chunk_count, version, created_at, updated_at, archived_at
         FROM knowledge_collections
         WHERE id = ?`
      )
      .get(collectionId) as StoredKnowledgeCollectionRow | undefined;
  }

  public getKnowledgeCollectionRowBySlug(
    tenantId: string,
    projectId: string | null,
    slug: string
  ): StoredKnowledgeCollectionRow | undefined {
    this.ensureKnowledgeVaultTablesReady();
    if (projectId === null) {
      return this.db
        .prepare(
          `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                  category, visibility, status, chunking_strategy, chunk_size_chars,
                  chunk_overlap_chars, redact_secrets_on_ingest, document_count,
                  chunk_count, version, created_at, updated_at, archived_at
           FROM knowledge_collections
           WHERE tenant_id = ? AND project_id IS NULL AND slug = ?`
        )
        .get(tenantId, slug) as StoredKnowledgeCollectionRow | undefined;
    }
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                category, visibility, status, chunking_strategy, chunk_size_chars,
                chunk_overlap_chars, redact_secrets_on_ingest, document_count,
                chunk_count, version, created_at, updated_at, archived_at
         FROM knowledge_collections
         WHERE tenant_id = ? AND project_id = ? AND slug = ?`
      )
      .get(tenantId, projectId, slug) as StoredKnowledgeCollectionRow | undefined;
  }

  public listKnowledgeCollectionRows(filters?: {
    tenant_id?: string;
    project_id?: string;
    category?: string;
    status?: string;
    visibility?: string;
  }): StoredKnowledgeCollectionRow[] {
    this.ensureKnowledgeVaultTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.tenant_id) {
      clauses.push("(tenant_id = ? OR visibility = 'built_in')");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("(project_id = ? OR project_id IS NULL OR visibility IN ('built_in', 'organization'))");
      params.push(filters.project_id);
    }
    if (filters?.category) {
      clauses.push("category = ?");
      params.push(filters.category);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.visibility) {
      clauses.push("visibility = ?");
      params.push(filters.visibility);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, tenant_id, project_id, owner_id, slug, title, description,
                category, visibility, status, chunking_strategy, chunk_size_chars,
                chunk_overlap_chars, redact_secrets_on_ingest, document_count,
                chunk_count, version, created_at, updated_at, archived_at
         FROM knowledge_collections
         ${whereSql}
         ORDER BY CASE WHEN visibility = 'built_in' THEN 0 ELSE 1 END ASC, updated_at DESC, id ASC`
      )
      .all(...params) as unknown as StoredKnowledgeCollectionRow[];
  }

  public upsertKnowledgeDocumentRow(row: StoredKnowledgeDocumentRow): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(
        `INSERT INTO knowledge_documents (
          id, collection_id, tenant_id, project_id, title, source_type,
          source_uri, raw_content_preview, sanitized_content, content_sha256,
          byte_size, tags_json, redacted_secrets_count, quarantine_reason,
          chunk_count, status, version, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          source_type = excluded.source_type,
          source_uri = excluded.source_uri,
          raw_content_preview = excluded.raw_content_preview,
          sanitized_content = excluded.sanitized_content,
          content_sha256 = excluded.content_sha256,
          byte_size = excluded.byte_size,
          tags_json = excluded.tags_json,
          redacted_secrets_count = excluded.redacted_secrets_count,
          quarantine_reason = excluded.quarantine_reason,
          chunk_count = excluded.chunk_count,
          status = excluded.status,
          version = excluded.version,
          updated_at = excluded.updated_at`
      )
      .run(
        row.id,
        row.collection_id,
        row.tenant_id,
        row.project_id,
        row.title,
        row.source_type,
        row.source_uri,
        row.raw_content_preview,
        row.sanitized_content,
        row.content_sha256,
        row.byte_size,
        row.tags_json,
        row.redacted_secrets_count,
        row.quarantine_reason,
        row.chunk_count,
        row.status,
        row.version,
        row.created_by,
        row.created_at,
        row.updated_at
      );
  }

  public getKnowledgeDocumentRowById(
    documentId: string
  ): StoredKnowledgeDocumentRow | undefined {
    this.ensureKnowledgeVaultTablesReady();
    return this.db
      .prepare(
        `SELECT id, collection_id, tenant_id, project_id, title, source_type,
                source_uri, raw_content_preview, sanitized_content, content_sha256,
                byte_size, tags_json, redacted_secrets_count, quarantine_reason,
                chunk_count, status, version, created_by, created_at, updated_at
         FROM knowledge_documents
         WHERE id = ?`
      )
      .get(documentId) as StoredKnowledgeDocumentRow | undefined;
  }

  public listKnowledgeDocumentRows(filters?: {
    collection_id?: string;
    tenant_id?: string;
    project_id?: string;
    status?: string;
  }): StoredKnowledgeDocumentRow[] {
    this.ensureKnowledgeVaultTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.collection_id) {
      clauses.push("collection_id = ?");
      params.push(filters.collection_id);
    }
    if (filters?.tenant_id) {
      clauses.push("(tenant_id = ? OR tenant_id = 'tenant_system')");
      params.push(filters.tenant_id);
    }
    if (filters?.project_id) {
      clauses.push("(project_id = ? OR project_id = '__builtin__')");
      params.push(filters.project_id);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, collection_id, tenant_id, project_id, title, source_type,
                source_uri, raw_content_preview, sanitized_content, content_sha256,
                byte_size, tags_json, redacted_secrets_count, quarantine_reason,
                chunk_count, status, version, created_by, created_at, updated_at
         FROM knowledge_documents
         ${whereSql}
         ORDER BY updated_at DESC, id ASC`
      )
      .all(...params) as unknown as StoredKnowledgeDocumentRow[];
  }

  public replaceKnowledgeChunksForDocument(
    documentId: string,
    chunks: StoredKnowledgeChunkRow[]
  ): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(`DELETE FROM knowledge_chunks WHERE document_id = ?`)
      .run(documentId);

    const stmt = this.db.prepare(
      `INSERT INTO knowledge_chunks (
        id, document_id, collection_id, tenant_id, project_id, chunk_index,
        section_heading, content, token_estimate, keywords_json, chunk_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const c of chunks) {
      stmt.run(
        c.id,
        c.document_id,
        c.collection_id,
        c.tenant_id,
        c.project_id,
        c.chunk_index,
        c.section_heading,
        c.content,
        c.token_estimate,
        c.keywords_json,
        c.chunk_sha256,
        c.created_at
      );
    }
  }

  public listKnowledgeChunkRows(filters?: {
    collection_ids?: string[];
    document_id?: string;
    tenant_id?: string;
  }): StoredKnowledgeChunkRow[] {
    this.ensureKnowledgeVaultTablesReady();
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.collection_ids && filters.collection_ids.length > 0) {
      const placeholders = filters.collection_ids.map(() => "?").join(", ");
      clauses.push(`collection_id IN (${placeholders})`);
      params.push(...filters.collection_ids);
    }
    if (filters?.document_id) {
      clauses.push("document_id = ?");
      params.push(filters.document_id);
    }
    if (filters?.tenant_id) {
      clauses.push("(tenant_id = ? OR tenant_id = 'tenant_system')");
      params.push(filters.tenant_id);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT id, document_id, collection_id, tenant_id, project_id, chunk_index,
                section_heading, content, token_estimate, keywords_json, chunk_sha256, created_at
         FROM knowledge_chunks
         ${whereSql}
         ORDER BY collection_id ASC, document_id ASC, chunk_index ASC`
      )
      .all(...params) as unknown as StoredKnowledgeChunkRow[];
  }

  public upsertMissionKnowledgeBindingRow(
    row: StoredMissionKnowledgeBindingRow
  ): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(
        `INSERT INTO mission_knowledge_bindings (
          id, mission_id, collection_id, tenant_id, project_id, top_k,
          min_relevance_score, mandatory_citation, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mission_id, collection_id) DO UPDATE SET
          top_k = excluded.top_k,
          min_relevance_score = excluded.min_relevance_score,
          mandatory_citation = excluded.mandatory_citation`
      )
      .run(
        row.id,
        row.mission_id,
        row.collection_id,
        row.tenant_id,
        row.project_id,
        row.top_k,
        row.min_relevance_score,
        row.mandatory_citation,
        row.created_by,
        row.created_at
      );
  }

  public listMissionKnowledgeBindingRows(
    missionId: string
  ): StoredMissionKnowledgeBindingRow[] {
    this.ensureKnowledgeVaultTablesReady();
    return this.db
      .prepare(
        `SELECT id, mission_id, collection_id, tenant_id, project_id, top_k,
                min_relevance_score, mandatory_citation, created_by, created_at
         FROM mission_knowledge_bindings
         WHERE mission_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(missionId) as unknown as StoredMissionKnowledgeBindingRow[];
  }

  public insertKnowledgeCitationRow(row: StoredKnowledgeCitationRow): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(
        `INSERT INTO knowledge_citations (
          id, mission_id, task_id, artifact_id, collection_id, document_id,
          chunk_id, citation_anchor, quote_snippet, relevance_score, verified, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.mission_id,
        row.task_id,
        row.artifact_id,
        row.collection_id,
        row.document_id,
        row.chunk_id,
        row.citation_anchor,
        row.quote_snippet,
        row.relevance_score,
        row.verified,
        row.created_at
      );
  }

  public listKnowledgeCitationRows(filters: {
    mission_id: string;
    artifact_id?: string;
  }): StoredKnowledgeCitationRow[] {
    this.ensureKnowledgeVaultTablesReady();
    if (filters.artifact_id) {
      return this.db
        .prepare(
          `SELECT id, mission_id, task_id, artifact_id, collection_id, document_id,
                  chunk_id, citation_anchor, quote_snippet, relevance_score, verified, created_at
           FROM knowledge_citations
           WHERE mission_id = ? AND artifact_id = ?
           ORDER BY created_at ASC, id ASC`
        )
        .all(filters.mission_id, filters.artifact_id) as unknown as StoredKnowledgeCitationRow[];
    }
    return this.db
      .prepare(
        `SELECT id, mission_id, task_id, artifact_id, collection_id, document_id,
                chunk_id, citation_anchor, quote_snippet, relevance_score, verified, created_at
         FROM knowledge_citations
         WHERE mission_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(filters.mission_id) as unknown as StoredKnowledgeCitationRow[];
  }

  public insertKnowledgeVaultAuditEventRow(
    row: StoredKnowledgeVaultAuditEventRow
  ): void {
    this.ensureKnowledgeVaultTablesReady();
    this.db
      .prepare(
        `INSERT INTO knowledge_vault_audit_events (
          id, collection_id, document_id, mission_id, tenant_id, project_id,
          actor_id, event_type, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.collection_id,
        row.document_id,
        row.mission_id,
        row.tenant_id,
        row.project_id,
        row.actor_id,
        row.event_type,
        row.details_json,
        row.created_at
      );
  }

  public listKnowledgeVaultAuditEventRows(
    collectionId: string
  ): StoredKnowledgeVaultAuditEventRow[] {
    this.ensureKnowledgeVaultTablesReady();
    return this.db
      .prepare(
        `SELECT id, collection_id, document_id, mission_id, tenant_id, project_id,
                actor_id, event_type, details_json, created_at
         FROM knowledge_vault_audit_events
         WHERE collection_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(collectionId) as unknown as StoredKnowledgeVaultAuditEventRow[];
  }

  public deleteMissionCascade(missionId: string): void {
    this.ensureMissionTablesReady();
    this.ensurePlaybooksTablesReady();
    this.db
      .prepare(`DELETE FROM playbook_audit_events WHERE resulting_mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM playbook_instantiations WHERE resulting_mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM mission_budget_ledger WHERE mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM mission_artifacts WHERE mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM mission_events WHERE mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM mission_tasks WHERE mission_id = ?`)
      .run(missionId);
    this.db
      .prepare(`DELETE FROM missions WHERE id = ?`)
      .run(missionId);
  }

  /**
   * Executes `fn` atomically. If `fn` throws any error, rolls back all rows inserted
   * into `missions`, `mission_tasks`, `mission_events`, `mission_artifacts`,
   * `mission_budget_ledger`, `playbook_instantiations`, and `playbook_audit_events`
   * during the callback so zero partial state remains in SQLite.
   */
  public runInAtomicTransaction<T>(fn: () => T): T {
    this.ensureMissionTablesReady();
    this.ensurePlaybooksTablesReady();

    const preMissions = new Set(
      (
        this.db.prepare(`SELECT id FROM missions`).all() as Array<{ id: string }>
      ).map((r) => r.id)
    );
    const preTasks = new Set(
      (
        this.db.prepare(`SELECT id FROM mission_tasks`).all() as Array<{
          id: string;
        }>
      ).map((r) => r.id)
    );
    const preEvents = new Set(
      (
        this.db.prepare(`SELECT id FROM mission_events`).all() as Array<{
          id: string;
        }>
      ).map((r) => r.id)
    );
    const preArtifacts = new Set(
      (
        this.db.prepare(`SELECT id FROM mission_artifacts`).all() as Array<{
          id: string;
        }>
      ).map((r) => r.id)
    );
    const preLedger = new Set(
      (
        this.db.prepare(`SELECT id FROM mission_budget_ledger`).all() as Array<{
          id: string;
        }>
      ).map((r) => r.id)
    );
    const preInstantiations = new Set(
      (
        this.db
          .prepare(`SELECT id FROM playbook_instantiations`)
          .all() as Array<{ id: string }>
      ).map((r) => r.id)
    );
    const preAuditEvents = new Set(
      (
        this.db.prepare(`SELECT id FROM playbook_audit_events`).all() as Array<{
          id: string;
        }>
      ).map((r) => r.id)
    );

    try {
      return fn();
    } catch (err) {
      const postAudit = this.db
        .prepare(`SELECT id FROM playbook_audit_events`)
        .all() as Array<{ id: string }>;
      for (const r of postAudit) {
        if (!preAuditEvents.has(r.id)) {
          this.db
            .prepare(`DELETE FROM playbook_audit_events WHERE id = ?`)
            .run(r.id);
        }
      }

      const postInst = this.db
        .prepare(`SELECT id FROM playbook_instantiations`)
        .all() as Array<{ id: string }>;
      for (const r of postInst) {
        if (!preInstantiations.has(r.id)) {
          this.db
            .prepare(`DELETE FROM playbook_instantiations WHERE id = ?`)
            .run(r.id);
        }
      }

      const postLedger = this.db
        .prepare(`SELECT id FROM mission_budget_ledger`)
        .all() as Array<{ id: string }>;
      for (const r of postLedger) {
        if (!preLedger.has(r.id)) {
          this.db
            .prepare(`DELETE FROM mission_budget_ledger WHERE id = ?`)
            .run(r.id);
        }
      }

      const postArtifacts = this.db
        .prepare(`SELECT id FROM mission_artifacts`)
        .all() as Array<{ id: string }>;
      for (const r of postArtifacts) {
        if (!preArtifacts.has(r.id)) {
          this.db
            .prepare(`DELETE FROM mission_artifacts WHERE id = ?`)
            .run(r.id);
        }
      }

      const postEvents = this.db
        .prepare(`SELECT id FROM mission_events`)
        .all() as Array<{ id: string }>;
      for (const r of postEvents) {
        if (!preEvents.has(r.id)) {
          this.db
            .prepare(`DELETE FROM mission_events WHERE id = ?`)
            .run(r.id);
        }
      }

      const postTasks = this.db
        .prepare(`SELECT id FROM mission_tasks`)
        .all() as Array<{ id: string }>;
      for (const r of postTasks) {
        if (!preTasks.has(r.id)) {
          this.db
            .prepare(`DELETE FROM mission_tasks WHERE id = ?`)
            .run(r.id);
        }
      }

      const postMissions = this.db
        .prepare(`SELECT id FROM missions`)
        .all() as Array<{ id: string }>;
      for (const r of postMissions) {
        if (!preMissions.has(r.id)) {
          this.db.prepare(`DELETE FROM missions WHERE id = ?`).run(r.id);
        }
      }

      throw err;
    }
  }

  // ============================================================================
  // EXISTING KOSMORA RUNTIME STORE METHODS
  // ============================================================================

  public saveArtifactRevision(
    record: Omit<StoredArtifactRevisionRecord, "project_id" | "tenant_id"> & {
      project_id?: string;
      tenant_id?: string;
    }
  ): void {
    const projectId = record.project_id ?? "proj_default";
    const tenantId = record.tenant_id ?? "tenant_default";
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_artifact_revisions (
        revision_id, artifact_id, project_id, tenant_id, version, title, kind,
        content_json, content_sha256, author_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.revision_id,
      record.artifact_id,
      projectId,
      tenantId,
      record.version,
      record.title,
      record.kind,
      record.content_json,
      record.content_sha256,
      record.author_id,
      record.created_at
    );
  }

  public listArtifactRevisions(
    artifactId: string,
    projectId?: string
  ): StoredArtifactRevisionRecord[] {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
               content_json, content_sha256, author_id, created_at
        FROM kosmora_artifact_revisions
        WHERE artifact_id = ? AND project_id = ?
        ORDER BY version ASC
      `);
      return stmt.all(artifactId, projectId) as unknown as StoredArtifactRevisionRecord[];
    }
    const stmt = this.db.prepare(`
      SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
             content_json, content_sha256, author_id, created_at
      FROM kosmora_artifact_revisions
      WHERE artifact_id = ?
      ORDER BY version ASC
    `);
    return stmt.all(artifactId) as unknown as StoredArtifactRevisionRecord[];
  }

  public saveDagPlan(
    record: Omit<StoredDagPlanRecord, "workspace_id"> & { workspace_id?: string }
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_dag_plans (
        plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.plan_id,
      record.project_id,
      record.tenant_id,
      record.workspace_id ?? "ws_default",
      record.goal,
      record.state_json,
      record.status,
      record.updated_at
    );
  }

  public getDagPlan(planId: string, projectId?: string): StoredDagPlanRecord | undefined {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
        FROM kosmora_dag_plans
        WHERE plan_id = ? AND project_id = ?
      `);
      return stmt.get(planId, projectId) as StoredDagPlanRecord | undefined;
    }
    const stmt = this.db.prepare(`
      SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
      FROM kosmora_dag_plans
      WHERE plan_id = ?
    `);
    return stmt.get(planId) as StoredDagPlanRecord | undefined;
  }

  public saveKnowledgeNode(record: StoredKnowledgeNodeRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_knowledge_nodes (
        node_id, project_id, tenant_id, workspace_id, title, content, version, stale, node_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.node_id,
      record.project_id,
      record.tenant_id,
      record.workspace_id,
      record.title,
      record.content,
      record.version,
      record.stale ? 1 : 0,
      record.node_json,
      record.updated_at
    );
  }

  public listKnowledgeNodes(projectId: string): StoredKnowledgeNodeRecord[] {
    const stmt = this.db.prepare(`
      SELECT node_id, project_id, tenant_id, workspace_id, title, content, version, stale, node_json, updated_at
      FROM kosmora_knowledge_nodes
      WHERE project_id = ?
      ORDER BY node_id ASC
    `);
    return stmt.all(projectId) as unknown as StoredKnowledgeNodeRecord[];
  }

  /**
   * F142: Strictly project-scoped Point-in-Time Snapshot Creation & Restoration.
   * Captures ONLY artifacts, DAG plans, and knowledge nodes belonging to `projectId`.
   */
  public createProjectSnapshot(
    projectId: string,
    tenantId = "tenant_default"
  ): ProjectPointInTimeSnapshot {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("createProjectSnapshot requires a non-empty projectId");
    }

    const artifacts = this.db
      .prepare(
        `SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
                content_json, content_sha256, author_id, created_at
         FROM kosmora_artifact_revisions
         WHERE project_id = ?
         ORDER BY revision_id ASC`
      )
      .all(projectId) as unknown as StoredArtifactRevisionRecord[];

    const plans = this.db
      .prepare(
        `SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
         FROM kosmora_dag_plans
         WHERE project_id = ?
         ORDER BY plan_id ASC`
      )
      .all(projectId) as unknown as StoredDagPlanRecord[];

    const nodes = this.listKnowledgeNodes(projectId);

    const payloadJson = JSON.stringify({
      project_id: projectId,
      tenant_id: tenantId,
      artifacts,
      plans,
      nodes
    });
    const snapshotSha256 = createHash("sha256").update(payloadJson).digest("hex");

    const snapshot: ProjectPointInTimeSnapshot = {
      snapshot_id: `snap_${projectId}_${Date.now()}_${snapshotSha256.slice(0, 8)}`,
      project_id: projectId,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      artifact_revisions_count: artifacts.length,
      dag_plans_count: plans.length,
      knowledge_nodes_count: nodes.length,
      snapshot_sha256: snapshotSha256,
      payload_json: payloadJson
    };

    const stmt = this.db.prepare(`
      INSERT INTO kosmora_project_snapshots (
        snapshot_id, project_id, tenant_id, created_at,
        artifact_revisions_count, dag_plans_count, knowledge_nodes_count,
        snapshot_sha256, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.snapshot_id,
      snapshot.project_id,
      snapshot.tenant_id,
      snapshot.created_at,
      snapshot.artifact_revisions_count,
      snapshot.dag_plans_count,
      snapshot.knowledge_nodes_count,
      snapshot.snapshot_sha256,
      snapshot.payload_json
    );

    return snapshot;
  }

  /**
   * Restores a point-in-time snapshot ONLY for its owning project_id without touching other projects.
   */
  public restoreProjectSnapshot(snapshotId: string): {
    project_id: string;
    restored_artifacts: number;
    restored_plans: number;
    restored_nodes: number;
  } {
    const stmt = this.db.prepare(`
      SELECT snapshot_id, project_id, tenant_id, created_at,
             artifact_revisions_count, dag_plans_count, knowledge_nodes_count,
             snapshot_sha256, payload_json
      FROM kosmora_project_snapshots
      WHERE snapshot_id = ?
    `);
    const snap = stmt.get(snapshotId) as ProjectPointInTimeSnapshot | undefined;
    if (!snap) {
      throw new Error(`Snapshot '${snapshotId}' not found`);
    }

    const recomputedHash = createHash("sha256").update(snap.payload_json).digest("hex");
    if (recomputedHash !== snap.snapshot_sha256) {
      throw new Error(`Snapshot '${snapshotId}' integrity check failed (SHA-256 mismatch)`);
    }

    const parsed = JSON.parse(snap.payload_json) as {
      project_id: string;
      artifacts: StoredArtifactRevisionRecord[];
      plans: StoredDagPlanRecord[];
      nodes?: StoredKnowledgeNodeRecord[];
    };

    const targetProjectId = snap.project_id;

    // Clear current records of ONLY this project before restoring snapshot state
    this.db
      .prepare(`DELETE FROM kosmora_artifact_revisions WHERE project_id = ?`)
      .run(targetProjectId);
    this.db
      .prepare(`DELETE FROM kosmora_dag_plans WHERE project_id = ?`)
      .run(targetProjectId);
    this.db
      .prepare(`DELETE FROM kosmora_knowledge_nodes WHERE project_id = ?`)
      .run(targetProjectId);

    for (const art of parsed.artifacts) {
      if (art.project_id === targetProjectId) {
        this.saveArtifactRevision(art);
      }
    }
    for (const plan of parsed.plans) {
      if (plan.project_id === targetProjectId) {
        this.saveDagPlan(plan);
      }
    }
    for (const node of parsed.nodes ?? []) {
      if (node.project_id === targetProjectId) {
        this.saveKnowledgeNode(node);
      }
    }

    return {
      project_id: targetProjectId,
      restored_artifacts: parsed.artifacts.length,
      restored_plans: parsed.plans.length,
      restored_nodes: (parsed.nodes ?? []).length
    };
  }

  /**
   * F141: Project-Scoped Storage Quota & Retention Policy Enforcement
   */
  public evaluateProjectStorageQuota(
    projectId: string,
    maxBytesQuota = 50 * 1024 * 1024
  ): {
    project_id: string;
    used_bytes: number;
    max_bytes: number;
    utilization_pct: number;
    within_quota: boolean;
  } {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("evaluateProjectStorageQuota requires a non-empty projectId");
    }

    const artRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(content_json)), 0) as bytes
         FROM kosmora_artifact_revisions
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const dagRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(state_json)), 0) as bytes
         FROM kosmora_dag_plans
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const nodeRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(node_json)), 0) as bytes
         FROM kosmora_knowledge_nodes
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const usedBytes = Number(artRow.bytes ?? 0) + Number(dagRow.bytes ?? 0) + Number(nodeRow.bytes ?? 0);
    const utilizationPct = Number(((usedBytes / Math.max(1, maxBytesQuota)) * 100).toFixed(4));

    return {
      project_id: projectId,
      used_bytes: usedBytes,
      max_bytes: maxBytesQuota,
      utilization_pct: utilizationPct,
      within_quota: usedBytes <= maxBytesQuota
    };
  }

  public close(cleanupEphemeral = false): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
    if (cleanupEphemeral && this.isEphemeralMemoryFile && existsSync(this.physicalPath)) {
      rmSync(this.physicalPath, { force: true });
    }
  }

  public reopen(): void {
    if (this.isClosed) {
      this.db = openSqliteDatabase(this.physicalPath);
      this.isClosed = false;
    }
  }
}
