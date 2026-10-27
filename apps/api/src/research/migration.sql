-- REFERENCE ONLY: install through existing managed migration 0028 (idx28).
-- ResearchStore never runs DDL on startup. Do NOT install this file at runtime.
-- New synthesis/accounting state is JSON in existing payload_json; no 0033 required.
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
