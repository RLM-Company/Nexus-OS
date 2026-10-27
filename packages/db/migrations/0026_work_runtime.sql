CREATE TABLE project_memory (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  forgotten INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX project_memory_scope ON project_memory(project_id, owner_id, forgotten, pinned);
--> statement-breakpoint
CREATE TABLE work_checkpoints (
  work_id TEXT NOT NULL REFERENCES manager_work(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  PRIMARY KEY(work_id, version)
);
--> statement-breakpoint
CREATE TABLE work_artifact_versions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES manager_work(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, name, version),
  UNIQUE(work_id, name)
);
--> statement-breakpoint
CREATE INDEX work_artifact_scope ON work_artifact_versions(project_id, work_id);
