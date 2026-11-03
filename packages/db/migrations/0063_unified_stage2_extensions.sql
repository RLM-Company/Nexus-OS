-- Additive Stage-2 migration (0056..0063 consolidated schema & OWNER_DATA_FENCED triggers)
CREATE TABLE IF NOT EXISTS kosmora_owner_data_lifecycle (
  owner_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  epoch INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('personal', 'chat', 'project')),
  chat_id TEXT,
  project_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'constraint', 'hypothesis')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  source_chat_message_id TEXT,
  source_project_message_id TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  creation_key TEXT,
  creation_sha256 TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_versions (
  entry_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (entry_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_settings (
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  chat_id TEXT,
  project_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  use_personal INTEGER NOT NULL DEFAULT 1,
  source_chat_ids_json TEXT NOT NULL DEFAULT '[]',
  project_ids_json TEXT NOT NULL DEFAULT '[]',
  compact_history INTEGER NOT NULL DEFAULT 0,
  temporary_mode INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, target_kind, target_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_owner_defaults (
  owner_id TEXT PRIMARY KEY NOT NULL,
  default_enabled INTEGER NOT NULL DEFAULT 1,
  default_use_personal INTEGER NOT NULL DEFAULT 1,
  default_auto_extract INTEGER NOT NULL DEFAULT 0,
  default_temporary_mode INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS profile_candidate_dismissals (
  owner_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  chat_message_id TEXT,
  project_message_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, candidate_id),
  CHECK ((chat_message_id IS NULL) <> (project_message_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_memory_usage (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  chat_id TEXT,
  project_id TEXT,
  run_id TEXT NOT NULL,
  general_run_id TEXT,
  project_run_id TEXT,
  request_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  phase TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_drive_spool_journal (
  backup_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  spool_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('spooled', 'uploading', 'completed', 'failed', 'purged')),
  attempts INTEGER NOT NULL DEFAULT 0,
  drive_file_id TEXT,
  last_error_code TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_drive_recovered_catalog (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  drive_file_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  chat_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  work_file_count INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('verified', 'corrupt')),
  created_at TEXT NOT NULL,
  recovered_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  client_creation_id TEXT,
  creation_json TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_versions (
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  dag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, project_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_workflow_schedules (
  schedule_id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  cron_or_interval TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_slot_iso TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS workflow_version_immutable
BEFORE UPDATE ON kosmora_workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'WORKFLOW_VERSION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_entries_ins
BEFORE INSERT ON context_memory_entries
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_entries_upd
BEFORE UPDATE ON context_memory_entries
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_profile_candidate_dismissals_ins
BEFORE INSERT ON profile_candidate_dismissals
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_context_memory_usage_ins
BEFORE INSERT ON context_memory_usage
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_workflow_definitions_ins
BEFORE INSERT ON kosmora_workflow_definitions
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS stage2_fence_workflow_runs_ins
BEFORE INSERT ON kosmora_workflow_runs
BEGIN
  SELECT RAISE(ABORT, 'OWNER_DATA_FENCED')
  WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id = NEW.owner_id AND state <> 'active');
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_roaring_inverted_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  doc_count INTEGER NOT NULL,
  term_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_probabilistic_filter_snapshots (
  snapshot_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  filter_type TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace, filter_type)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS kosmora_pq_codebooks (
  codebook_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  subspaces INTEGER NOT NULL,
  centroids_per_subspace INTEGER NOT NULL,
  codebook_json TEXT NOT NULL,
  codes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, namespace)
);
