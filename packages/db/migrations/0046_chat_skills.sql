-- Additive migration after presentation history 0045. Accepted run snapshots are independent of the catalog.
CREATE TABLE chat_skill_settings (
 chat_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1), updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE chat_skill_selections (
 chat_id TEXT NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
 skill_id TEXT NOT NULL, version INTEGER NOT NULL,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 2),
 PRIMARY KEY(chat_id,skill_id), UNIQUE(chat_id,position),
 FOREIGN KEY(skill_id,version) REFERENCES owner_skill_versions(skill_id,version) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE chat_run_skill_snapshots (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chat_runs(id) ON DELETE CASCADE,
 selection_version INTEGER NOT NULL CHECK(selection_version>=0), skills_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER chat_skill_selection_owner BEFORE INSERT ON chat_skill_selections BEGIN
 SELECT RAISE(ABORT,'SKILL_OWNER_MISMATCH') WHERE NOT EXISTS (
  SELECT 1 FROM general_chats c JOIN owner_skill_versions v ON v.owner_id=c.owner_id
  WHERE c.id=NEW.chat_id AND v.skill_id=NEW.skill_id AND v.version=NEW.version
 );
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
  WHERE c.id=NEW.chat_id AND f.state<>'active'
 );
END;
--> statement-breakpoint
CREATE TRIGGER chat_skill_settings_fence_insert BEFORE INSERT ON chat_skill_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
  WHERE c.id=NEW.chat_id AND f.state<>'active'
 );
END;
--> statement-breakpoint
CREATE TRIGGER chat_skill_settings_fence_update BEFORE UPDATE ON chat_skill_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
  WHERE c.id=NEW.chat_id AND f.state<>'active'
 );
END;
--> statement-breakpoint
CREATE TRIGGER chat_run_skills_fence BEFORE INSERT ON chat_run_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
  SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
  JOIN general_chat_runs r ON r.chat_id=c.id WHERE r.id=NEW.run_id AND f.state<>'active'
 );
END;
--> statement-breakpoint
-- Deleting a catalog entry detaches it for future requests; accepted snapshots remain immutable.
CREATE TRIGGER chat_skill_catalog_delete BEFORE DELETE ON owner_skills BEGIN
 UPDATE chat_skill_settings SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE chat_id IN (SELECT chat_id FROM chat_skill_selections WHERE skill_id=OLD.id)
 AND NOT EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=OLD.owner_id AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_run_skills_immutable BEFORE UPDATE ON chat_run_skill_snapshots BEGIN
 SELECT RAISE(ABORT,'SKILL_SNAPSHOT_IMMUTABLE');
END;
