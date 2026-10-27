CREATE TABLE canvas_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('markdown', 'text', 'code', 'html')),
  current_version INTEGER NOT NULL CHECK(current_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX canvas_artifacts_scope ON canvas_artifacts(owner_id, project_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE canvas_revisions (
  artifact_id TEXT NOT NULL REFERENCES canvas_artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0),
  title TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('markdown', 'text', 'code', 'html')),
  content TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);
--> statement-breakpoint
CREATE INDEX canvas_revisions_recent ON canvas_revisions(artifact_id, version DESC);
--> statement-breakpoint
CREATE TRIGGER canvas_revision_no_update BEFORE UPDATE ON canvas_revisions
BEGIN SELECT RAISE(ABORT, 'CANVAS_IMMUTABLE_REVISION'); END;
--> statement-breakpoint
CREATE TRIGGER canvas_revision_no_direct_delete BEFORE DELETE ON canvas_revisions
WHEN EXISTS (SELECT 1 FROM canvas_artifacts WHERE id = OLD.artifact_id)
BEGIN SELECT RAISE(ABORT, 'CANVAS_IMMUTABLE_REVISION'); END;
