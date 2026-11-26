CREATE TABLE IF NOT EXISTS stars_missions (
  mission_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  team_scope TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mission_id, owner_id)
);
CREATE INDEX IF NOT EXISTS stars_missions_owner_idx
  ON stars_missions(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS stars_missions_scope_idx
  ON stars_missions(owner_id, team_scope);
