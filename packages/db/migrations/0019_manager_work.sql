CREATE TABLE manager_work (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX manager_work_request_unique ON manager_work(project_id, owner_id, client_request_id);
--> statement-breakpoint
CREATE TABLE manager_work_files (
  execution_id TEXT NOT NULL REFERENCES manager_work(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(execution_id, name)
);
