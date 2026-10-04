CREATE TABLE github_change_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'review',
  plan_json TEXT NOT NULL,
  pr_url TEXT,
  published_sha TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX github_drafts_owner_project ON github_change_drafts(owner_id, project_id, created_at);
