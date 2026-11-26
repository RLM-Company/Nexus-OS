CREATE TABLE IF NOT EXISTS project_correction_rules (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  instructions TEXT NOT NULL,
  version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, client_request_id),
  UNIQUE(project_id, name, version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_correction_rules_active_idx
  ON project_correction_rules(project_id, owner_id, enabled);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_source_exclusions (
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
CREATE INDEX IF NOT EXISTS project_source_exclusions_project_idx
  ON project_source_exclusions(owner_id, project_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_source_settings (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_run_sources (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, project_id, run_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_run_sources_project_idx
  ON project_run_sources(owner_id, project_id, at DESC);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_sources_owner_fence_insert BEFORE INSERT ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_sources_owner_fence_update BEFORE UPDATE ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_run_sources_owner_fence_insert BEFORE INSERT ON project_run_sources
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) THEN RAISE(ABORT, 'OWNER_DATA_FENCED') END;
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  status TEXT NOT NULL CHECK(status IN ('invited','active')),
  invited_at TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (project_id, account_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_members_account_idx ON project_members(account_id, status);
--> statement-breakpoint
-- Reconcile project schema after 0075 on deployed Stars-only databases.
-- Preserve 0072/0073 history. SQLite keeps the same object definitions when
-- IF NOT EXISTS is stripped. This check refuses unrelated same-named objects.
CREATE TEMP TABLE compatible_project_intake_schema (ok INTEGER NOT NULL CHECK(ok = 1));
--> statement-breakpoint
INSERT INTO compatible_project_intake_schema(ok)
SELECT COUNT(*) = 12 FROM sqlite_schema WHERE
(type = 'table' AND name = 'project_correction_rules' AND sql = 'CREATE TABLE project_correction_rules (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  instructions TEXT NOT NULL,
  version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, client_request_id),
  UNIQUE(project_id, name, version)
)')
  OR (type = 'index' AND name = 'project_correction_rules_active_idx' AND sql = 'CREATE INDEX project_correction_rules_active_idx
  ON project_correction_rules(project_id, owner_id, enabled)')
  OR (type = 'table' AND name = 'project_source_exclusions' AND sql = 'CREATE TABLE project_source_exclusions (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (owner_id, project_id, source_kind, source_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)')
  OR (type = 'index' AND name = 'project_source_exclusions_project_idx' AND sql = 'CREATE INDEX project_source_exclusions_project_idx
  ON project_source_exclusions(owner_id, project_id)')
  OR (type = 'table' AND name = 'project_source_settings' AND sql = 'CREATE TABLE project_source_settings (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)')
  OR (type = 'table' AND name = 'project_run_sources' AND sql = 'CREATE TABLE project_run_sources (
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, project_id, run_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
)')
  OR (type = 'index' AND name = 'project_run_sources_project_idx' AND sql = 'CREATE INDEX project_run_sources_project_idx
  ON project_run_sources(owner_id, project_id, at DESC)')
  OR (type = 'trigger' AND name = 'project_sources_owner_fence_insert' AND sql = 'CREATE TRIGGER project_sources_owner_fence_insert BEFORE INSERT ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>''active''
  ) THEN RAISE(ABORT, ''OWNER_DATA_FENCED'') END;
END')
  OR (type = 'trigger' AND name = 'project_sources_owner_fence_update' AND sql = 'CREATE TRIGGER project_sources_owner_fence_update BEFORE UPDATE ON project_source_exclusions
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>''active''
  ) THEN RAISE(ABORT, ''OWNER_DATA_FENCED'') END;
END')
  OR (type = 'trigger' AND name = 'project_run_sources_owner_fence_insert' AND sql = 'CREATE TRIGGER project_run_sources_owner_fence_insert BEFORE INSERT ON project_run_sources
BEGIN
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>''active''
  ) THEN RAISE(ABORT, ''OWNER_DATA_FENCED'') END;
END')
  OR (type = 'table' AND name = 'project_members' AND sql = 'CREATE TABLE project_members (
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN (''owner'',''editor'',''viewer'')),
  status TEXT NOT NULL CHECK(status IN (''invited'',''active'')),
  invited_at TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (project_id, account_id)
)')
  OR (type = 'index' AND name = 'project_members_account_idx' AND sql = 'CREATE INDEX project_members_account_idx ON project_members(account_id, status)');
--> statement-breakpoint
DROP TABLE compatible_project_intake_schema;
