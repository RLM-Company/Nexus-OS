CREATE TABLE context_memory_usage (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('chat','project')),
 target_id TEXT NOT NULL,
 chat_id TEXT REFERENCES general_chats(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL,
 general_run_id TEXT REFERENCES general_chat_runs(id) ON DELETE CASCADE,
 project_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 1000),
 channel TEXT NOT NULL CHECK(channel IN ('chat','manager_work','native_work')),
 phase TEXT NOT NULL CHECK(phase IN ('dispatch_boundary','provider_completed')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 created_at TEXT NOT NULL,
 UNIQUE(owner_id,channel,run_id,request_id,attempt),
 CHECK((target_kind='chat' AND chat_id=target_id AND project_id IS NULL AND general_run_id=run_id AND project_run_id IS NULL AND channel='chat') OR
       (target_kind='project' AND project_id=target_id AND chat_id IS NULL AND project_run_id=run_id AND general_run_id IS NULL AND channel<>'chat'))
);
--> statement-breakpoint
CREATE INDEX context_memory_usage_target ON context_memory_usage(owner_id,target_kind,target_id,created_at DESC);
--> statement-breakpoint
CREATE TRIGGER context_memory_usage_fence_insert BEFORE INSERT ON context_memory_usage BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_usage_fence_update BEFORE UPDATE ON context_memory_usage BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS
 (SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_usage_forget_entry AFTER DELETE ON context_memory_entries BEGIN
 DELETE FROM context_memory_usage WHERE EXISTS
 (SELECT 1 FROM json_each(snapshot_json,'$.sources') e WHERE json_extract(e.value,'$.reference')='M:'||OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_usage_forget_general_source AFTER DELETE ON general_chat_messages BEGIN
 DELETE FROM context_memory_usage WHERE EXISTS
 (SELECT 1 FROM json_each(snapshot_json,'$.sources') e WHERE json_extract(e.value,'$.source_kind')='chat_message' AND json_extract(e.value,'$.source_message_id')=OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER context_memory_usage_forget_project_source AFTER DELETE ON messages BEGIN
 DELETE FROM context_memory_usage WHERE EXISTS
 (SELECT 1 FROM json_each(snapshot_json,'$.sources') e WHERE json_extract(e.value,'$.source_kind')='project_message' AND json_extract(e.value,'$.source_message_id')=OLD.id);
END;
