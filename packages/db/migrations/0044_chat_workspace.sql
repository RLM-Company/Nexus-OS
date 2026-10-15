CREATE TABLE chat_folders (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX chat_folders_owner_idx ON chat_folders(owner_id);
--> statement-breakpoint
CREATE TABLE chat_folder_assignments (
  chat_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE navigation_pins (
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chats','projects')),
  target_id TEXT NOT NULL,
  PRIMARY KEY(owner_id,kind,target_id)
);
--> statement-breakpoint
CREATE TABLE chat_context_settings (
  chat_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
  excluded_json TEXT NOT NULL,
  summary TEXT NOT NULL CHECK(length(summary)<=8000),
  summary_through TEXT REFERENCES general_chat_messages(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version>=1),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER chat_folder_assignment_owner_insert BEFORE INSERT ON chat_folder_assignments BEGIN
  SELECT RAISE(ABORT,'FOLDER_OWNER_MISMATCH') WHERE (SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) IS NOT (SELECT owner_id FROM chat_folders WHERE id=NEW.folder_id);
END;
--> statement-breakpoint
CREATE TRIGGER chat_folder_assignment_owner_update BEFORE UPDATE ON chat_folder_assignments BEGIN
  SELECT RAISE(ABORT,'FOLDER_OWNER_MISMATCH') WHERE (SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) IS NOT (SELECT owner_id FROM chat_folders WHERE id=NEW.folder_id);
END;
--> statement-breakpoint
CREATE TRIGGER chat_pins_cleanup AFTER DELETE ON general_chats BEGIN
  DELETE FROM navigation_pins WHERE kind='chats' AND target_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER project_pins_cleanup AFTER DELETE ON projects BEGIN
  DELETE FROM navigation_pins WHERE kind='projects' AND target_id=OLD.id;
END;

--> statement-breakpoint
CREATE TRIGGER chat_folders_fence_insert BEFORE INSERT ON chat_folders BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_folders_fence_update BEFORE UPDATE ON chat_folders BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER navigation_pins_fence_insert BEFORE INSERT ON navigation_pins BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER navigation_pins_fence_update BEFORE UPDATE ON navigation_pins BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_context_settings_fence_insert BEFORE INSERT ON chat_context_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_context_settings_fence_update BEFORE UPDATE ON chat_context_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_folder_assignments_fence_insert BEFORE INSERT ON chat_folder_assignments BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) AND state<>'active');
END;

--> statement-breakpoint
CREATE TRIGGER chat_folder_assignments_fence_update BEFORE UPDATE ON chat_folder_assignments BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id) AND state<>'active');
END;

--> statement-breakpoint
CREATE UNIQUE INDEX code_agent_client_request_idx ON code_agent_runs(owner_id,json_extract(state_json,'$.client_request_id')) WHERE json_extract(state_json,'$.client_request_id') IS NOT NULL;

--> statement-breakpoint
CREATE TABLE navigation_legacy_imports(owner_id TEXT PRIMARY KEY NOT NULL);
