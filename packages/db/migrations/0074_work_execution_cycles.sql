CREATE TABLE IF NOT EXISTS work_execution_cycles (
  work_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  cycle_version INTEGER NOT NULL,
  question TEXT,
  gaps_json TEXT NOT NULL,
  instructions_json TEXT NOT NULL,
  error_code TEXT,
  accepted_inputs_json TEXT NOT NULL,
  result_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (work_id, owner_id)
);
CREATE INDEX IF NOT EXISTS work_execution_cycles_owner_idx
  ON work_execution_cycles(owner_id, updated_at DESC);
