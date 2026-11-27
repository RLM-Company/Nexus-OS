CREATE TABLE stars_org_snapshots (
  team_scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_scope, owner_id, version)
);
--> statement-breakpoint
CREATE INDEX stars_org_snapshots_current_idx
  ON stars_org_snapshots(owner_id, team_scope, version DESC);
