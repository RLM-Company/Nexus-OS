CREATE TABLE IF NOT EXISTS project_material_activity (
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (project_id, version)
);
