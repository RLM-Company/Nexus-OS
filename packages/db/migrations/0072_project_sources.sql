-- Project-scoped source exclusions and immutable per-run used-source receipts.
CREATE TABLE project_source_exclusions (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (owner_id, project_id, source_kind, source_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX project_source_exclusions_project_idx
  ON project_source_exclusions(owner_id, project_id);
--> statement-breakpoint
CREATE TABLE project_source_settings (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE project_run_sources (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, project_id, run_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX project_run_sources_project_idx
  ON project_run_sources(owner_id, project_id, at DESC);
--> statement-breakpoint
CREATE TRIGGER project_sources_owner_fence_insert BEFORE INSERT ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
--> statement-breakpoint
CREATE TRIGGER project_sources_owner_fence_update BEFORE UPDATE ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
--> statement-breakpoint
CREATE TRIGGER project_run_sources_owner_fence_insert BEFORE INSERT ON project_run_sources
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
