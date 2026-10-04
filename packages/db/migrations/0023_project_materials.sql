CREATE TABLE project_materials (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN project_materials_json TEXT NOT NULL DEFAULT '{}';
