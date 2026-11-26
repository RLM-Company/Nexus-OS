CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  status TEXT NOT NULL CHECK(status IN ('invited','active')),
  invited_at TEXT NOT NULL,
  accepted_at TEXT,
  PRIMARY KEY (project_id, account_id)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_members_account_idx ON project_members(account_id, status);
