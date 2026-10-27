-- Research v1 additive table. ResearchStore bootstraps this idempotently on the shared SQLite connection.
-- Optional for migration-aware deployments: execute after core migrations, before starting API.
CREATE TABLE IF NOT EXISTS research_v1_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_v1_owner_idx ON research_v1_runs(owner_id, created_at DESC);
