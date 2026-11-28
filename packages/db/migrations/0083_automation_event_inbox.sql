--> statement-breakpoint
ALTER TABLE automation_triggers ADD COLUMN version_policy TEXT NOT NULL DEFAULT 'pinned' CHECK(version_policy IN ('pinned','follow_latest'));
--> statement-breakpoint
ALTER TABLE automation_triggers ADD COLUMN last_change_reason TEXT;
--> statement-breakpoint
CREATE TABLE automation_event_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL CHECK(definition_version>=1),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('accepted','duplicate','rejected')),
  reason TEXT NOT NULL,
  trigger_id TEXT,
  run_id TEXT,
  received_at TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  UNIQUE(owner_id, receipt_id),
  UNIQUE(owner_id, event_key)
);
--> statement-breakpoint
CREATE INDEX automation_event_inbox_owner_idx ON automation_event_inbox(owner_id, received_at, status);
--> statement-breakpoint
CREATE INDEX automation_event_inbox_workflow_idx ON automation_event_inbox(owner_id, workflow_id, definition_version);
--> statement-breakpoint
CREATE TRIGGER automation_event_inbox_insert BEFORE INSERT ON automation_event_inbox BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NOT EXISTS(
    SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.owner_id AND status IN ('DRAFT','ACTIVE')
  );
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
