CREATE TABLE kosmora_automation_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('playbook','playbook_version','instantiation','schedule','occurrence','suite','evaluation','collection','binding')),
  client_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
  version INTEGER NOT NULL CHECK(version>=1),
  body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=131072),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id,project_id,kind,client_key)
);
--> statement-breakpoint
CREATE INDEX automation_scope ON kosmora_automation_records(owner_id,project_id,kind,created_at,id);
--> statement-breakpoint
CREATE TRIGGER automation_insert BEFORE INSERT ON kosmora_automation_records BEGIN
  SELECT RAISE(ABORT,'PROJECT_NOT_FOUND') WHERE NOT EXISTS (
    SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.owner_id AND status='ACTIVE'
  );
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS (SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
--> statement-breakpoint
CREATE TRIGGER automation_update BEFORE UPDATE ON kosmora_automation_records BEGIN
  SELECT RAISE(ABORT,'AUTOMATION_IMMUTABLE') WHERE NEW.id<>OLD.id OR NEW.owner_id<>OLD.owner_id OR NEW.project_id<>OLD.project_id
    OR NEW.kind<>OLD.kind OR NEW.client_key<>OLD.client_key OR NEW.fingerprint<>OLD.fingerprint OR NEW.created_at<>OLD.created_at
    OR OLD.kind NOT IN ('playbook','schedule') OR NEW.version<>OLD.version+1;
  SELECT RAISE(ABORT,'PROJECT_NOT_FOUND') WHERE NOT EXISTS (
    SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.owner_id AND status='ACTIVE'
  );
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active'
  ) OR EXISTS (SELECT 1 FROM work_owner_fences WHERE owner_id=NEW.owner_id AND fenced=1);
END;
