-- Model answers are distinct from the source-excerpt export and never replace originals.
CREATE TABLE document_answer_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  question TEXT NOT NULL,
  selected_files_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  answer_text TEXT,
  citations_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed','cancelled')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX document_answer_runs_scope ON document_answer_runs(owner_id,project_id,created_at);
