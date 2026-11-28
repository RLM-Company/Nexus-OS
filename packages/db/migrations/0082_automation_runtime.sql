--> statement-breakpoint
CREATE TABLE automation_triggers (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES kosmora_workflow_definitions(id) ON DELETE CASCADE,
  definition_version INTEGER NOT NULL CHECK(definition_version>=1),
  kind TEXT NOT NULL CHECK(kind IN ('manual','event','schedule')),
  inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  schedule_json TEXT CHECK(schedule_json IS NULL OR json_valid(schedule_json)),
  event_json TEXT CHECK(event_json IS NULL OR json_valid(event_json)),
  event_key TEXT,
  status TEXT NOT NULL CHECK(status IN ('enabled','paused','cancelled')),
  version INTEGER NOT NULL CHECK(version>=1),
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, client_request_id),
  UNIQUE(owner_id, event_key)
);
--> statement-breakpoint
CREATE INDEX automation_triggers_scope ON automation_triggers(owner_id, project_id, workflow_id, status);
--> statement-breakpoint
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  trigger_id TEXT NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL CHECK(definition_version>=1),
  dag_id TEXT REFERENCES work_dags(id) ON DELETE SET NULL,
  occurrence_key TEXT NOT NULL,
  event_key TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('manual','event','schedule')),
  status TEXT NOT NULL CHECK(status IN ('queued','claimed','awaiting_confirmation','running','succeeded','failed','cancelled','unknown_external')),
  node_id TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
  error_code TEXT,
  error_reason TEXT,
  confirmation_id TEXT,
  external_action_id TEXT,
  version INTEGER NOT NULL CHECK(version>=1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, occurrence_key),
  UNIQUE(owner_id, event_key)
);
--> statement-breakpoint
CREATE INDEX automation_runs_scope ON automation_runs(owner_id, project_id, trigger_id, created_at);
--> statement-breakpoint
CREATE INDEX automation_runs_lease ON automation_runs(status, lease_expires_at);
--> statement-breakpoint
CREATE TABLE automation_events (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX automation_events_run ON automation_events(run_id, at, id);
--> statement-breakpoint
CREATE TABLE automation_external_actions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  trigger_id TEXT NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  connector TEXT NOT NULL,
  operation TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','unknown','verified','failed')),
  confirmation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, operation_key)
);
--> statement-breakpoint
CREATE INDEX automation_external_actions_scope ON automation_external_actions(owner_id, run_id, status);
--> statement-breakpoint
CREATE TRIGGER automation_trigger_insert BEFORE INSERT ON automation_triggers BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NOT EXISTS(
    SELECT 1 FROM kosmora_workflow_definitions d JOIN projects p ON p.id=d.project_id AND p.owner_id=d.owner_id
    WHERE d.id=NEW.workflow_id AND d.project_id=NEW.project_id AND d.owner_id=NEW.owner_id AND d.version=NEW.definition_version
  );
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER automation_trigger_update BEFORE UPDATE ON automation_triggers BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NEW.owner_id<>OLD.owner_id OR NEW.project_id<>OLD.project_id OR NEW.workflow_id<>OLD.workflow_id OR NEW.client_request_id<>OLD.client_request_id;
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER automation_run_insert BEFORE INSERT ON automation_runs BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NOT EXISTS(
    SELECT 1 FROM automation_triggers t JOIN projects p ON p.id=t.project_id AND p.owner_id=t.owner_id
    WHERE t.id=NEW.trigger_id AND t.owner_id=NEW.owner_id AND t.project_id=NEW.project_id
  );
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER automation_run_update BEFORE UPDATE ON automation_runs BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NEW.owner_id<>OLD.owner_id OR NEW.project_id<>OLD.project_id OR NEW.trigger_id<>OLD.trigger_id OR NEW.occurrence_key<>OLD.occurrence_key;
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER automation_external_action_insert BEFORE INSERT ON automation_external_actions BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_OWNER_MISMATCH') WHERE NOT EXISTS(
    SELECT 1 FROM automation_runs r WHERE r.id=NEW.run_id AND r.owner_id=NEW.owner_id AND r.trigger_id=NEW.trigger_id
  );
END;
