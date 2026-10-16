-- Work selections affect future admissions; accepted plans and work keep independent immutable text.
CREATE TABLE work_skill_settings (
 project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1), updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE work_skill_selections (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 skill_id TEXT NOT NULL, version INTEGER NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
 PRIMARY KEY(project_id,skill_id), UNIQUE(project_id,position),
 FOREIGN KEY(skill_id,version) REFERENCES owner_skill_versions(skill_id,version) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE manager_work_skill_snapshots (
 work_id TEXT PRIMARY KEY NOT NULL REFERENCES manager_work(id) ON DELETE CASCADE,
 selection_version INTEGER NOT NULL CHECK(selection_version>=0),
 skills_json TEXT NOT NULL CHECK(json_valid(skills_json) AND json_type(skills_json)='array' AND json_array_length(skills_json)<=3 AND length(CAST(skills_json AS BLOB))<=16000),
 captured_at TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('project','plan')), source_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER manager_work_skill_snapshots_immutable BEFORE UPDATE ON manager_work_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'SKILL_SNAPSHOT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TABLE work_dag_skill_snapshots (
 graph_id TEXT PRIMARY KEY NOT NULL REFERENCES work_dags(id) ON DELETE CASCADE,
 selection_version INTEGER NOT NULL CHECK(selection_version>=0),
 skills_json TEXT NOT NULL CHECK(json_valid(skills_json) AND json_type(skills_json)='array' AND json_array_length(skills_json)<=3 AND length(CAST(skills_json AS BLOB))<=16000),
 captured_at TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('project','plan')), source_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER work_dag_skill_snapshots_immutable BEFORE UPDATE ON work_dag_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'SKILL_SNAPSHOT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_settings_fence_insert BEFORE INSERT ON work_skill_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_settings_fence_update BEFORE UPDATE ON work_skill_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_selections_fence_insert BEFORE INSERT ON work_skill_selections BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_selections_fence_update BEFORE UPDATE ON work_skill_selections BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN projects p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.project_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER manager_work_skill_snapshots_fence_insert BEFORE INSERT ON manager_work_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN manager_work p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.work_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN manager_work p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.work_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_dag_skill_snapshots_fence_insert BEFORE INSERT ON work_dag_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN work_dags p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.graph_id AND f.state<>'active'
 );
 SELECT RAISE(ABORT,'OWNER_QUIESCED') WHERE EXISTS (
  SELECT 1 FROM work_owner_fences f JOIN work_dags p ON p.owner_id=f.owner_id
  WHERE p.id=NEW.graph_id AND f.fenced=1
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_selection_owner_insert BEFORE INSERT ON work_skill_selections BEGIN
 SELECT RAISE(ABORT,'SKILL_OWNER_MISMATCH') WHERE NOT EXISTS (
  SELECT 1 FROM projects p JOIN owner_skill_versions v ON v.owner_id=p.owner_id
  WHERE p.id=NEW.project_id AND v.skill_id=NEW.skill_id AND v.version=NEW.version
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_selection_owner_update BEFORE UPDATE ON work_skill_selections BEGIN
 SELECT RAISE(ABORT,'SKILL_OWNER_MISMATCH') WHERE NOT EXISTS (
  SELECT 1 FROM projects p JOIN owner_skill_versions v ON v.owner_id=p.owner_id
  WHERE p.id=NEW.project_id AND v.skill_id=NEW.skill_id AND v.version=NEW.version
 );
END;
--> statement-breakpoint
CREATE TRIGGER work_skill_catalog_delete BEFORE DELETE ON owner_skills BEGIN
 UPDATE work_skill_settings SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE project_id IN (SELECT project_id FROM work_skill_selections WHERE skill_id=OLD.id)
 AND NOT EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=OLD.owner_id AND state<>'active')
 AND NOT EXISTS (SELECT 1 FROM work_owner_fences WHERE owner_id=OLD.owner_id AND fenced=1);
END;
