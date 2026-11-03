CREATE TABLE kosmora_workflow_definitions (
 id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)), archived_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 client_creation_id TEXT NOT NULL, creation_json TEXT NOT NULL CHECK(json_valid(creation_json)),
 UNIQUE(owner_id,project_id,client_creation_id)
);
--> statement-breakpoint
CREATE INDEX workflow_definitions_scope ON kosmora_workflow_definitions(owner_id,project_id,updated_at);
--> statement-breakpoint
CREATE TABLE kosmora_workflow_versions (
 workflow_id TEXT NOT NULL REFERENCES kosmora_workflow_definitions(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1), definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 created_at TEXT NOT NULL, PRIMARY KEY(workflow_id,version)
);
--> statement-breakpoint
CREATE TABLE kosmora_workflow_runs (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES kosmora_workflow_definitions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
 client_request_id TEXT NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 definition_version INTEGER NOT NULL, definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
 inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
 dag_id TEXT NOT NULL REFERENCES work_dags(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
 UNIQUE(owner_id,project_id,client_request_id)
);
--> statement-breakpoint
CREATE INDEX workflow_runs_scope ON kosmora_workflow_runs(owner_id,project_id,workflow_id,created_at);
--> statement-breakpoint
CREATE TRIGGER workflow_def_insert BEFORE INSERT ON kosmora_workflow_definitions BEGIN
 SELECT RAISE(ABORT,'WORKFLOW_OWNER_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.owner_id AND status IN ('DRAFT','ACTIVE'));
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active') OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER workflow_def_update BEFORE UPDATE ON kosmora_workflow_definitions BEGIN
 SELECT RAISE(ABORT,'WORKFLOW_OWNER_MISMATCH') WHERE NEW.owner_id<>OLD.owner_id OR NEW.project_id<>OLD.project_id OR NEW.id<>OLD.id OR NEW.client_creation_id<>OLD.client_creation_id OR NEW.creation_json<>OLD.creation_json;
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active') OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER workflow_version_insert BEFORE INSERT ON kosmora_workflow_versions BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_workflow_definitions d JOIN kosmora_owner_data_lifecycle l ON l.owner_id=d.owner_id WHERE d.id=NEW.workflow_id AND l.state<>'active') OR EXISTS(SELECT 1 FROM kosmora_workflow_definitions d JOIN work_owner_fences f ON f.owner_id=d.owner_id WHERE d.id=NEW.workflow_id AND f.fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE ON kosmora_workflow_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKFLOW_VERSION'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_run_insert BEFORE INSERT ON kosmora_workflow_runs BEGIN
 SELECT RAISE(ABORT,'WORKFLOW_OWNER_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM kosmora_workflow_definitions d JOIN work_dags g ON g.id=NEW.dag_id WHERE d.id=NEW.workflow_id AND d.owner_id=NEW.owner_id AND d.project_id=NEW.project_id AND g.owner_id=NEW.owner_id AND g.project_id=NEW.project_id);
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active') OR EXISTS(SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER workflow_run_immutable BEFORE UPDATE ON kosmora_workflow_runs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WORKFLOW_RUN'); END;
