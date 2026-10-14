-- Manual per-chat notes; ownership is derived from the canonical chat, never supplied by a client.
CREATE TABLE chat_memory_notes (
  chat_id TEXT PRIMARY KEY NOT NULL REFERENCES general_chats(id) ON DELETE CASCADE,
  memory_notes TEXT NOT NULL CHECK(length(memory_notes) <= 4000),
  version INTEGER NOT NULL CHECK(version >= 1),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER chat_memory_notes_fence_insert BEFORE INSERT ON chat_memory_notes BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
    WHERE c.id=NEW.chat_id AND f.state<>'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER chat_memory_notes_fence_update BEFORE UPDATE ON chat_memory_notes BEGIN
  SELECT RAISE(ABORT,'OWNER_DATA_FENCED') WHERE EXISTS (
    SELECT 1 FROM kosmora_owner_data_lifecycle f JOIN general_chats c ON c.owner_id=f.owner_id
    WHERE c.id=NEW.chat_id AND f.state<>'active'
  );
END;
