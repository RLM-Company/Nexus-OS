-- Additive migration 0064: Persistent Research Runs, Step Checkpoints, Deduplicated Sources, and Separated Evidence Claims
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT,
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL DEFAULT '',
  client_request_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'paused', 'cancelled', 'failed', 'completed')),
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  max_depth INTEGER NOT NULL DEFAULT 2,
  max_sources INTEGER NOT NULL DEFAULT 6,
  max_runtime_ms INTEGER NOT NULL DEFAULT 15000,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  depth_reached INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  report_markdown TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_research_runs_owner_project
  ON research_runs (owner_id, project_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_runs_idempotency
  ON research_runs (owner_id, IFNULL(project_id, ''), client_request_id)
  WHERE client_request_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS research_run_steps (
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  step_kind TEXT NOT NULL CHECK(step_kind IN ('search', 'read_source', 'synthesize')),
  target_url TEXT,
  depth INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, step_index),
  UNIQUE (run_id, step_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS research_sources (
  source_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  published_at TEXT,
  page_version TEXT NOT NULL,
  previous_page_version TEXT,
  page_changed INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL,
  content_text TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 1,
  http_status INTEGER NOT NULL DEFAULT 200,
  UNIQUE (run_id, canonical_url)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS research_claims (
  claim_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  criterion TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('confirmed', 'conflicting', 'unconfirmed')),
  resolved_value TEXT NOT NULL,
  conflict_summary TEXT,
  unconfirmed_reason TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (run_id, subject, criterion)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_research_runs_ins
BEFORE INSERT ON research_runs
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_research_runs_upd
BEFORE UPDATE ON research_runs
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
