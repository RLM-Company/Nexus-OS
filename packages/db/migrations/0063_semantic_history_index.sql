-- Derived local embeddings only; originals remain in their existing stores.
CREATE TABLE semantic_index_sources (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 reference TEXT NOT NULL,
 encoder TEXT NOT NULL,
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 memory_entry_id TEXT REFERENCES context_memory_entries(id) ON DELETE CASCADE,
 general_message_id TEXT REFERENCES general_chat_messages(id) ON DELETE CASCADE,
 project_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
 next_offset INTEGER NOT NULL DEFAULT 0 CHECK(next_offset>=0),
 chunk_width INTEGER NOT NULL DEFAULT 600 CHECK(chunk_width BETWEEN 1 AND 600),
 complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
 UNIQUE(owner_id,reference,encoder),
 UNIQUE(owner_id,id),
 CHECK((memory_entry_id IS NOT NULL AND reference='M:'||memory_entry_id) OR
 (memory_entry_id IS NULL AND general_message_id IS NOT NULL AND project_message_id IS NULL AND reference='H:g:'||general_message_id) OR
 (memory_entry_id IS NULL AND project_message_id IS NOT NULL AND general_message_id IS NULL AND reference='H:p:'||project_message_id)),
 CHECK(NOT(general_message_id IS NOT NULL AND project_message_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE semantic_index_chunks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 start_utf16 INTEGER NOT NULL CHECK(start_utf16>=0),
 end_utf16 INTEGER NOT NULL CHECK(end_utf16>start_utf16),
 vector BLOB NOT NULL CHECK(typeof(vector)='blob' AND length(vector)=1536),
 FOREIGN KEY(owner_id,source_id) REFERENCES semantic_index_sources(owner_id,id) ON DELETE CASCADE,
 UNIQUE(source_id,start_utf16)
);
--> statement-breakpoint
CREATE INDEX semantic_chunks_owner_page ON semantic_index_chunks(owner_id,id);
--> statement-breakpoint
CREATE TABLE semantic_index_progress (
 owner_id TEXT NOT NULL,
 target_kind TEXT NOT NULL,
 target_id TEXT NOT NULL,
 encoder TEXT NOT NULL,
 phase INTEGER NOT NULL DEFAULT 0 CHECK(phase BETWEEN 0 AND 3),
 after_id TEXT NOT NULL DEFAULT '',
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
 failures INTEGER NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 3),
 state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready','capacity','blocked')),
 PRIMARY KEY(owner_id,target_kind,target_id,encoder),
 FOREIGN KEY(owner_id,target_kind,target_id) REFERENCES context_memory_settings(owner_id,target_kind,target_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER semantic_sources_insert_fence BEFORE INSERT ON semantic_index_sources BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
 SELECT RAISE(ABORT,'SEMANTIC_SOURCE_OWNER') WHERE
 (NEW.memory_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM context_memory_entries WHERE id=NEW.memory_entry_id AND owner_id=NEW.owner_id)) OR
 (NEW.general_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM general_chat_messages m JOIN general_chats c ON c.id=m.chat_id AND c.owner_id=m.owner_id WHERE m.id=NEW.general_message_id AND c.owner_id=NEW.owner_id)) OR
 (NEW.project_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages m JOIN projects p ON p.id=m.project_id WHERE m.id=NEW.project_message_id AND p.owner_id=NEW.owner_id));
END;
--> statement-breakpoint
CREATE TRIGGER semantic_sources_update_fence BEFORE UPDATE ON semantic_index_sources BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id IN (OLD.owner_id,NEW.owner_id) AND state<>'active');
 SELECT RAISE(ABORT,'SEMANTIC_SOURCE_IDENTITY') WHERE OLD.owner_id<>NEW.owner_id OR OLD.reference<>NEW.reference OR OLD.encoder<>NEW.encoder OR OLD.fingerprint<>NEW.fingerprint OR OLD.memory_entry_id IS NOT NEW.memory_entry_id OR OLD.general_message_id IS NOT NEW.general_message_id OR OLD.project_message_id IS NOT NEW.project_message_id;
