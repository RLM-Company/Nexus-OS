/**
 * @cosmora/db — Migration 007: Kosmora Evaluations & Quality Gates Tables & Indexes
 * Creates evaluation_suites, evaluation_runs, quality_gate_policies, and evaluation_audit_events
 * with tenant/project/suite/mission/playbook/verdict indexes.
 */

export const EVALUATIONS_MIGRATION_VERSION = 7 as const;
export const EVALUATIONS_MIGRATION_NAME =
  "007_kosmora_evaluations_tables" as const;

export const EVALUATIONS_MIGRATION_UP_SQL = `
  CREATE TABLE IF NOT EXISTS evaluation_suites (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Общие',
    target_scope TEXT NOT NULL DEFAULT 'mission_artifact',
    visibility TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'active',
    pass_threshold_score REAL NOT NULL DEFAULT 75,
    max_budget_per_run REAL NOT NULL DEFAULT 30,
    block_on_critical_criteria INTEGER NOT NULL DEFAULT 1,
    criteria_json TEXT NOT NULL DEFAULT '[]',
    golden_test_cases_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_evaluation_suites_tenant_project_status
    ON evaluation_suites(tenant_id, project_id, status, updated_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluation_suites_slug_scope
    ON evaluation_suites(tenant_id, COALESCE(project_id, '__global__'), slug);

  CREATE TABLE IF NOT EXISTS evaluation_runs (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    suite_title TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_mission_id TEXT,
    target_artifact_id TEXT,
    target_playbook_id TEXT,
    target_playbook_version INTEGER,
    overall_score REAL NOT NULL,
    pass_threshold_score REAL NOT NULL,
    verdict TEXT NOT NULL,
    critical_failures_count INTEGER NOT NULL DEFAULT 0,
    criteria_results_json TEXT NOT NULL DEFAULT '[]',
    test_case_results_json TEXT NOT NULL DEFAULT '[]',
    baseline_run_id TEXT,
    score_delta REAL,
    regression_detected INTEGER NOT NULL DEFAULT 0,
    cost_spent REAL NOT NULL DEFAULT 0,
    summary_ru TEXT NOT NULL DEFAULT '',
    initiated_by TEXT NOT NULL,
    initiated_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_tenant_project
    ON evaluation_runs(tenant_id, project_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_suite
    ON evaluation_runs(suite_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_mission
    ON evaluation_runs(target_mission_id, initiated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_evaluation_runs_playbook
    ON evaluation_runs(target_playbook_id, target_playbook_version, initiated_at DESC);

  CREATE TABLE IF NOT EXISTS quality_gate_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    playbook_id TEXT,
    title TEXT NOT NULL,
    enforce_on TEXT NOT NULL DEFAULT 'mission_completion',
    min_score REAL NOT NULL DEFAULT 75,
    block_on_regression INTEGER NOT NULL DEFAULT 1,
    max_allowed_score_drop REAL NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_quality_gate_policies_lookup
    ON quality_gate_policies(tenant_id, project_id, enforce_on, enabled);

  CREATE TABLE IF NOT EXISTS evaluation_audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
    project_id TEXT,
    suite_id TEXT NOT NULL,
    run_id TEXT,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_evaluation_audit_events_suite
    ON evaluation_audit_events(suite_id, created_at ASC);
`;

export const EVALUATIONS_MIGRATION_DOWN_SQL = `
  DROP TABLE IF EXISTS evaluation_audit_events;
  DROP TABLE IF EXISTS quality_gate_policies;
  DROP TABLE IF EXISTS evaluation_runs;
  DROP TABLE IF EXISTS evaluation_suites;
`;
