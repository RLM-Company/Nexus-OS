CREATE TABLE project_correction_rules (
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
CREATE INDEX project_correction_rules_active_idx
  ON project_correction_rules(project_id, owner_id, enabled);
