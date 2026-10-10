CREATE TABLE work_dags (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  request_json TEXT NOT NULL,
  UNIQUE(project_id, owner_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE work_dag_checkpoints (
  graph_id TEXT NOT NULL REFERENCES work_dags(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY(graph_id, version)
);
--> statement-breakpoint
CREATE TABLE work_owner_fences (
  owner_id TEXT PRIMARY KEY NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 1,
  fenced INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE work_project_controls (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('active','paused','cancelled'))
);
