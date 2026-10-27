/**
 * @cosmora/db — Migration 004: Kosmora Mission Control Tables & Indexes
 * Creates missions, mission_tasks, mission_events, mission_artifacts, and mission_budget_ledger
 * with optimistic concurrency versions and tenant/project/owner isolation indexes.
 */

export const MISSION_CONTROL_MIGRATION_VERSION = 4 as const;
export const MISSION_CONTROL_MIGRATION_NAME =
  "004_kosmora_mission_control_tables" as const;

export const MISSION_CONTROL_MIGRATION_UP_SQL = `
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

export const MISSION_CONTROL_MIGRATION_DOWN_SQL = `
  DROP TABLE IF EXISTS mission_budget_ledger;
  DROP TABLE IF EXISTS mission_artifacts;
  DROP TABLE IF EXISTS mission_events;
  DROP TABLE IF EXISTS mission_tasks;
  DROP TABLE IF EXISTS missions;
`;