END;
--> statement-breakpoint
CREATE TRIGGER semantic_chunks_insert_fence BEFORE INSERT ON semantic_index_chunks BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER semantic_chunks_update_fence BEFORE UPDATE ON semantic_index_chunks BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id IN (OLD.owner_id,NEW.owner_id) AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER semantic_progress_insert_fence BEFORE INSERT ON semantic_index_progress BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=NEW.owner_id AND state<>'active');
END;
--> statement-breakpoint
CREATE TRIGGER semantic_progress_update_fence BEFORE UPDATE ON semantic_index_progress BEGIN
 SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id IN (OLD.owner_id,NEW.owner_id) AND state<>'active');
END;
--> statement-breakpoint
-- Grant changes flush the owner's derived cache, retaining all originals.
CREATE TRIGGER semantic_settings_update AFTER UPDATE ON context_memory_settings WHEN OLD.owner_id IS NOT NEW.owner_id OR OLD.target_kind IS NOT NEW.target_kind OR OLD.target_id IS NOT NEW.target_id OR OLD.enabled IS NOT NEW.enabled OR OLD.use_personal IS NOT NEW.use_personal OR OLD.source_chat_ids_json IS NOT NEW.source_chat_ids_json OR OLD.project_ids_json IS NOT NEW.project_ids_json BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=OLD.owner_id;
 DELETE FROM semantic_index_progress WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER semantic_settings_delete AFTER DELETE ON context_memory_settings BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=OLD.owner_id;
 DELETE FROM semantic_index_progress WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
-- Privacy snapshots also discard rebuildable vectors, before export/deletion.
CREATE TRIGGER semantic_lifecycle_insert AFTER INSERT ON kosmora_owner_data_lifecycle WHEN NEW.state<>'active' BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=NEW.owner_id;
 DELETE FROM semantic_index_progress WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER semantic_lifecycle_update AFTER UPDATE ON kosmora_owner_data_lifecycle WHEN NEW.state<>'active' BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=NEW.owner_id;
 DELETE FROM semantic_index_progress WHERE owner_id=NEW.owner_id;
END;

