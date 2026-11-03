-- Explicit owner-controlled memory. No backfill/extraction or extra external access.
CREATE TABLE context_memory_entries (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN ('personal','chat','project')),
 chat_id TEXT REFERENCES general_chats(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('fact','preference','decision','constraint','hypothesis')),
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
 expires_at TEXT,
 source_chat_message_id TEXT REFERENCES general_chat_messages(id) ON DELETE CASCADE,
 source_project_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
 source_json TEXT,
 version INTEGER NOT NULL CHECK(version >= 1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 creation_key TEXT,
 creation_sha256 TEXT,
 UNIQUE(owner_id,creation_key),
 CHECK((scope='personal' AND chat_id IS NULL AND project_id IS NULL) OR
       (scope='chat' AND chat_id IS NOT NULL AND project_id IS NULL) OR
       (scope='project' AND chat_id IS NULL AND project_id IS NOT NULL)),
 CHECK(NOT(source_chat_message_id IS NOT NULL AND source_project_message_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX context_memory_owner_scope ON context_memory_entries(owner_id,scope,chat_id,project_id);
--> statement-breakpoint
CREATE TABLE context_memory_versions (
 entry_id TEXT NOT NULL REFERENCES context_memory_entries(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL,
 PRIMARY KEY(entry_id,version)
);
--> statement-breakpoint
CREATE TABLE context_memory_settings (
 owner_id TEXT NOT NULL,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('chat','project')),
 target_id TEXT NOT NULL,
 chat_id TEXT REFERENCES general_chats(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 use_personal INTEGER NOT NULL CHECK(use_personal IN (0,1)),
 source_chat_ids_json TEXT NOT NULL,
 project_ids_json TEXT NOT NULL,
 version INTEGER NOT NULL,
 PRIMARY KEY(owner_id,target_kind,target_id),
 CHECK((target_kind='chat' AND chat_id IS NOT NULL AND chat_id=target_id AND project_id IS NULL) OR
       (target_kind='project' AND project_id IS NOT NULL AND project_id=target_id AND chat_id IS NULL))
);
--> statement-breakpoint
CREATE TRIGGER context_memory_entries_fence_insert BEFORE INSERT ON context_memory_entries BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_entries_fence_update BEFORE UPDATE ON context_memory_entries BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_settings_fence_insert BEFORE INSERT ON context_memory_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_settings_fence_update BEFORE UPDATE ON context_memory_settings BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_versions_fence_insert BEFORE INSERT ON context_memory_versions BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM context_memory_entries e JOIN kosmora_owner_data_lifecycle f ON f.owner_id=e.owner_id
 WHERE e.id=NEW.entry_id AND f.state<>'active');
END;
--> statement-breakpoint
-- Old revisions can refer to a former source after an entry was edited.
-- Deleting that source must also remove those derivative revision bodies.
CREATE TRIGGER context_memory_general_source_delete AFTER DELETE ON general_chat_messages BEGIN
 DELETE FROM context_memory_versions WHERE json_extract(snapshot_json,'$.source.kind')='chat_message'
 AND json_extract(snapshot_json,'$.source.message_id')=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_project_source_delete AFTER DELETE ON messages BEGIN
 DELETE FROM context_memory_versions WHERE json_extract(snapshot_json,'$.source.kind')='project_message'
 AND json_extract(snapshot_json,'$.source.message_id')=OLD.id;
END;
