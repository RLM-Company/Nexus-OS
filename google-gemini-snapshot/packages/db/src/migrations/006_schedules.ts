/**
 * @cosmora/db — Migration 006: Kosmora Schedules & Triggers Tables & Indexes
 * Creates playbook_schedules, schedule_runs, and schedule_audit_events
 * with tenant/project/playbook/status/next_run_at/idempotency indexes.
 */

export const SCHEDULES_MIGRATION_VERSION = 6 as const;
export const SCHEDULES_MIGRATION_NAME =
  "006_kosmora_schedules_tables" as const;

export const SCHEDULES_MIGRATION_UP_SQL = `
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

export const SCHEDULES_MIGRATION_DOWN_SQL = `
  DROP TABLE IF EXISTS schedule_audit_events;
  DROP TABLE IF EXISTS schedule_runs;
  DROP TABLE IF EXISTS playbook_schedules;
`;