--> statement-breakpoint
CREATE TRIGGER semantic_general_chat_messages_insert AFTER INSERT ON general_chat_messages WHEN NEW.status='completed' AND NEW.role IN ('user','assistant') BEGIN
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=NEW.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='chat' AND s.target_id=NEW.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=NEW.chat_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_general_chat_messages_update AFTER UPDATE ON general_chat_messages WHEN (OLD.status='completed' OR NEW.status='completed') AND (OLD.created_at IS NOT NEW.created_at OR OLD.content IS NOT NEW.content OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status OR OLD.chat_id IS NOT NEW.chat_id OR OLD.owner_id IS NOT NEW.owner_id) BEGIN
 DELETE FROM semantic_index_sources WHERE general_message_id=OLD.id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=OLD.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='chat' AND s.target_id=OLD.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=OLD.chat_id)) OR EXISTS(SELECT 1 FROM context_memory_entries WHERE source_chat_message_id=OLD.id AND owner_id=OLD.owner_id)));
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=NEW.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='chat' AND s.target_id=NEW.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=NEW.chat_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_general_chat_messages_delete AFTER DELETE ON general_chat_messages BEGIN
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=OLD.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='chat' AND s.target_id=OLD.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=OLD.chat_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_messages_insert AFTER INSERT ON messages WHEN NEW.status='completed' AND NEW.role IN ('user','assistant') BEGIN
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id) AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='project' AND s.target_id=NEW.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=NEW.project_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_messages_update AFTER UPDATE ON messages WHEN (OLD.status='completed' OR NEW.status='completed') AND (OLD.created_at IS NOT NEW.created_at OR OLD.content IS NOT NEW.content OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status OR OLD.chat_id IS NOT NEW.chat_id OR OLD.project_id IS NOT NEW.project_id) BEGIN
 DELETE FROM semantic_index_sources WHERE project_message_id=OLD.id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=(SELECT owner_id FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='project' AND s.target_id=OLD.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=OLD.project_id)) OR EXISTS(SELECT 1 FROM context_memory_entries WHERE source_project_message_id=OLD.id AND owner_id=(SELECT owner_id FROM projects WHERE id=OLD.project_id))));
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=(SELECT owner_id FROM projects WHERE id=NEW.project_id) AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='project' AND s.target_id=NEW.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=NEW.project_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_messages_delete AFTER DELETE ON messages BEGIN
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=(SELECT owner_id FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND (((s.target_kind='project' AND s.target_id=OLD.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=OLD.project_id))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_notes_insert AFTER INSERT ON context_memory_entries BEGIN
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=NEW.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND ((NEW.scope='personal' AND s.use_personal=1) OR (NEW.scope='chat' AND ((s.target_kind='chat' AND s.target_id=NEW.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=NEW.chat_id))) OR (NEW.scope='project' AND ((s.target_kind='project' AND s.target_id=NEW.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=NEW.project_id)))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_notes_update AFTER UPDATE ON context_memory_entries BEGIN
 DELETE FROM semantic_index_sources WHERE memory_entry_id=OLD.id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=OLD.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND ((OLD.scope='personal' AND s.use_personal=1) OR (OLD.scope='chat' AND ((s.target_kind='chat' AND s.target_id=OLD.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=OLD.chat_id))) OR (OLD.scope='project' AND ((s.target_kind='project' AND s.target_id=OLD.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=OLD.project_id)))));
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=NEW.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND ((NEW.scope='personal' AND s.use_personal=1) OR (NEW.scope='chat' AND ((s.target_kind='chat' AND s.target_id=NEW.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=NEW.chat_id))) OR (NEW.scope='project' AND ((s.target_kind='project' AND s.target_id=NEW.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=NEW.project_id)))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_notes_delete AFTER DELETE ON context_memory_entries BEGIN
 DELETE FROM semantic_index_sources WHERE memory_entry_id=OLD.id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE semantic_index_progress.owner_id=OLD.owner_id AND EXISTS(SELECT 1 FROM context_memory_settings s WHERE s.owner_id=semantic_index_progress.owner_id AND s.target_kind=semantic_index_progress.target_kind AND s.target_id=semantic_index_progress.target_id AND ((OLD.scope='personal' AND s.use_personal=1) OR (OLD.scope='chat' AND ((s.target_kind='chat' AND s.target_id=OLD.chat_id) OR EXISTS(SELECT 1 FROM json_each(s.source_chat_ids_json) WHERE value=OLD.chat_id))) OR (OLD.scope='project' AND ((s.target_kind='project' AND s.target_id=OLD.project_id) OR EXISTS(SELECT 1 FROM json_each(s.project_ids_json) WHERE value=OLD.project_id)))));
END;

--> statement-breakpoint
CREATE TRIGGER semantic_general_chats_update AFTER UPDATE ON general_chats WHEN OLD.archived IS NOT NEW.archived OR OLD.owner_id IS NOT NEW.owner_id BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id IN (OLD.owner_id,NEW.owner_id);
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=OLD.owner_id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=NEW.owner_id;
END;

--> statement-breakpoint
CREATE TRIGGER semantic_general_chats_delete AFTER DELETE ON general_chats BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=OLD.owner_id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=OLD.owner_id;
END;

--> statement-breakpoint
CREATE TRIGGER semantic_projects_update AFTER UPDATE ON projects WHEN OLD.status IS NOT NEW.status OR OLD.owner_id IS NOT NEW.owner_id BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id IN (OLD.owner_id,NEW.owner_id);
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=OLD.owner_id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=NEW.owner_id;
END;

--> statement-breakpoint
CREATE TRIGGER semantic_projects_delete AFTER DELETE ON projects BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=OLD.owner_id;
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=OLD.owner_id;
END;

--> statement-breakpoint
CREATE TRIGGER semantic_context_insert AFTER INSERT ON chat_context_settings BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id);
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=NEW.chat_id);
END;

--> statement-breakpoint
CREATE TRIGGER semantic_context_update AFTER UPDATE ON chat_context_settings WHEN OLD.excluded_json IS NOT NEW.excluded_json BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=OLD.chat_id);
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=OLD.chat_id);
END;

--> statement-breakpoint
CREATE TRIGGER semantic_context_delete AFTER DELETE ON chat_context_settings BEGIN
 DELETE FROM semantic_index_sources WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=OLD.chat_id);
 UPDATE semantic_index_progress SET phase=0,after_id='',state='building',failures=0,generation=generation+1 WHERE owner_id=(SELECT owner_id FROM general_chats WHERE id=OLD.chat_id);
END;

--> statement-breakpoint
CREATE INDEX semantic_sources_memory ON semantic_index_sources(memory_entry_id);
--> statement-breakpoint
CREATE INDEX semantic_sources_general ON semantic_index_sources(general_message_id);
--> statement-breakpoint
CREATE INDEX semantic_sources_project ON semantic_index_sources(project_message_id);
